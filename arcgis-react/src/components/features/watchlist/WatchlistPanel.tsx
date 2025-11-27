import React, { useEffect, useMemo, useRef, useState } from 'react';
import { watchlistService, type WatchlistImportResult, type WatchlistMutationResult, type WatchlistState } from '~/services/watchlistService';
import '~/styles/features/Watchlist.css';

interface WatchlistPanelProps {
    isVisible: boolean;
    onClose: () => void;
    onFocusSatellite: (id: number) => void;
}

type FeedbackKind = 'success' | 'error' | 'info';

interface FeedbackState {
    kind: FeedbackKind;
    message: string;
}

const buildTimestamp = () => {
    const now = new Date();
    const pad = (value: number) => value.toString().padStart(2, '0');
    return `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}_${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
};

const summarizeMutation = (result: WatchlistMutationResult): FeedbackState | null => {
    const parts: string[] = [];
    if (result.added.length > 0) {
        parts.push(`Added ${result.added.length.toLocaleString()} satellite${result.added.length === 1 ? '' : 's'}`);
    }
    if (result.duplicates.length > 0) {
        parts.push(`${result.duplicates.length.toLocaleString()} duplicate${result.duplicates.length === 1 ? '' : 's'} skipped`);
    }
    if (result.missing.length > 0) {
        parts.push(`${result.missing.length.toLocaleString()} not found`);
    }
    if (!parts.length) {
        return null;
    }
    const hasAdded = result.added.length > 0;
    return {
        kind: hasAdded ? 'success' : 'info',
        message: parts.join(' • ')
    };
};

export const WatchlistPanel: React.FC<WatchlistPanelProps> = ({ isVisible, onClose, onFocusSatellite }) => {
    const [state, setState] = useState<WatchlistState>(() => watchlistService.getState());
    const [inputValue, setInputValue] = useState('');
    const [feedback, setFeedback] = useState<FeedbackState | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const fileInputRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
        let cancelled = false;
        watchlistService.hydrate().catch((error) => {
            if (!cancelled) {
                console.warn('WatchlistPanel: hydrate failed', error);
            }
        });
        const unsubscribe = watchlistService.subscribe((next) => {
            setState(next);
        });
        return () => {
            cancelled = true;
            unsubscribe();
        };
    }, []);

    useEffect(() => {
        if (!feedback) return;
        const timeout = setTimeout(() => setFeedback(null), 5000);
        return () => clearTimeout(timeout);
    }, [feedback]);

    const satellites = useMemo(() => state.satellites, [state.satellites]);

    const handleAdd = () => {
        const trimmed = inputValue.trim();
        if (!trimmed) {
            setFeedback({ kind: 'error', message: 'Enter one or more NORAD IDs (comma or space separated).' });
            return;
        }
        const result = watchlistService.addFromInput(trimmed);
        const summary = summarizeMutation(result);
        if (summary) {
            setFeedback(summary);
        } else {
            setFeedback({ kind: 'info', message: 'No satellites were added.' });
        }
        if (result.added.length > 0) {
            setInputValue('');
        }
    };

    const handleRemove = (id: number) => {
        watchlistService.remove(id);
        setFeedback({ kind: 'info', message: 'Satellite removed from watchlist.' });
    };

    const handleClear = () => {
        if (satellites.length === 0) {
            setFeedback({ kind: 'info', message: 'Watchlist is already empty.' });
            return;
        }
        const confirmClear = window.confirm(`Remove all ${satellites.length.toLocaleString()} satellites from the watchlist?`);
        if (!confirmClear) {
            return;
        }
        watchlistService.clear();
        setFeedback({ kind: 'info', message: 'Watchlist cleared.' });
    };

    const handleExport = () => {
        const payload = watchlistService.export();
        const blob = new Blob([payload], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        try {
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = `watchlist-${buildTimestamp()}.json`;
            anchor.rel = 'noopener';
            anchor.click();
            setFeedback({ kind: 'success', message: 'Watchlist exported as JSON.' });
        } finally {
            setTimeout(() => URL.revokeObjectURL(url), 0);
        }
    };

    const handleImportClick = () => {
        fileInputRef.current?.click();
    };

    const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) {
            return;
        }
        setIsProcessing(true);
        try {
            const text = await file.text();
            const result: WatchlistImportResult = watchlistService.importFromJson(text);
            const messageParts: string[] = [];
            if (result.added.length > 0) {
                messageParts.push(`Loaded ${result.added.length.toLocaleString()} satellite${result.added.length === 1 ? '' : 's'}`);
            }
            if (result.missing.length > 0) {
                messageParts.push(`${result.missing.length.toLocaleString()} not found`);
            }
            if (messageParts.length === 0) {
                messageParts.push('Imported watchlist file.');
            }
            setFeedback({ kind: 'success', message: messageParts.join(' • ') });
        } catch (error) {
            console.error('WatchlistPanel: failed to import watchlist', error);
            setFeedback({ kind: 'error', message: 'Unable to import file. Ensure it is a JSON array of NORAD IDs.' });
        } finally {
            setIsProcessing(false);
        }
    };

    return (
        <div className={`watchlist-panel ${isVisible ? 'visible' : ''}`}>
            <div className="watchlist-header">
                <h3>Watchlist</h3>
                <button type="button" className="watchlist-close" onClick={onClose} aria-label="Close watchlist panel">
                    ✕
                </button>
            </div>
            <div className="watchlist-body">
                <section className="watchlist-section">
                    <h4>Add satellites</h4>
                    <div className="watchlist-add-row">
                        <input
                            type="text"
                            className="watchlist-input"
                            value={inputValue}
                            disabled={isProcessing}
                            placeholder="e.g. 25544, 20580, 43013"
                            onChange={(event) => setInputValue(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                    event.preventDefault();
                                    handleAdd();
                                }
                            }}
                        />
                        <button
                            type="button"
                            className="watchlist-button primary"
                            onClick={handleAdd}
                            disabled={isProcessing}
                        >
                            Add
                        </button>
                    </div>
                    <p className="watchlist-hint">Separate multiple NORAD IDs with commas or spaces.</p>
                </section>

                <section className="watchlist-section">
                    <h4>Actions</h4>
                    <div className="watchlist-actions">
                        <button type="button" className="watchlist-button secondary" onClick={handleExport} disabled={satellites.length === 0 || isProcessing}>
                            Export JSON
                        </button>
                        <button type="button" className="watchlist-button secondary" onClick={handleImportClick} disabled={isProcessing}>
                            Import JSON
                        </button>
                        <button type="button" className="watchlist-button danger" onClick={handleClear} disabled={satellites.length === 0 || isProcessing}>
                            Clear List
                        </button>
                        <input
                            type="file"
                            accept="application/json"
                            ref={fileInputRef}
                            style={{ display: 'none' }}
                            onChange={handleFileChange}
                        />
                    </div>
                </section>

                {feedback && (
                    <div className={`watchlist-feedback ${feedback.kind}`}>
                        {feedback.message}
                    </div>
                )}

                <section className="watchlist-section">
                    <div className="watchlist-list-header">
                        <h4>Tracked Satellites</h4>
                        <span className="watchlist-count">{satellites.length.toLocaleString()}</span>
                    </div>
                    {satellites.length === 0 ? (
                        <div className="watchlist-empty">
                            <p>No satellites in watchlist. Add NORAD IDs to begin tracking.</p>
                        </div>
                    ) : (
                        <div className="watchlist-list">
                            {satellites.map((satellite) => (
                                <div key={satellite.id} className="watchlist-item">
                                    <div className="watchlist-item-main">
                                        <div className="watchlist-row">
                                            <span className="watchlist-norad">{satellite.norad || satellite.id}</span>
                                            <span className="watchlist-name">{satellite.name || 'Unknown'}</span>
                                        </div>
                                        <div className="watchlist-tags">
                                            {satellite.country && <span className="watchlist-tag">{satellite.country}</span>}
                                            {satellite.objectType && <span className="watchlist-tag">{satellite.objectType}</span>}
                                        </div>
                                    </div>
                                    <div className="watchlist-item-actions">
                                        <button
                                            type="button"
                                            className="watchlist-button tertiary"
                                            onClick={() => onFocusSatellite(satellite.id)}
                                            disabled={isProcessing}
                                        >
                                            Focus
                                        </button>
                                        <button
                                            type="button"
                                            className="watchlist-button tertiary"
                                            onClick={() => handleRemove(satellite.id)}
                                            disabled={isProcessing}
                                        >
                                            Remove
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </section>
            </div>
            <div className="watchlist-footer">
                <button type="button" className="watchlist-button secondary" onClick={onClose} disabled={isProcessing}>
                    Close
                </button>
            </div>
        </div>
    );
};


