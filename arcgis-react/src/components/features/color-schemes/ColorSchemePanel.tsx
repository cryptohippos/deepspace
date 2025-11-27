import React, { useEffect, useMemo, useState } from 'react';
import type { ColorSchemeDefinition, ColorSchemeId, RgbaColor } from '~/services/colorSchemeService';
import { colorSchemeService } from '~/services/colorSchemeService';
import '~/styles/features/ColorSchemes.css';

interface ColorSchemePanelProps {
    isVisible: boolean;
    onClose: () => void;
}

const rgbaToCss = (color: RgbaColor): string => {
    const [r, g, b, a] = color;
    return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${a})`;
};

export const ColorSchemePanel: React.FC<ColorSchemePanelProps> = ({ isVisible, onClose }) => {
    const [schemes, setSchemes] = useState<ColorSchemeDefinition[]>(() => colorSchemeService.getSchemes());
    const [activeSchemeId, setActiveSchemeId] = useState<ColorSchemeId>(colorSchemeService.getActiveScheme().id);

    useEffect(() => {
        const unsubscribe = colorSchemeService.subscribe(({ scheme }) => {
            setActiveSchemeId(scheme.id);
            setSchemes(colorSchemeService.getSchemes());
        });
        return unsubscribe;
    }, []);

    const handleSelect = (id: ColorSchemeId) => {
        colorSchemeService.setScheme(id);
        setActiveSchemeId(id);
    };

    const content = useMemo(() => schemes.map((scheme) => {
        const isActive = scheme.id === activeSchemeId;
        return (
            <li
                key={scheme.id}
                className={`color-scheme-item ${isActive ? 'active' : ''}`}
                onClick={() => handleSelect(scheme.id)}
                onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        handleSelect(scheme.id);
                    }
                }}
                role="button"
                tabIndex={0}
                aria-pressed={isActive}
            >
                <div className="color-scheme-item__header">
                    <span className="color-scheme-item__name">{scheme.label}</span>
                    {isActive && <span className="color-scheme-item__badge">Active</span>}
                </div>
                {scheme.description && (
                    <p className="color-scheme-item__description">{scheme.description}</p>
                )}
                {scheme.legend && scheme.legend.length > 0 && (
                    <div className="color-scheme-legend">
                        {scheme.legend.map((entry, index) => (
                            <div key={`${scheme.id}-legend-${index}`} className="color-scheme-legend__row">
                                <span
                                    className="color-scheme-legend__swatch"
                                    style={{ backgroundColor: rgbaToCss(entry.color) }}
                                />
                                <span className="color-scheme-legend__label">{entry.label}</span>
                            </div>
                        ))}
                    </div>
                )}
            </li>
        );
    }), [activeSchemeId, schemes]);

    return (
        <div className={`color-scheme-panel ${isVisible ? 'visible' : ''}`}>
            <div className="color-scheme-header">
                <h3>Color Schemes</h3>
                <button type="button" className="color-scheme-close" onClick={onClose} aria-label="Close color schemes">
                    ✕
                </button>
            </div>
            <div className="color-scheme-body">
                {schemes.length === 0 ? (
                    <div className="color-scheme-empty">
                        <p>No color schemes available.</p>
                    </div>
                ) : (
                    <ul className="color-scheme-list">
                        {content}
                    </ul>
                )}
            </div>
        </div>
    );
};

