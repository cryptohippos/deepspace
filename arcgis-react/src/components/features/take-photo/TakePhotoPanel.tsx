import React, { useEffect, useMemo, useState } from 'react';
import { screenshotService } from '~/services/screenshotService';
import '~/styles/features/TakePhoto.css';

const BODY_CAPTURE_CLASS = 'take-photo-capturing';

interface TakePhotoPanelProps {
    isVisible: boolean;
    onClose: () => void;
}

interface ResolutionOption {
    id: string;
    label: string;
    width: number;
    height: number;
}

const RESOLUTIONS: ResolutionOption[] = [
    { id: 'hd', label: 'HD (1920 × 1080)', width: 1920, height: 1080 },
    { id: '4k', label: '4K (3840 × 2160)', width: 3840, height: 2160 },
    { id: '8k', label: '8K (7680 × 4320)', width: 7680, height: 4320 }
];

const buildDefaultFileName = () => {
    const now = new Date();
    const pad = (value: number) => value.toString().padStart(2, '0');
    return `arcglobe-${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}_${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}.png`;
};

export const TakePhotoPanel: React.FC<TakePhotoPanelProps> = ({ isVisible, onClose }) => {
    const [selectedResolutionId, setSelectedResolutionId] = useState<string>('4k');
    const [fileName, setFileName] = useState<string>(buildDefaultFileName);
    const [fileNameDirty, setFileNameDirty] = useState(false);
    const [isCapturing, setIsCapturing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    useEffect(() => {
        if (typeof document === 'undefined') return;
        if (isCapturing) {
            document.body.classList.add(BODY_CAPTURE_CLASS);
        } else {
            document.body.classList.remove(BODY_CAPTURE_CLASS);
        }
        return () => {
            document.body.classList.remove(BODY_CAPTURE_CLASS);
        };
    }, [isCapturing]);

    useEffect(() => {
        if (isVisible) {
            setError(null);
            setSuccess(null);
            setIsCapturing(false);
            setFileNameDirty(false);
            setFileName(buildDefaultFileName());
        }
    }, [isVisible]);

    const selectedResolution = useMemo(
        () => RESOLUTIONS.find((resolution) => resolution.id === selectedResolutionId) ?? RESOLUTIONS[0],
        [selectedResolutionId]
    );

    const handleCapture = async () => {
        if (!selectedResolution) {
            return;
        }
        setIsCapturing(true);
        setError(null);
        setSuccess(null);
        try {
            await new Promise<void>((resolve) => {
                if (typeof requestAnimationFrame === 'function') {
                    requestAnimationFrame(() => resolve());
                } else {
                    setTimeout(() => resolve(), 16);
                }
            });
            await screenshotService.download({
                width: selectedResolution.width,
                height: selectedResolution.height,
                fileName: fileName.trim() || undefined
            });
            setSuccess(`${selectedResolution.label} snapshot downloaded.`);
            if (!fileNameDirty) {
                setFileName(buildDefaultFileName());
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Unable to capture screenshot.';
            setError(message);
        } finally {
            setIsCapturing(false);
        }
    };

    return (
        <div className={`take-photo-panel ${isVisible ? 'visible' : ''}`}>
            <div className="take-photo-header">
                <h3>Take Photo</h3>
                <button type="button" className="take-photo-close" onClick={onClose} aria-label="Close Take Photo panel">
                    ✕
                </button>
            </div>
            <div className="take-photo-body">
                <section className="take-photo-section">
                    <h4>Resolution</h4>
                    <div className="take-photo-resolution-grid">
                        {RESOLUTIONS.map((resolution) => (
                            <label
                                key={resolution.id}
                                className={`take-photo-resolution ${selectedResolutionId === resolution.id ? 'selected' : ''}`}
                            >
                                <input
                                    type="radio"
                                    name="take-photo-resolution"
                                    value={resolution.id}
                                    checked={selectedResolutionId === resolution.id}
                                    onChange={() => setSelectedResolutionId(resolution.id)}
                                    disabled={isCapturing}
                                />
                                <span>{resolution.label}</span>
                            </label>
                        ))}
                    </div>
                </section>
                <section className="take-photo-section">
                    <h4>File name</h4>
                    <input
                        type="text"
                        className="take-photo-input"
                        value={fileName}
                        onChange={(event) => {
                            setFileName(event.target.value);
                            setFileNameDirty(true);
                        }}
                        placeholder="arcglobe.png"
                        disabled={isCapturing}
                    />
                    <p className="take-photo-hint">PNG is saved locally and never leaves the browser.</p>
                </section>
                {error && <div className="take-photo-alert error">{error}</div>}
                {success && <div className="take-photo-alert success">{success}</div>}
            </div>
            <div className="take-photo-footer">
                <button type="button" className="take-photo-button secondary" onClick={onClose} disabled={isCapturing}>
                    Cancel
                </button>
                <button type="button" className="take-photo-button primary" onClick={handleCapture} disabled={isCapturing}>
                    {isCapturing ? 'Capturing…' : `Download ${selectedResolution.label}`}
                </button>
            </div>
        </div>
    );
};


