import React, { useEffect, useMemo, useState } from 'react';
import type { SensorDefinition, SensorGroupDefinition } from '~/data/sensors';
import { sensorService, type SensorSelection } from '~/services/sensorService';
import '~/styles/features/Sensors.css';

interface SensorsPanelProps {
    isVisible: boolean;
    onClose: () => void;
    onSelectSensor: (sensorId: string) => void;
    onSelectGroup: (groupId: string) => void;
    onReset: () => void;
}

export const SensorsPanel: React.FC<SensorsPanelProps> = ({
    isVisible,
    onClose,
    onSelectSensor,
    onSelectGroup,
    onReset
}) => {
    const groups = useMemo<SensorGroupDefinition[]>(() => sensorService.listGroups(), []);
    const sensors = useMemo<Map<string, SensorDefinition>>(() => {
        const map = new Map<string, SensorDefinition>();
        for (const sensor of sensorService.listSensors()) {
            map.set(sensor.id, sensor);
        }
        return map;
    }, []);
    const [selection, setSelection] = useState<SensorSelection>(() => sensorService.getSelection());

    useEffect(() => {
        const unsubscribe = sensorService.subscribe(setSelection);
        return unsubscribe;
    }, []);

    const selectedSensorIds = new Set(selection.sensorIds);
    const selectedGroupId = selection.kind === 'group' ? groups.find((group) => {
        return group.sensorIds.every((sensorId) => selectedSensorIds.has(sensorId));
    })?.id ?? null : null;

    return (
        <div className={`sensors-panel ${isVisible ? 'visible' : ''}`}>
            <div className="sensors-header">
                <h3>Sensors</h3>
                <div className="sensors-header-actions">
                    <button
                        type="button"
                        className="sensors-button secondary"
                        onClick={() => {
                            sensorService.clearSelection();
                            onReset();
                        }}
                        disabled={selection.kind === 'none'}
                    >
                        Reset Sensor
                    </button>
                    <button type="button" className="sensors-close" onClick={onClose} aria-label="Close sensor panel">
                        ✕
                    </button>
                </div>
            </div>
            <div className="sensors-body">
                {groups.map((group) => {
                    const isGroupSelected = selectedGroupId === group.id;
                    const sensorsInGroup = group.sensorIds
                        .map((sensorId) => sensors.get(sensorId))
                        .filter((sensor): sensor is SensorDefinition => Boolean(sensor));

                    return (
                        <section key={group.id} className="sensors-group">
                            <header className="sensors-group-header">
                                <div className="sensors-group-title">
                                    <h4>{group.name}</h4>
                                    <span className="sensors-group-badge">{group.badge}</span>
                                </div>
                                <button
                                    type="button"
                                    className={`sensors-button tertiary ${isGroupSelected ? 'active' : ''}`}
                                    onClick={() => {
                                        sensorService.selectGroup(group.id);
                                        onSelectGroup(group.id);
                                    }}
                                >
                                    Select All
                                </button>
                            </header>
                            <div className="sensors-list">
                                {sensorsInGroup.map((sensor) => {
                                    const isSelected = selectedSensorIds.has(sensor.id);
                                    return (
                                        <article
                                            key={sensor.id}
                                            className={`sensor-card ${isSelected ? 'selected' : ''}`}
                                            onClick={() => {
                                                sensorService.selectSensor(sensor.id);
                                                onSelectSensor(sensor.id);
                                            }}
                                        >
                                            <div className="sensor-card-name">
                                                <span className="sensor-card-label">{sensor.name}</span>
                                                {sensor.shortName && <span className="sensor-card-short">{sensor.shortName}</span>}
                                            </div>
                                            <div className="sensor-card-meta">
                                                {sensor.country && <span>{sensor.country}</span>}
                                                {sensor.operator && <span>{sensor.operator}</span>}
                                                {sensor.type && <span>{sensor.type}</span>}
                                            </div>
                                        </article>
                                    );
                                })}
                            </div>
                        </section>
                    );
                })}
            </div>
        </div>
    );
};

