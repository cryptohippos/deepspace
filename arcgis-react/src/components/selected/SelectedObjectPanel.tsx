import React, { useEffect, useMemo, useState } from 'react';
import type { SatelliteData } from '../../services/satelliteService';
import { watchlistService, type WatchlistState } from '../../services/watchlistService';

interface SelectedObjectPanelProps {
    satellite: SatelliteData | null;
}

const FALLBACK_IMAGE = '/images/satellite-placeholder.svg';
const EARTH_RADIUS_KM = 6378.137;
const EARTH_MU = 398600.4418; // km^3 / s^2

const formatLaunchDate = (value: string | undefined): string | undefined => {
    if (!value) return undefined;
    try {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) {
            return undefined;
        }
        return date.toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    } catch (error) {
        console.warn('[SelectedObjectPanel] Failed to format launch date', value, error);
        return undefined;
    }
};

const formatNumber = (value: number | undefined, options: Intl.NumberFormatOptions & { unitSuffix?: string } = {}) => {
    if (value === undefined || Number.isNaN(value)) return undefined;
    const { unitSuffix, ...formatterOptions } = options;
    const formatted = value.toLocaleString(undefined, formatterOptions);
    return unitSuffix ? `${formatted} ${unitSuffix}` : formatted;
};

const formatAngle = (value: number | undefined) => {
    const formatted = formatNumber(value, { maximumFractionDigits: 2, minimumFractionDigits: 2 });
    return formatted ? `${formatted}°` : undefined;
};

const formatKilometers = (value: number | undefined) => {
    if (value === undefined || Number.isNaN(value)) return undefined;
    return `${Math.max(0, value).toLocaleString(undefined, { maximumFractionDigits: 0 })} km`;
};

const parseTleDerivedMetrics = (tle1?: string, tle2?: string) => {
    if (!tle2 || tle2.length < 69) {
        return null;
    }

    try {
        const line2 = tle2.padEnd(69, ' ');
        const inclinationDeg = parseFloat(line2.substring(8, 16));
        const raanDeg = parseFloat(line2.substring(17, 25));
        const eccentricityRaw = line2.substring(26, 33).trim();
        const argumentPerigeeDeg = parseFloat(line2.substring(34, 42));
        const meanAnomalyDeg = parseFloat(line2.substring(43, 51));
        const meanMotionRevsPerDay = parseFloat(line2.substring(52, 63));

        const eccentricity = eccentricityRaw ? parseFloat(`0.${eccentricityRaw}`) : undefined;

        let perigeeKm: number | undefined;
        let apogeeKm: number | undefined;
        let semiMajorAxisKm: number | undefined;
        let orbitalPeriodMinutes: number | undefined;

        if (!Number.isNaN(meanMotionRevsPerDay) && meanMotionRevsPerDay > 0) {
            const meanMotionRadPerSec = meanMotionRevsPerDay * 2 * Math.PI / 86400;
            semiMajorAxisKm = Math.cbrt(EARTH_MU / (meanMotionRadPerSec * meanMotionRadPerSec));
            if (semiMajorAxisKm && eccentricity !== undefined) {
                perigeeKm = semiMajorAxisKm * (1 - eccentricity) - EARTH_RADIUS_KM;
                apogeeKm = semiMajorAxisKm * (1 + eccentricity) - EARTH_RADIUS_KM;
            }
            orbitalPeriodMinutes = 1440 / meanMotionRevsPerDay;
        }

        return {
            inclinationDeg,
            raanDeg,
            eccentricity,
            argumentPerigeeDeg,
            meanAnomalyDeg,
            meanMotionRevsPerDay,
            semiMajorAxisKm,
            perigeeKm,
            apogeeKm,
            orbitalPeriodMinutes
        };
    } catch (error) {
        console.warn('[SelectedObjectPanel] Failed to parse TLE metrics', { tle1, tle2, error });
        return null;
    }
};

const buildAttributes = (satellite: SatelliteData | null) => {
    if (!satellite) return [] as Array<{ label: string; value: string }>;
    const launchDate = formatLaunchDate(satellite.launchDate);
    const attributes: Array<{ label: string; value: string }> = [];

    if (satellite.norad) {
        attributes.push({ label: 'NORAD', value: satellite.norad });
    }
    if (satellite.country) {
        attributes.push({ label: 'Country', value: satellite.country });
    }
    if (launchDate) {
        attributes.push({ label: 'Launch Date', value: launchDate });
    }
    if (satellite.source) {
        attributes.push({ label: 'Source', value: satellite.source });
    }
    if (satellite.type !== undefined && satellite.type !== null) {
        attributes.push({ label: 'Catalog Type', value: satellite.type.toString() });
    }

    const metrics = parseTleDerivedMetrics(satellite.tle1, satellite.tle2);
    if (metrics) {
        const {
            inclinationDeg,
            raanDeg,
            eccentricity,
            argumentPerigeeDeg,
            meanAnomalyDeg,
            meanMotionRevsPerDay,
            semiMajorAxisKm,
            perigeeKm,
            apogeeKm,
            orbitalPeriodMinutes
        } = metrics;

        const formattedValues: Array<{ label: string; value: string | undefined }> = [
            { label: 'Inclination', value: formatAngle(inclinationDeg) },
            { label: 'RAAN', value: formatAngle(raanDeg) },
            { label: 'Argument of Perigee', value: formatAngle(argumentPerigeeDeg) },
            { label: 'Mean Anomaly', value: formatAngle(meanAnomalyDeg) },
            { label: 'Eccentricity', value: formatNumber(eccentricity, { maximumFractionDigits: 5, minimumFractionDigits: 1 }) },
            { label: 'Mean Motion', value: formatNumber(meanMotionRevsPerDay, { maximumFractionDigits: 4, minimumFractionDigits: 4, unitSuffix: 'rev/day' }) },
            { label: 'Orbital Period', value: formatNumber(orbitalPeriodMinutes, { maximumFractionDigits: 1, minimumFractionDigits: 1, unitSuffix: 'min' }) },
            { label: 'Semi-major Axis', value: formatKilometers(semiMajorAxisKm) },
            { label: 'Perigee Altitude', value: formatKilometers(perigeeKm) },
            { label: 'Apogee Altitude', value: formatKilometers(apogeeKm) }
        ];

        formattedValues
            .filter(({ value }) => Boolean(value))
            .forEach(({ label, value }) => attributes.push({ label, value: value as string }));
    }

    if (satellite.tle1) {
        attributes.push({ label: 'TLE Line 1', value: satellite.tle1 });
    }
    if (satellite.tle2) {
        attributes.push({ label: 'TLE Line 2', value: satellite.tle2 });
    }

    return attributes;
};

const guessSatelliteImage = (satellite: SatelliteData | null): string => {
    if (!satellite) return FALLBACK_IMAGE;
    // Placeholder for future per-object images; keep deterministic path for overrides.
    return FALLBACK_IMAGE;
};

export const SelectedObjectPanel: React.FC<SelectedObjectPanelProps> = ({ satellite }) => {
    const [hasError, setHasError] = useState(false);
    const [hasLoaded, setHasLoaded] = useState(false);
    const [isCollapsed, setIsCollapsed] = useState(false);
    const [isOnWatchlist, setIsOnWatchlist] = useState(false);
    const imageSrc = useMemo(() => (hasError ? FALLBACK_IMAGE : guessSatelliteImage(satellite)), [hasError, satellite]);
    const attributes = useMemo(() => buildAttributes(satellite), [satellite]);

    useEffect(() => {
        const satId = satellite?.id;
        if (satId === undefined || satId === null) {
            setIsOnWatchlist(false);
            return;
        }
        const handleUpdate = (state: WatchlistState) => {
            setIsOnWatchlist(state.ids.includes(satId));
        };
        handleUpdate(watchlistService.getState());
        const unsubscribe = watchlistService.subscribe(handleUpdate);
        return unsubscribe;
    }, [satellite?.id]);

    if (!satellite) {
        return null;
    }

    const toggleCollapse = () => {
        setIsCollapsed((prev) => !prev);
    };

    const handleToggleWatchlist = () => {
        if (!satellite) return;
        const next = watchlistService.toggle(satellite.id);
        setIsOnWatchlist(next);
    };

    return (
        <div className={`selected-object-panel${isCollapsed ? ' collapsed' : ''}`}>
            <div className="selected-object-header">
                <span className="selected-object-title">{satellite.name}</span>
                <div className="selected-object-actions">
                    <button
                        type="button"
                        className={`selected-object-watchlist${isOnWatchlist ? ' active' : ''}`}
                        onClick={handleToggleWatchlist}
                        aria-pressed={isOnWatchlist}
                        title={isOnWatchlist ? 'Remove from Watchlist' : 'Add to Watchlist'}
                    >
                        {isOnWatchlist ? '★ Watchlist' : '☆ Watchlist'}
                    </button>
                    <button className="selected-object-toggle" onClick={toggleCollapse} type="button" aria-label={isCollapsed ? 'Expand details' : 'Collapse details'}>
                        {isCollapsed ? 'Expand' : 'Collapse'}
                    </button>
                </div>
            </div>
            {!isCollapsed && (
                <div className="selected-object-body">
                    <div className={`selected-object-image-wrapper${hasLoaded ? ' is-visible' : ''}`}>
                        <img
                            className="selected-object-image"
                            src={imageSrc}
                            alt={satellite.name}
                            onError={() => {
                                setHasError(true);
                                setHasLoaded(false);
                            }}
                            onLoad={() => setHasLoaded(true)}
                        />
                    </div>
                    <dl className="selected-object-attributes">
                        {attributes.map(({ label, value }) => (
                            <div key={label} className="selected-object-attribute">
                                <dt>{label}</dt>
                                <dd>{value}</dd>
                            </div>
                        ))}
                    </dl>
                </div>
            )}
        </div>
    );
};
