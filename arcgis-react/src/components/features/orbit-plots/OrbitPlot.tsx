import { Scatter3DChart } from 'echarts-gl/charts';
import { Grid3DComponent } from 'echarts-gl/components';
import { LegendComponent, TooltipComponent } from 'echarts/components';
import type { EChartsCoreOption } from 'echarts/core';
import * as echarts from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import '~/styles/features/OrbitPlots.css';
import type { OrbitPlotMode, OrbitPlotSeries } from './types';
import { useOrbitPlotData } from './useOrbitPlotData';

echarts.use([CanvasRenderer, Scatter3DChart, Grid3DComponent, LegendComponent, TooltipComponent]);

interface OrbitPlotProps {
    isVisible: boolean;
    mode: OrbitPlotMode;
    worker: Worker | null;
    satelliteIds: number[];
    title: string;
    onClose: () => void;
    requestId?: number | null;
    initialData: OrbitPlotSeries[] | null;
    isRemoteLoading: boolean;
    errorMessage: string | null;
}

export const OrbitPlot: React.FC<OrbitPlotProps> = ({
    isVisible,
    mode,
    worker,
    satelliteIds,
    title,
    onClose,
    initialData,
    isRemoteLoading,
    errorMessage
}) => {
    const chartRef = useRef<HTMLDivElement | null>(null);
    const chartInstanceRef = useRef<echarts.ECharts | null>(null);
    const { data, isLoading, error, requestData, hydrate, hasRequestedRef } = useOrbitPlotData(worker, mode, initialData);
    const [isCollapsed, setIsCollapsed] = useState(false);

    useEffect(() => {
        if (!isVisible) {
            disposeChart();
            return;
        }
        if (!chartRef.current) {
            return;
        }
        if (!chartInstanceRef.current) {
            chartInstanceRef.current = echarts.init(chartRef.current);
            window.addEventListener('resize', handleResize);
        }
        if (data) {
            chartInstanceRef.current.setOption(buildOption(data, mode));
        }
    }, [data, isVisible, mode]);

    useEffect(() => {
        if (!isVisible) {
            return;
        }
        if (initialData && !hasRequestedRef.current) {
            hydrate(initialData);
            return;
        }
        if (!hasRequestedRef.current) {
            requestData(satelliteIds);
        }
    }, [hasRequestedRef, hydrate, initialData, isVisible, requestData, satelliteIds]);

    useEffect(() => () => disposeChart(), []);

    const handleResize = () => {
        chartInstanceRef.current?.resize();
    };

    const disposeChart = () => {
        if (chartInstanceRef.current) {
            window.removeEventListener('resize', handleResize);
            chartInstanceRef.current.dispose();
            chartInstanceRef.current = null;
        }
    };

    const heading = useMemo(() => title || (mode === 'eci' ? 'Earth-Centered Inertial (ECI) Plot' : 'Earth-Centered Fixed (ECF) Plot'), [mode, title]);

    const handleToggleCollapse = () => {
        setIsCollapsed((prev) => !prev);
    };

    return (
        <div className={`orbit-plot-panel ${isVisible ? 'visible' : ''} ${isCollapsed ? 'collapsed' : ''}`}>
            <div className="orbit-plot-header">
                <h3>{heading}</h3>
                <div className="orbit-plot-header-actions">
                    <button
                        className="orbit-plot-toggle"
                        onClick={handleToggleCollapse}
                        type="button"
                        aria-label={isCollapsed ? 'Expand orbit plot' : 'Collapse orbit plot'}
                    >
                        {isCollapsed ? 'Expand' : 'Collapse'}
                    </button>
                <button className="orbit-plot-close" onClick={onClose} type="button" aria-label="Close Orbit Plot">
                    ✕
                </button>
                </div>
            </div>
            <div className="orbit-plot-body">
                {(errorMessage || error) && <div className="orbit-plot-error">{errorMessage ?? error}</div>}
                {!error && (
                    <>
                        {(isLoading || isRemoteLoading) && (
                            <div className="orbit-plot-loading">
                                <div className="spinner" />
                                <p>Sampling orbit...</p>
                            </div>
                        )}
                        <div ref={chartRef} className="orbit-plot-chart" />
                    </>
                )}
            </div>
        </div>
    );
};

const buildOption = (series: OrbitPlotSeries[], mode: OrbitPlotMode): EChartsCoreOption => {
    const axisLabel = mode === 'eci' ? 'ECI' : 'ECF';
    const maxRange = computeRange(series);
    return {
        backgroundColor: 'transparent',
        tooltip: {
            formatter: (params: any) => {
                const value = params.value as [number, number, number, string];
                const [x, y, z, iso] = value;
                return `
                    <div class="orbit-tooltip">
                        <div class="orbit-tooltip__header">
                            <span class="orbit-tooltip__color" style="background:${params.color}"></span>
                            <span class="orbit-tooltip__title">${params.seriesName}</span>
                        </div>
                        <div class="orbit-tooltip__row">${new Date(iso).toUTCString()}</div>
                        <div class="orbit-tooltip__row">X: ${x.toFixed(2)} km</div>
                        <div class="orbit-tooltip__row">Y: ${y.toFixed(2)} km</div>
                        <div class="orbit-tooltip__row">Z: ${z.toFixed(2)} km</div>
                    </div>
                `;
            }
        },
        legend: {
            textStyle: { color: '#eef8ff', fontSize: 12 }
        },
        grid3D: {
            axisPointer: {
                lineStyle: {
                    color: '#ffbd67'
                }
            },
            axisLine: {
                lineStyle: {
                    color: '#ffffff88'
                }
            },
            splitLine: {
                lineStyle: {
                    color: '#ffffff22'
                }
            },
            viewControl: {
                rotateSensitivity: [6, 12],
                zoomSensitivity: 2.2,
                minDistance: 80,
                maxDistance: 600
            }
        },
        xAxis3D: buildAxis(`${axisLabel} X`, maxRange),
        yAxis3D: buildAxis(`${axisLabel} Y`, maxRange),
        zAxis3D: buildAxis(`${axisLabel} Z`, maxRange),
        series: series.map((entry) => ({
            type: 'scatter3D',
            name: entry.name,
            symbolSize: 8,
            data: entry.points.map((point, idx, arr) => ({
                value: [point.x, point.y, point.z, point.time],
                itemStyle: {
                    opacity: 0.25 + 0.75 * (1 - idx / arr.length)
                }
            })),
            itemStyle: {
                borderWidth: 1,
                borderColor: 'rgba(255,255,255,0.85)'
            }
        }))
    } satisfies EChartsCoreOption;
};

const computeRange = (series: OrbitPlotSeries[]): number => {
    let max = 0;
    for (const s of series) {
        for (const p of s.points) {
            max = Math.max(max, Math.abs(p.x), Math.abs(p.y), Math.abs(p.z));
        }
    }
    if (max === 0) return 1000;
    const step = 1000;
    return Math.ceil(max / step) * step;
};

const buildAxis = (name: string, range: number) => ({
    name,
    min: -range,
    max: range,
    type: 'value',
    axisLabel: {
        color: '#eef8ff'
    },
    axisLine: {
        lineStyle: {
            color: '#eef8ff'
        }
    },
    nameTextStyle: {
        color: '#b7cce8'
    }
});

