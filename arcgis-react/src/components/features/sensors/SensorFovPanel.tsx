import React from 'react';
import '~/styles/features/SensorFov.css';

interface SensorFovPanelProps {
    isVisible: boolean;
    isActive: boolean;
    hasSelection: boolean;
    message: string | null;
    onToggle: () => void;
    onClose: () => void;
}

export const SensorFovPanel: React.FC<SensorFovPanelProps> = ({
    isVisible,
    isActive,
    hasSelection,
    message,
    onToggle,
    onClose
}) => {
    if (!isVisible) {
        return null;
    }

    const canToggle = hasSelection || isActive;

    return (
        <div className={`sensor-fov-panel ${isVisible ? 'visible' : ''}`}>
            <div className="sensor-fov-header">
                <h3>Sensor FOV</h3>
                <button type="button" className="sensor-fov-close" onClick={onClose} aria-label="Close Sensor FOV panel">
                    ✕
                </button>
            </div>
            <div className="sensor-fov-body">
                <p>Overlay the selected sensor&apos;s field of view to visualize its coverage volume.</p>
                <button
                    type="button"
                    className={`sensor-fov-toggle ${isActive ? 'active' : ''}`}
                    onClick={onToggle}
                    disabled={!canToggle}
                >
                    {isActive ? 'Disable Overlay' : 'Enable Overlay'}
                </button>
                {!hasSelection && !isActive && (
                    <p className="sensor-fov-hint">Select a sensor to enable this overlay.</p>
                )}
                {message && <p className="sensor-fov-message">{message}</p>}
            </div>
        </div>
    );
};

