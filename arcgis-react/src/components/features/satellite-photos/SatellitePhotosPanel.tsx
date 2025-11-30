import React, { useEffect, useMemo, useState } from 'react';
import { satellitePhotoService, type SatellitePhoto, type SatellitePhotoProvider } from '~/services/satellitePhotoService';
import '~/styles/features/SatellitePhotos.css';

interface SatellitePhotosPanelProps {
    isVisible: boolean;
    onClose: () => void;
    onFocusSatellite: (noradId: number) => void;
}

interface ProviderState {
    loading: boolean;
    error: string | null;
    photos: SatellitePhoto[];
}

const MAX_COLUMNS = 2;

export const SatellitePhotosPanel: React.FC<SatellitePhotosPanelProps> = ({ isVisible, onClose, onFocusSatellite }) => {
    const providers = useMemo(() => satellitePhotoService.getProviders(), []);
    const [providerStates, setProviderStates] = useState<Record<string, ProviderState>>(() =>
        providers.reduce((acc, provider) => {
            acc[provider.id] = { loading: false, error: null, photos: [] };
            return acc;
        }, {} as Record<string, ProviderState>)
    );
    const [activePhoto, setActivePhoto] = useState<SatellitePhoto | null>(null);

    useEffect(() => {
        if (!isVisible) {
            return;
        }

        let cancelled = false;
        const loadAll = async () => {
            for (const provider of providers) {
                setProviderStates((prev) => ({
                    ...prev,
                    [provider.id]: { ...prev[provider.id], loading: true, error: null }
                }));
                try {
                    const photos = await satellitePhotoService.getPhotos(provider.id);
                    if (cancelled) {
                        return;
                    }
                    setProviderStates((prev) => ({
                        ...prev,
                        [provider.id]: { loading: false, error: null, photos }
                    }));
                } catch (error) {
                    setProviderStates((prev) => ({
                        ...prev,
                        [provider.id]: {
                            loading: false,
                            error: error instanceof Error ? error.message : 'Unable to load imagery.',
                            photos: prev[provider.id]?.photos ?? []
                        }
                    }));
                }
            }
        };

        loadAll();
        const unsubscribe = satellitePhotoService.subscribe((providerId, photos) => {
            setProviderStates((prev) => ({
                ...prev,
                [providerId]: { loading: false, error: null, photos }
            }));
        });
        return () => {
            cancelled = true;
            unsubscribe();
        };
    }, [isVisible, providers]);

    const handleRefresh = async (provider: SatellitePhotoProvider) => {
        setProviderStates((prev) => ({
            ...prev,
            [provider.id]: { ...prev[provider.id], loading: true, error: null }
        }));
        try {
            const photos = await satellitePhotoService.refresh(provider.id);
            setProviderStates((prev) => ({
                ...prev,
                [provider.id]: { loading: false, error: null, photos }
            }));
        } catch (error) {
            setProviderStates((prev) => ({
                ...prev,
                [provider.id]: {
                    loading: false,
                    error: error instanceof Error ? error.message : 'Unable to refresh imagery.',
                    photos: prev[provider.id]?.photos ?? []
                }
            }));
        }
    };

    const handleFocus = (photo: SatellitePhoto, provider: SatellitePhotoProvider) => {
        const noradId = photo.noradId ?? provider.noradId;
        if (typeof noradId === 'number') {
            onFocusSatellite(noradId);
        }
    };

    return (
        <div className={`satellite-photos-panel ${isVisible ? 'visible' : ''}`}>
            <div className="satellite-photos-header">
                <h3>Satellite Photos</h3>
                <button className="satellite-photos-close" onClick={onClose} type="button" aria-label="Close satellite photos panel">
                    ✕
                </button>
            </div>
            <div className="satellite-photos-body">
                {providers.map((provider) => {
                    const state = providerStates[provider.id] ?? { loading: false, error: null, photos: [] };
                    return (
                        <section key={provider.id} className="satellite-provider-section">
                            <header className="satellite-provider-header">
                                <div>
                                    <h4>{provider.name}</h4>
                                    {provider.description && <p className="satellite-provider-description">{provider.description}</p>}
                                </div>
                                <div className="satellite-provider-actions">
                                    <button
                                        type="button"
                                        className="satellite-photos-button secondary"
                                        onClick={() => handleRefresh(provider)}
                                        disabled={state.loading}
                                    >
                                        Refresh
                                    </button>
                                    {provider.noradId && (
                                        <button
                                            type="button"
                                            className="satellite-photos-button tertiary"
                                            onClick={() => onFocusSatellite(provider.noradId!)}
                                            disabled={state.loading}
                                        >
                                            Focus Sat
                                        </button>
                                    )}
                                </div>
                            </header>
                            {state.loading && state.photos.length === 0 && (
                                <div className="satellite-provider-loading">
                                    <div className="spinner" />
                                    <span>Loading imagery…</span>
                                </div>
                            )}
                            {state.error && state.photos.length === 0 && (
                                <div className="satellite-provider-error">
                                    {state.error}
                                </div>
                            )}
                            <div
                                className="satellite-photo-grid"
                                style={{ gridTemplateColumns: `repeat(${Math.min(MAX_COLUMNS, Math.max(1, state.photos.length))}, minmax(0, 1fr))` }}
                            >
                                {state.photos.map((photo) => (
                                    <article key={photo.id} className="satellite-photo-card">
                                        <div className="satellite-photo-thumb" onClick={() => setActivePhoto(photo)}>
                                            <img src={photo.imageUrl} alt={photo.label} loading="lazy" />
                                        </div>
                                        <div className="satellite-photo-meta">
                                            <div className="satellite-photo-title">{photo.label}</div>
                                            {photo.captureTime && <div className="satellite-photo-time">{new Date(photo.captureTime).toUTCString()}</div>}
                                            {photo.attribution && <div className="satellite-photo-attribution">{photo.attribution}</div>}
                                        </div>
                                        <div className="satellite-photo-actions">
                                            <button
                                                type="button"
                                                className="satellite-photos-button primary"
                                                onClick={() => setActivePhoto(photo)}
                                            >
                                                View
                                            </button>
                                            <button
                                                type="button"
                                                className="satellite-photos-button tertiary"
                                                onClick={() => handleFocus(photo, provider)}
                                                disabled={!photo.noradId && !provider.noradId}
                                            >
                                                Focus
                                            </button>
                                            <button
                                                type="button"
                                                className="satellite-photos-button tertiary"
                                                onClick={() => window.open(photo.imageUrl, '_blank', 'noopener')}
                                            >
                                                Open
                                            </button>
                                        </div>
                                    </article>
                                ))}
                            </div>
                            {state.photos.length === 0 && !state.loading && !state.error && (
                                <div className="satellite-provider-empty">
                                    No imagery available.
                                </div>
                            )}
                        </section>
                    );
                })}
            </div>
            {activePhoto && (
                <PhotoLightbox
                    photo={activePhoto}
                    onClose={() => setActivePhoto(null)}
                />
            )}
        </div>
    );
};

interface PhotoLightboxProps {
    photo: SatellitePhoto;
    onClose: () => void;
}

const PhotoLightbox: React.FC<PhotoLightboxProps> = ({ photo, onClose }) => {
    return (
        <div className="satellite-photo-lightbox">
            <div className="satellite-photo-lightbox-backdrop" onClick={onClose} />
            <div className="satellite-photo-lightbox-content">
                <header className="satellite-photo-lightbox-header">
                    <div>
                        <h4>{photo.label}</h4>
                        {photo.captureTime && <span>{new Date(photo.captureTime).toUTCString()}</span>}
                    </div>
                    <button type="button" className="satellite-photo-lightbox-close" onClick={onClose} aria-label="Close photo viewer">
                        ✕
                    </button>
                </header>
                <div className="satellite-photo-lightbox-body">
                    <img src={photo.imageUrl} alt={photo.label} />
                </div>
                <footer className="satellite-photo-lightbox-footer">
                    {photo.attribution && <span>{photo.attribution}</span>}
                    <div className="satellite-photo-lightbox-actions">
                        <button type="button" onClick={() => window.open(photo.imageUrl, '_blank', 'noopener')}>
                            Open Original
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                const link = document.createElement('a');
                                link.href = photo.imageUrl;
                                link.download = `${photo.id}.png`;
                                link.rel = 'noopener';
                                link.click();
                            }}
                        >
                            Download
                        </button>
                    </div>
                </footer>
            </div>
        </div>
    );
};


