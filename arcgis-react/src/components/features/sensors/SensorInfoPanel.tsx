import React, { useEffect, useMemo, useState } from 'react';
import type { SensorDefinition } from '~/data/sensors';
import { sensorService, type SensorSelection } from '~/services/sensorService';
import '~/styles/features/SensorInfo.css';

interface SensorInfoPanelProps {
    isVisible: boolean;
    onClose: () => void;
    onToggleSunLine: () => void;
    onToggleMoonLine: () => void;
    sunLineActive: boolean;
    moonLineActive: boolean;
}

const FIELD_LABELS: Array<{ label: string; accessor: (sensor: SensorDefinition) => string | null }> = [
    { label: 'Country', accessor: (sensor) => sensor.country },
    { label: 'Sensor Type', accessor: (sensor) => sensor.type },
    { label: 'Latitude', accessor: (sensor) => formatLat(sensor.latitude) },
    { label: 'Longitude', accessor: (sensor) => formatLon(sensor.longitude) },
    { label: 'Min Azimuth', accessor: (sensor) => formatNumber(sensor.minAzimuth, '°') },
    { label: 'Max Azimuth', accessor: (sensor) => formatNumber(sensor.maxAzimuth, '°') },
    { label: 'Min Elevation', accessor: (sensor) => formatNumber(sensor.minElevation, '°') },
    { label: 'Max Elevation', accessor: (sensor) => formatNumber(sensor.maxElevation, '°') },
    { label: 'Min Range', accessor: (sensor) => formatNumber(sensor.minRangeKm, ' km') },
    { label: 'Max Range', accessor: (sensor) => formatNumber(sensor.maxRangeKm, ' km') },
    { label: 'Frequency Band', accessor: (sensor) => sensor.frequencyBand }
];

export const SensorInfoPanel: React.FC<SensorInfoPanelProps> = ({
    isVisible,
    onClose,
    onToggleSunLine,
    onToggleMoonLine,
    sunLineActive,
    moonLineActive
}) => {
    const [selection, setSelection] = useState<SensorSelection>(() => sensorService.getSelection());

    useEffect(() => {
        const unsubscribe = sensorService.subscribe(setSelection);
        return unsubscribe;
    }, []);

    const sensor = useMemo(() => {
        if (!selection.sensorIds.length) return null;
        const primaryId = selection.primaryId ?? selection.sensorIds[0];
        return primaryId ? sensorService.getSensor(primaryId) ?? null : null;
    }, [selection]);

    if (!sensor) {
        return (
            <div className={`sensor-info-panel ${isVisible ? 'visible' : ''}`}>
                <div className="sensor-info-header">
                    <h3>Sensor Info</h3>
                    <button type="button" className="sensor-info-close" onClick={onClose} aria-label="Close sensor info panel">
                        ✕
                    </button>
                </div>
                <div className="sensor-info-empty">
                    <p>Select a sensor from the Sensors panel to view its data.</p>
                </div>
            </div>
        );
    }

    return (
        <div className={`sensor-info-panel ${isVisible ? 'visible' : ''}`}>
            <div className="sensor-info-header">
                <h3>{sensor.name}</h3>
                <button type="button" className="sensor-info-close" onClick={onClose} aria-label="Close sensor info panel">
                    ✕
                </button>
            </div>
            <div className="sensor-info-body">
                <div className="sensor-info-grid">
                    {FIELD_LABELS.map(({ label, accessor }) => {
                        const value = accessor(sensor);
                        if (!value) {
                            return null;
                        }
                        return (
                            <div key={label} className="sensor-info-row">
                                <span className="sensor-info-label">{label}</span>
                                <span className="sensor-info-value">{value}</span>
                            </div>
                        );
                    })}
                </div>
                <div className="sensor-info-actions">
                    <button
                        type="button"
                        className={`sensor-info-button ${sunLineActive ? 'active' : ''}`}
                        onClick={onToggleSunLine}
                    >
                        {sunLineActive ? 'Remove Line to Sun' : 'Add Line to Sun'}
                    </button>
                    <button
                        type="button"
                        className={`sensor-info-button ${moonLineActive ? 'active' : ''}`}
                        onClick={onToggleMoonLine}
                    >
                        {moonLineActive ? 'Remove Line to Moon' : 'Add Line to Moon'}
                    </button>
                </div>
            </div>
        </div>
    );
};

function formatNumber(value: number | null, suffix: string): string | null {
    if (value === null || value === undefined || Number.isNaN(value)) {
        return null;
    }
    return `${Number(value).toFixed(1)}${suffix}`;
}

function formatLat(value: number | null): string | null {
    if (value === null || Number.isNaN(value)) {
        return null;
    }
    const hemi = value >= 0 ? 'N' : 'S';
    return `${Math.abs(value).toFixed(2)}° ${hemi}`;
}

function formatLon(value: number | null): string | null {
    if (value === null || Number.isNaN(value)) {
        return null;
    }
    const hemi = value >= 0 ? 'E' : 'W';
    return `${Math.abs(value).toFixed(2)}° ${hemi}`;
}

