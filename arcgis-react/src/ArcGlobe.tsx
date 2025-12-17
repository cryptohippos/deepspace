const WGS84_A = 6378137;
const WGS84_E2 = 6.69437999014e-3;
const WGS84_B = WGS84_A * Math.sqrt(1 - WGS84_E2);

const deg2rad = (deg: number) => deg * (Math.PI / 180);
const rad2deg = (rad: number) => rad * (180 / Math.PI);

const geodeticToEcef = (latDeg: number, lonDeg: number, altitudeMeters: number) => {
    const lat = deg2rad(latDeg);
    const lon = deg2rad(lonDeg);
    const cosLat = Math.cos(lat);
    const sinLat = Math.sin(lat);
    const cosLon = Math.cos(lon);
    const sinLon = Math.sin(lon);
    const N = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
    const x = (N + altitudeMeters) * cosLat * cosLon;
    const y = (N + altitudeMeters) * cosLat * sinLon;
    const z = (N * (1 - WGS84_E2) + altitudeMeters) * sinLat;
    return { x, y, z };
};

const ecefToGeodetic = (x: number, y: number, z: number) => {
    const ep2 = (WGS84_A * WGS84_A - WGS84_B * WGS84_B) / (WGS84_B * WGS84_B);
    const p = Math.sqrt(x * x + y * y);
    const theta = Math.atan2(z * WGS84_A, p * WGS84_B);
    const sinTheta = Math.sin(theta);
    const cosTheta = Math.cos(theta);
    const latitude = Math.atan2(z + ep2 * WGS84_B * sinTheta * sinTheta * sinTheta, p - WGS84_E2 * WGS84_A * cosTheta * cosTheta * cosTheta);
    const longitude = Math.atan2(y, x);
    const sinLat = Math.sin(latitude);
    const N = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
    const height = p / Math.cos(latitude) - N;
    return {
        latitude: rad2deg(latitude),
        longitude: rad2deg(longitude),
        height
    };
};

const SENSOR_TINT = [0.2, 0.45, 0.95] as const;
const SENSOR_FOV_COLOR = [80, 165, 255, 0.18] as const;
const SENSOR_FOV_EDGE_COLOR = [80, 165, 255, 0.6] as const;
const MAX_SENSOR_FOV_RANGE_METERS = 60000000; // Clamp to ~60,000 km to avoid degenerate meshes
const MIN_SENSOR_FOV_SAMPLES = 16;
const MAX_SENSOR_FOV_SAMPLES = 72;
const SENSOR_FOV_MIN_STEP_DEG = 5;

const normalizeAzimuth = (value: number | null | undefined): number => {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return 0;
    }
    let result = value % 360;
    if (result < 0) {
        result += 360;
    }
    return result;
};

interface PreparedSensor {
    latitude: number;
    longitude: number;
    altitudeMeters: number;
    ecefX: number;
    ecefY: number;
    ecefZ: number;
    sinLat: number;
    cosLat: number;
    sinLon: number;
    cosLon: number;
    minRange: number;
    maxRange: number;
    minElRad: number;
    maxElRad: number;
    minAz: number;
    maxAz: number;
    azWraps: boolean;
}

const prepareSensor = (sensor: SensorDefinition): PreparedSensor | null => {
    if (sensor.latitude === null || sensor.longitude === null) {
        return null;
    }
    const altitudeMeters = sensor.altitudeMeters ?? 0;
    const latitude = sensor.latitude;
    const longitude = sensor.longitude;
    const latRad = deg2rad(latitude);
    const lonRad = deg2rad(longitude);
    const sinLat = Math.sin(latRad);
    const cosLat = Math.cos(latRad);
    const sinLon = Math.sin(lonRad);
    const cosLon = Math.cos(lonRad);
    const ecef = geodeticToEcef(latitude, longitude, altitudeMeters);
    const minRange = Math.max(0, (sensor.minRangeKm ?? 0) * 1000);
    const maxRangeKm = sensor.maxRangeKm ?? 0;
    const maxRange = maxRangeKm > 0 ? maxRangeKm * 1000 : Number.POSITIVE_INFINITY;
    const minEl = deg2rad(sensor.minElevation ?? 0);
    const maxEl = deg2rad(sensor.maxElevation ?? 90);
    const minAz = normalizeAzimuth(sensor.minAzimuth);
    const maxAz = normalizeAzimuth(sensor.maxAzimuth ?? (sensor.minAzimuth ?? 360));
    return {
        latitude,
        longitude,
        altitudeMeters,
        ecefX: ecef.x,
        ecefY: ecef.y,
        ecefZ: ecef.z,
        sinLat,
        cosLat,
        sinLon,
        cosLon,
        minRange,
        maxRange,
        minElRad: minEl,
        maxElRad: maxEl,
        minAz,
        maxAz,
        azWraps: maxAz < minAz
    };
};

const computeSensorCoverageFlags = (positions: Float32Array, count: number, sensors: SensorDefinition[]): Float32Array => {
    const prepared = sensors
        .map(prepareSensor)
        .filter((entry): entry is PreparedSensor => Boolean(entry));

    const flags = new Float32Array(count);
    if (!prepared.length || !count) {
        return flags;
    }

    for (let i = 0; i < count; i++) {
        const idx = i * 3;
        const lon = positions[idx];
        const lat = positions[idx + 1];
        const altitude = positions[idx + 2];
        if (!Number.isFinite(lon) || !Number.isFinite(lat) || !Number.isFinite(altitude)) {
            continue;
        }
        const sat = geodeticToEcef(lat, lon, altitude);
        for (const sensor of prepared) {
            const dx = sat.x - sensor.ecefX;
            const dy = sat.y - sensor.ecefY;
            const dz = sat.z - sensor.ecefZ;
            const range = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (range < sensor.minRange || range > sensor.maxRange) {
                continue;
            }

            const east = -sensor.sinLon * dx + sensor.cosLon * dy;
            const north = -sensor.sinLat * sensor.cosLon * dx - sensor.sinLat * sensor.sinLon * dy + sensor.cosLat * dz;
            const up = sensor.cosLat * sensor.cosLon * dx + sensor.cosLat * sensor.sinLon * dy + sensor.sinLat * dz;
            const horizontal = Math.sqrt(east * east + north * north);
            const elevation = Math.atan2(up, horizontal);
            if (elevation < sensor.minElRad || elevation > sensor.maxElRad) {
                continue;
            }

            let azimuth = rad2deg(Math.atan2(east, north));
            if (azimuth < 0) azimuth += 360;
            if (sensor.azWraps) {
                if (!(azimuth >= sensor.minAz || azimuth <= sensor.maxAz)) {
                    continue;
                }
            } else if (azimuth < sensor.minAz || azimuth > sensor.maxAz) {
                continue;
            }

            flags[i] = 1;
            break;
        }
    }

    return flags;
};

interface SatcatRecord {
    OBJECT_TYPE?: string;
    OWNER?: string | null;
    OPS_STATUS_CODE?: string | null;
    DATA_STATUS_CODE?: string | null;
}

const SATCAT_HEADERS = {
    NORAD: 'NORAD_CAT_ID',
    OBJECT_TYPE: 'OBJECT_TYPE',
    OWNER: 'OWNER',
    OPS_STATUS: 'OPS_STATUS_CODE',
    DATA_STATUS: 'DATA_STATUS_CODE'
} as const;

const buildSatcatLookup = async (): Promise<Map<string, SatcatRecord>> => {
    try {
        const response = await fetch('/api-keeptrack/v3/satcat/latest', { cache: 'no-cache' });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const csv = await response.text();
        return parseSatcatCsv(csv);
    } catch (error) {
        console.warn('ArcGlobe: Failed to load SATCAT metadata', error);
        return new Map();
    }
};

const parseSatcatCsv = (csv: string): Map<string, SatcatRecord> => {
    const map = new Map<string, SatcatRecord>();
    if (!csv) {
        return map;
    }
    const rows = tokenizeCsv(csv);
    if (!rows.length) {
        return map;
    }
    const headers = rows.shift() ?? [];
    const headerIndex = (name: string) => headers.findIndex((h) => h.toUpperCase() === name);
    const noradIdx = headerIndex(SATCAT_HEADERS.NORAD);
    if (noradIdx === -1) {
        return map;
    }
    const objectTypeIdx = headerIndex(SATCAT_HEADERS.OBJECT_TYPE);
    const ownerIdx = headerIndex(SATCAT_HEADERS.OWNER);
    const opsStatusIdx = headerIndex(SATCAT_HEADERS.OPS_STATUS);
    const dataStatusIdx = headerIndex(SATCAT_HEADERS.DATA_STATUS);

    for (const row of rows) {
        if (!row.length) continue;
        const noradRaw = row[noradIdx]?.trim();
        if (!noradRaw) continue;

        const record: SatcatRecord = {
            OBJECT_TYPE: objectTypeIdx >= 0 ? row[objectTypeIdx]?.trim() ?? undefined : undefined,
            OWNER: ownerIdx >= 0 ? row[ownerIdx]?.trim() ?? null : null,
            OPS_STATUS_CODE: opsStatusIdx >= 0 ? row[opsStatusIdx]?.trim() ?? null : null,
            DATA_STATUS_CODE: dataStatusIdx >= 0 ? row[dataStatusIdx]?.trim() ?? null : null
        };

        registerSatcatEntry(map, noradRaw, record);
    }
    return map;
};

const tokenizeCsv = (input: string): string[][] => {
    const rows: string[][] = [];
    if (!input) {
        return rows;
    }
    let row: string[] = [];
    let field = '';
    let inQuotes = false;
    const len = input.length;
    for (let i = 0; i < len; i++) {
        const char = input[i];
        if (char === '"') {
            if (inQuotes && input[i + 1] === '"') {
                field += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (char === ',' && !inQuotes) {
            row.push(field);
            field = '';
        } else if ((char === '\n' || char === '\r') && !inQuotes) {
            if (char === '\r' && input[i + 1] === '\n') {
                i++;
            }
            row.push(field);
            rows.push(row);
            row = [];
            field = '';
        } else {
            field += char;
        }
    }
    if (field.length || row.length) {
        row.push(field);
        rows.push(row);
    }
    return rows;
};

const registerSatcatEntry = (map: Map<string, SatcatRecord>, id: string, entry: SatcatRecord) => {
    const trimmed = id.trim();
    if (!trimmed) return;
    const variations = new Set<string>([
        trimmed,
        trimmed.padStart(5, '0'),
        trimmed.padStart(6, '0'),
        trimmed.replace(/^0+/, '')
    ]);
    for (const variant of variations) {
        if (variant) {
            map.set(variant, entry);
        }
    }
};

const getSatcatEntry = (map: Map<string, SatcatRecord>, id: string | undefined): SatcatRecord | undefined => {
    if (!id) return undefined;
    const trimmed = id.trim();
    if (!trimmed) return undefined;
    return map.get(trimmed) || map.get(trimmed.replace(/^0+/, '')) || map.get(trimmed.padStart(5, '0')) || map.get(trimmed.padStart(6, '0'));
};

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import SunCalc from 'suncalc';
import type { SensorDefinition } from '~/data/sensors';
import '~/styles/ArcGlobe.css';
import { FeatureHost, type ActiveFeature } from './components/features';
import { type CollisionEvent } from './components/features/CollisionAnalysis';
import { type Constellation } from './components/features/ConstellationAnalysis';
import { type SatelliteFormData } from './components/features/CreateSatellite';
import type { OrbitPlotMode, OrbitPlotSeries } from './components/features/orbit-plots/types';
import { Footer } from './components/footer';
import { Header } from './components/header';
import type { FilterCriteria } from './components/header/FilterPanel';
import { createResetViewHandler } from './components/header/ResetView';
import { SelectedObjectPanel } from './components/selected/SelectedObjectPanel';
import { colorSchemeService } from './services/colorSchemeService';
import { orbitPlotService } from './services/orbitPlotService';
import { satellitePhotoService } from './services/satellitePhotoService';
import { SatelliteService, type SatelliteData } from './services/satelliteService';
import { screenshotService } from './services/screenshotService';
import { sensorService, type SensorSelection } from './services/sensorService';
import { TooltipService } from './services/tooltipService';
import { watchlistService } from './services/watchlistService';

declare global {
    interface Window {
        require: any;
        ArcgisUI?: any;
        ArcgisDataLoader?: any;
        satellite: any;
    }
}

export const ArcGlobe: React.FC = () => {
    const divRef = useRef<HTMLDivElement | null>(null);
    const instancedApiRef = useRef<any>(null);
    const viewRef = useRef<__esri.SceneView | null>(null);
    const tracksLayerRef = useRef<__esri.GraphicsLayer | null>(null);
    const sensorLinesLayerRef = useRef<__esri.GraphicsLayer | null>(null);
    const sensorFovLayerRef = useRef<__esri.GraphicsLayer | null>(null);
    const sensorFovGraphicsRef = useRef<Map<string, __esri.Graphic>>(new Map());
    const sensorFovModulesRef = useRef<{
        Mesh: any;
        MeshSymbol3D: any;
        FillSymbol3DLayer: any;
        SolidEdges3D: any;
        Graphic: any;
    } | null>(null);
    const trackGraphicsRef = useRef<Map<number, __esri.Graphic>>(new Map());
    const selectedIdRef = useRef<number | null>(null);
    const isLoadingRef = useRef(true);
    const sensorLineGraphicsRef = useRef<{ sun: __esri.Graphic | null; moon: __esri.Graphic | null }>({ sun: null, moon: null });
    const coverageFlagsRef = useRef<Float32Array | null>(null);
    const baseColorBufferRef = useRef<Float32Array | null>(null);
    const tintedColorsRef = useRef<Float32Array | null>(null);
    const lastPositionsRef = useRef<Float32Array | null>(null);
    const positionsReadyRef = useRef(false);
    const [isLoading, setIsLoading] = useState(true);
    const satelliteService = SatelliteService.getInstance();
    const tooltipService = TooltipService.getInstance();

    // Menu state
    const [selectedFeature, setSelectedFeature] = useState<string | null>(null);
    const [showCollisionAnalysis, setShowCollisionAnalysis] = useState(false);
    const [showCreateSatellite, setShowCreateSatellite] = useState(false);
    const [showConstellationAnalysis, setShowConstellationAnalysis] = useState(false);
    const [showDebrisScanner, setShowDebrisScanner] = useState(false);
    const [showColorSchemes, setShowColorSchemes] = useState(false);
    const [showTakePhoto, setShowTakePhoto] = useState(false);
    const [showWatchlist, setShowWatchlist] = useState(false);
    const [showSatellitePhotos, setShowSatellitePhotos] = useState(false);
    const [showSensors, setShowSensors] = useState(false);
    const [showSensorInfo, setShowSensorInfo] = useState(false);
    const [showSensorFov, setShowSensorFov] = useState(false);
    const [sensorFovActive, setSensorFovActive] = useState(false);
    const sensorFovActiveRef = useRef(false);
    const [sensorFovMessage, setSensorFovMessage] = useState<string | null>(null);
    const [sunLineActive, setSunLineActive] = useState(false);
    const [moonLineActive, setMoonLineActive] = useState(false);
    const [sensorSelectionState, setSensorSelectionState] = useState<SensorSelection>(() => sensorService.getSelection());
    const sensorSelectionRef = useRef<SensorSelection>(sensorSelectionState);

    const removeSensorLines = useCallback((target?: 'sun' | 'moon') => {
        const layer = sensorLinesLayerRef.current;
        const removeSingle = (kind: 'sun' | 'moon') => {
            const graphic = sensorLineGraphicsRef.current[kind];
            if (!graphic) {
                return;
            }
            if (layer) {
                try {
                    layer.remove(graphic);
                } catch {
                    // ignore
                }
            }
            sensorLineGraphicsRef.current[kind] = null;
        };

        if (!layer) {
            sensorLineGraphicsRef.current.sun = null;
            sensorLineGraphicsRef.current.moon = null;
            return;
        }
        if (target) {
            removeSingle(target);
        } else {
            removeSingle('sun');
            removeSingle('moon');
        }
    }, []);
    const drawSensorLine = useCallback((kind: 'sun' | 'moon') => {
        const layer = sensorLinesLayerRef.current;
        const selection = sensorSelectionRef.current;
        const primaryId = selection.primaryId ?? selection.sensorIds[0];
        if (!layer || !primaryId) {
            return;
        }
        const sensor = sensorService.getSensor(primaryId);
        if (!sensor || sensor.latitude === null || sensor.longitude === null) {
            return;
        }
        const latitude = sensor.latitude;
        const longitude = sensor.longitude;
        const altitudeMeters = sensor.altitudeMeters ?? 0;
        const date = new Date();
        const position = kind === 'sun' ? SunCalc.getPosition(date, latitude, longitude) : SunCalc.getMoonPosition(date, latitude, longitude);
        const adjustedAltitude = Math.max(position.altitude, 0.05);
        const azimuth = (position.azimuth + Math.PI) % (2 * Math.PI);
        const cosAlt = Math.cos(adjustedAltitude);
        const xEast = cosAlt * Math.sin(azimuth);
        const yNorth = cosAlt * Math.cos(azimuth);
        const zUp = Math.sin(adjustedAltitude);
        const latRad = deg2rad(latitude);
        const lonRad = deg2rad(longitude);
        const sinLat = Math.sin(latRad);
        const cosLat = Math.cos(latRad);
        const sinLon = Math.sin(lonRad);
        const cosLon = Math.cos(lonRad);
        const dirX = -sinLon * xEast - sinLat * cosLon * yNorth + cosLat * cosLon * zUp;
        const dirY = cosLon * xEast - sinLat * sinLon * yNorth + cosLat * sinLon * zUp;
        const dirZ = cosLat * yNorth + sinLat * zUp;
        const dirLength = Math.hypot(dirX, dirY, dirZ);
        if (!dirLength) {
            return;
        }
        const { x: baseX, y: baseY, z: baseZ } = geodeticToEcef(latitude, longitude, altitudeMeters);
        const distanceMeters = kind === 'sun'
            ? 600000000
            : Math.min(Math.max((position.distance ?? 384400) * 1000, 200000000), 500000000);
        const scale = distanceMeters / dirLength;
        const endEcefX = baseX + dirX * scale;
        const endEcefY = baseY + dirY * scale;
        const endEcefZ = baseZ + dirZ * scale;
        const endGeo = ecefToGeodetic(endEcefX, endEcefY, endEcefZ);
        const path = [
            [longitude, latitude, altitudeMeters],
            [endGeo.longitude, endGeo.latitude, endGeo.height]
        ];
        removeSensorLines(kind);
        const graphic = layer.add({
            geometry: {
                type: 'polyline',
                paths: [path],
                spatialReference: { wkid: 4326 }
            },
            symbol: {
                type: 'simple-line',
                color: kind === 'sun' ? [255, 210, 110, 0.9] : [150, 200, 255, 0.9],
                width: 3
            }
        } as __esri.Graphic);
        sensorLineGraphicsRef.current[kind] = graphic ?? null;
    }, [removeSensorLines]);

    const clearSensorFov = useCallback(() => {
        const layer = sensorFovLayerRef.current;
        if (layer) {
            try {
                layer.removeAll();
            } catch {
                // ignore
            }
        }
        sensorFovGraphicsRef.current.clear();
    }, []);

    const createSensorFovGraphic = useCallback((sensor: SensorDefinition) => {
        const modules = sensorFovModulesRef.current;
        if (!modules) {
            return null;
        }
        const prepared = prepareSensor(sensor);
        if (!prepared) {
            return null;
        }

        const { Mesh, MeshSymbol3D, FillSymbol3DLayer, SolidEdges3D, Graphic } = modules;

        let maxElevation = prepared.maxElRad;
        if (!Number.isFinite(maxElevation) || maxElevation <= 0) {
            maxElevation = deg2rad(5);
        }

        let minElevation = prepared.minElRad;
        if (!Number.isFinite(minElevation) || minElevation < 0) {
            minElevation = 0;
        }

        if (maxElevation - minElevation < deg2rad(0.5)) {
            maxElevation = Math.min(maxElevation + deg2rad(0.25), deg2rad(89));
            minElevation = Math.max(minElevation - deg2rad(0.25), 0);
        }

        let minAz = prepared.minAz;
        let maxAz = prepared.maxAz;
        if (prepared.azWraps) {
            maxAz += 360;
        }
        let span = maxAz - minAz;
        if (!Number.isFinite(span) || span <= 0) {
            span = 360;
            minAz = 0;
        }

        const sampleCount = Math.min(
            MAX_SENSOR_FOV_SAMPLES,
            Math.max(MIN_SENSOR_FOV_SAMPLES, Math.ceil(span / SENSOR_FOV_MIN_STEP_DEG))
        );

        const rawMaxRange = Number.isFinite(prepared.maxRange) ? prepared.maxRange : MAX_SENSOR_FOV_RANGE_METERS;
        const baseFarDistance = Math.min(Math.max(rawMaxRange, 1000), MAX_SENSOR_FOV_RANGE_METERS);
        if (!Number.isFinite(baseFarDistance) || baseFarDistance <= 0) {
            return null;
        }

        const baseNearDistance = Math.max(prepared.minRange, 1000);

        const computeDirection = (azDeg: number, elevation: number) => {
            const azRad = deg2rad(azDeg);
            const cosEl = Math.cos(elevation);
            const sinEl = Math.sin(elevation);
            const xEast = cosEl * Math.sin(azRad);
            const yNorth = cosEl * Math.cos(azRad);
            const zUp = sinEl;

            const dirX = -prepared.sinLon * xEast - prepared.sinLat * prepared.cosLon * yNorth + prepared.cosLat * prepared.cosLon * zUp;
            const dirY = prepared.cosLon * xEast - prepared.sinLat * prepared.sinLon * yNorth + prepared.cosLat * prepared.sinLon * zUp;
            const dirZ = prepared.cosLat * yNorth + prepared.sinLat * zUp;
            const length = Math.hypot(dirX, dirY, dirZ);
            if (!length) {
                return null;
            }
            return {
                x: dirX / length,
                y: dirY / length,
                z: dirZ / length
            };
        };

        const intersectEarth = (dir: { x: number; y: number; z: number }) => {
            const b = 2 * (prepared.ecefX * dir.x + prepared.ecefY * dir.y + prepared.ecefZ * dir.z);
            const c = prepared.ecefX * prepared.ecefX + prepared.ecefY * prepared.ecefY + prepared.ecefZ * prepared.ecefZ - WGS84_A * WGS84_A;
            const discriminant = b * b - 4 * c;
            if (discriminant < 0) {
                return null;
            }
            const sqrt = Math.sqrt(discriminant);
            const t1 = (-b - sqrt) / 2;
            const t2 = (-b + sqrt) / 2;
            const candidates = [t1, t2].filter((value) => value > 0);
            if (!candidates.length) {
                return null;
            }
            return Math.min(...candidates);
        };

        const nearMaxRing: Array<{ lon: number; lat: number; height: number }> = [];
        const nearMinRing: Array<{ lon: number; lat: number; height: number }> = [];
        const farMaxRing: Array<{ lon: number; lat: number; height: number }> = [];
        const farMinRing: Array<{ lon: number; lat: number; height: number }> = [];

        for (let i = 0; i < sampleCount; i++) {
            const fraction = i / sampleCount;
            const azDeg = minAz + span * fraction;
            const normalizedAz = ((azDeg % 360) + 360) % 360;

            const maxDir = computeDirection(normalizedAz, maxElevation);
            const minDir = computeDirection(normalizedAz, minElevation);
            if (!maxDir || !minDir) {
                continue;
            }

            let nearDistance = baseNearDistance;
            const earthDistance = intersectEarth(minDir);
            if (earthDistance && earthDistance > 0) {
                nearDistance = Math.max(nearDistance, Math.min(earthDistance, baseFarDistance * 0.95));
            }
            if (nearDistance >= baseFarDistance) {
                nearDistance = Math.max(1000, baseFarDistance * 0.85);
            }

            const farDistance = Math.max(baseFarDistance, nearDistance + 5000);

            const nearMaxEcefX = prepared.ecefX + maxDir.x * nearDistance;
            const nearMaxEcefY = prepared.ecefY + maxDir.y * nearDistance;
            const nearMaxEcefZ = prepared.ecefZ + maxDir.z * nearDistance;
            const nearMaxGeo = ecefToGeodetic(nearMaxEcefX, nearMaxEcefY, nearMaxEcefZ);
            nearMaxRing.push({ lon: nearMaxGeo.longitude, lat: nearMaxGeo.latitude, height: nearMaxGeo.height });

            const nearMinEcefX = prepared.ecefX + minDir.x * nearDistance;
            const nearMinEcefY = prepared.ecefY + minDir.y * nearDistance;
            const nearMinEcefZ = prepared.ecefZ + minDir.z * nearDistance;
            const nearMinGeo = ecefToGeodetic(nearMinEcefX, nearMinEcefY, nearMinEcefZ);
            nearMinRing.push({ lon: nearMinGeo.longitude, lat: nearMinGeo.latitude, height: nearMinGeo.height });

            const farMaxEcefX = prepared.ecefX + maxDir.x * farDistance;
            const farMaxEcefY = prepared.ecefY + maxDir.y * farDistance;
            const farMaxEcefZ = prepared.ecefZ + maxDir.z * farDistance;
            const farMaxGeo = ecefToGeodetic(farMaxEcefX, farMaxEcefY, farMaxEcefZ);
            farMaxRing.push({ lon: farMaxGeo.longitude, lat: farMaxGeo.latitude, height: farMaxGeo.height });

            const farMinEcefX = prepared.ecefX + minDir.x * farDistance;
            const farMinEcefY = prepared.ecefY + minDir.y * farDistance;
            const farMinEcefZ = prepared.ecefZ + minDir.z * farDistance;
            const farMinGeo = ecefToGeodetic(farMinEcefX, farMinEcefY, farMinEcefZ);
            farMinRing.push({ lon: farMinGeo.longitude, lat: farMinGeo.latitude, height: farMinGeo.height });
        }

        const count = Math.min(nearMaxRing.length, nearMinRing.length, farMaxRing.length, farMinRing.length);
        if (count < 3) {
            return null;
        }

        const totalVertices = count * 4;
        const positions = new Float64Array(totalVertices * 3);
        let offset = 0;

        const nearMaxStart = 0;
        const nearMinStart = nearMaxStart + count;
        const farMaxStart = nearMinStart + count;
        const farMinStart = farMaxStart + count;

        for (let i = 0; i < count; i++) {
            const v = nearMaxRing[i];
            positions[offset++] = v.lon;
            positions[offset++] = v.lat;
            positions[offset++] = v.height;
        }
        for (let i = 0; i < count; i++) {
            const v = nearMinRing[i];
            positions[offset++] = v.lon;
            positions[offset++] = v.lat;
            positions[offset++] = v.height;
        }
        for (let i = 0; i < count; i++) {
            const v = farMaxRing[i];
            positions[offset++] = v.lon;
            positions[offset++] = v.lat;
            positions[offset++] = v.height;
        }
        for (let i = 0; i < count; i++) {
            const v = farMinRing[i];
            positions[offset++] = v.lon;
            positions[offset++] = v.lat;
            positions[offset++] = v.height;
        }

        const faces: number[] = [];

        for (let i = 0; i < count; i++) {
            const next = (i + 1) % count;

            const nmCurr = nearMaxStart + i;
            const nmNext = nearMaxStart + next;
            const nminCurr = nearMinStart + i;
            const nminNext = nearMinStart + next;
            const fmCurr = farMaxStart + i;
            const fmNext = farMaxStart + next;
            const fminCurr = farMinStart + i;
            const fminNext = farMinStart + next;

            // Max elevation wall
            faces.push(fmCurr, fmNext, nmNext);
            faces.push(fmCurr, nmNext, nmCurr);

            // Min elevation wall
            faces.push(nminCurr, nminNext, fminNext);
            faces.push(nminCurr, fminNext, fminCurr);

            // Far range cap
            faces.push(fmCurr, fminCurr, fminNext);
            faces.push(fmCurr, fminNext, fmNext);

            // Near range cap
            faces.push(nmCurr, nmNext, nminNext);
            faces.push(nmCurr, nminNext, nminCurr);
        }

        const mesh = new Mesh({
            spatialReference: { wkid: 4326 },
            vertexAttributes: {
                position: positions
            },
            components: [
                {
                    faces: new Uint32Array(faces)
                }
            ]
        });

        const symbol = new MeshSymbol3D({
            symbolLayers: [
                new FillSymbol3DLayer({
                    material: { color: SENSOR_FOV_COLOR },
                    edges: new SolidEdges3D({
                        color: SENSOR_FOV_EDGE_COLOR,
                        size: 0.8
                    })
                })
            ]
        });

        return new Graphic({
            geometry: mesh,
            symbol,
            attributes: {
                sensorId: sensor.id
            }
        }) as __esri.Graphic;
    }, []);

    const updateSensorFov = useCallback(() => {
        const layer = sensorFovLayerRef.current;
        if (!layer) {
            return;
        }
        layer.removeAll();
        sensorFovGraphicsRef.current.clear();

        if (!sensorFovActiveRef.current) {
            setSensorFovMessage(null);
            return;
        }

        const selection = sensorSelectionRef.current;
        if (!selection || selection.kind === 'none') {
            setSensorFovMessage('Select a sensor to draw its field of view.');
            return;
        }

        const sensors = selection.sensorIds
            .map((id) => sensorService.getSensor(id))
            .filter((sensor): sensor is SensorDefinition => Boolean(sensor));

        if (!sensors.length) {
            setSensorFovMessage('Select a sensor to draw its field of view.');
            return;
        }

        let created = 0;
        sensors.forEach((sensor) => {
            const graphic = createSensorFovGraphic(sensor);
            if (graphic) {
                const added = layer.add(graphic as any);
                sensorFovGraphicsRef.current.set(sensor.id, (added ?? graphic) as __esri.Graphic);
                created++;
            }
        });

        if (!created) {
            setSensorFovMessage('Unable to draw the field of view for the selected sensor.');
        } else {
            setSensorFovMessage(null);
        }
    }, [createSensorFovGraphic, sensorService]);

    const handleToggleSensorFov = useCallback(() => {
        setSensorFovActive((prev) => {
            if (!prev && sensorSelectionRef.current.kind === 'none') {
                setSensorFovMessage('Select a sensor to enable the field of view overlay.');
                return prev;
            }
            const next = !prev;
            if (next) {
                setSensorFovMessage(null);
            }
            return next;
        });
    }, []);

    const [filterPanelVisible, setFilterPanelVisible] = useState(false);
    const [selectedSatellite, setSelectedSatellite] = useState<SatelliteData | null>(null);
    const workerRef = useRef<Worker | null>(null);
    const [orbitPlotState, setOrbitPlotState] = useState<{
        mode: OrbitPlotMode;
        satellites: number[];
        title: string;
        series: OrbitPlotSeries[] | null;
        isLoading: boolean;
        error: string | null;
        requestId: number | null;
    } | null>(null);
    const orbitPlotRequestRef = useRef<number | null>(null);

    const clearSelectedSatellite = () => setSelectedSatellite(null);

    useEffect(() => {
        if (!showSatellitePhotos) {
            return;
        }
        satellitePhotoService.getPhotos('meteosat11').catch((error) => {
            console.warn('ArcGlobe: Satellite photos preload failed', error);
        });
    }, [showSatellitePhotos]);

    const handleCloseOrbitPlot = () => {
        setOrbitPlotState(null);
        setSelectedFeature(null);
        orbitPlotRequestRef.current = null;
    };

    const applySensorCoverageColors = useCallback((flags: Float32Array | null) => {
        const instancedApi = instancedApiRef.current;
        const baseColors = baseColorBufferRef.current ?? colorSchemeService.getColorBuffer();
        baseColorBufferRef.current = baseColors;

        if (!flags || !flags.length) {
            tintedColorsRef.current = null;
            if (instancedApi?.setBaseColors) {
                instancedApi.setBaseColors(baseColors);
            }
            return;
        }

        const available = Math.floor(baseColors.length / 4);
        const count = Math.min(flags.length, available);
        if (count <= 0) {
            tintedColorsRef.current = null;
            if (instancedApi?.setBaseColors) {
                instancedApi.setBaseColors(baseColors);
            }
            return;
        }

        const tinted = new Float32Array(baseColors);
        for (let i = 0; i < count; i++) {
            if (flags[i] > 0.5) {
                const offset = i * 4;
                tinted[offset] = SENSOR_TINT[0];
                tinted[offset + 1] = SENSOR_TINT[1];
                tinted[offset + 2] = SENSOR_TINT[2];
                tinted[offset + 3] = Math.min(1, tinted[offset + 3] * 1.15);
            }
        }
        tintedColorsRef.current = tinted;
        if (instancedApi?.setBaseColors) {
            instancedApi.setBaseColors(tinted);
        }
    }, []);

    const recomputeSensorCoverage = useCallback(() => {
        const positions = lastPositionsRef.current;
        if (!positions || !positions.length) {
            return;
        }
        const selection = sensorSelectionRef.current;
        if (!selection || selection.kind === 'none') {
            coverageFlagsRef.current = null;
            applySensorCoverageColors(null);
            return;
        }
        const sensors = selection.sensorIds
            .map((id) => sensorService.getSensor(id))
            .filter((sensor): sensor is SensorDefinition => Boolean(sensor));
        if (!sensors.length) {
            coverageFlagsRef.current = null;
            applySensorCoverageColors(null);
            return;
        }

        const count = Math.floor(positions.length / 3);
        if (count <= 0) {
            coverageFlagsRef.current = null;
            applySensorCoverageColors(null);
            return;
        }

        const flags = computeSensorCoverageFlags(positions, count, sensors);
        coverageFlagsRef.current = flags;
        applySensorCoverageColors(flags);
    }, [applySensorCoverageColors]);

    const handleClearSensorSelection = useCallback(() => {
        sensorService.clearSelection();
        setShowSensors(false);
        setShowSensorInfo(false);
        setShowSensorFov(false);
        setSensorFovActive(false);
        sensorFovActiveRef.current = false;
        setSunLineActive(false);
        setMoonLineActive(false);
        removeSensorLines();
        coverageFlagsRef.current = null;
        applySensorCoverageColors(null);
        clearSensorFov();
        setSensorFovMessage(null);
    }, [removeSensorLines, applySensorCoverageColors, clearSensorFov, sensorService]);

    const handleGlobalReset = createResetViewHandler({
        instancedApiRef,
        tooltipService,
        tracksLayerRef,
        trackGraphicsRef,
        selectedIdRef,
        setShowCollisionAnalysis,
        setShowConstellationAnalysis,
        setShowDebrisScanner,
        setShowCreateSatellite,
        setShowColorSchemes,
        setShowTakePhoto,
        setShowWatchlist,
        setShowSatellitePhotos,
        setShowSensors,
        setShowSensorInfo,
        setSunLineActive,
        setMoonLineActive,
        setSelectedFeature,
        onSelectedSatelliteChange: clearSelectedSatellite,
        onClearSensorSelection: handleClearSensorSelection
    });

    const handleConstellationSelect = (constellation: Constellation) => {
        console.log('Constellation selected:', constellation);
    };

    const handleCollisionSelect = (collision: CollisionEvent) => {
        console.log('Collision selected:', collision);
        if (instancedApiRef.current) {
            const ids: number[] = [];
            const sat1Id = resolveSatelliteId(collision.SAT1, collision.SAT1_NAME || '');
            const sat2Id = resolveSatelliteId(collision.SAT2, collision.SAT2_NAME || '');

            if (typeof sat1Id !== 'number') {
                console.warn('[Collision] SAT1 unresolved', {
                    ID: collision.SAT1,
                    name: collision.SAT1_NAME
                });
            }

            if (typeof sat2Id !== 'number') {
                console.warn('[Collision] SAT2 unresolved', {
                    ID: collision.SAT2,
                    name: collision.SAT2_NAME
                });
            }

            if (typeof sat1Id === 'number') {
                ids.push(sat1Id);
            }
            if (typeof sat2Id === 'number') {
                ids.push(sat2Id);
            }

            if (ids.length > 0) {
                instancedApiRef.current.resetVisibility();
                instancedApiRef.current.setVisibleSatellites(ids, [1.0, 0.5, 0.0]);
                instancedApiRef.current.setHighlightedSatellite(null);
                console.log(`Highlighting collision satellites: ${collision.SAT1_NAME}${typeof sat2Id === 'number' ? ` and ${collision.SAT2_NAME}` : ''}`);
                clearSelectedSatellite();
            } else {
                console.warn('No matching satellites found for collision pair', collision.SAT1, collision.SAT2);
                instancedApiRef.current.resetVisibility();
            }
        }
    };

    const handleSatelliteCreated = (satelliteData: SatelliteFormData) => {
        console.log('Creating satellite:', satelliteData);
        try {
            const newSatellite = satelliteService.createSatellite(satelliteData);
            console.log('Satellite created successfully:', newSatellite);
            colorSchemeService.updateMetadata(satelliteService.getAllSatellites());

            trackGraphicsRef.current.forEach((graphic) => {
                tracksLayerRef.current?.remove?.(graphic);
            });
            trackGraphicsRef.current.clear();

            const api = instancedApiRef.current;
            if (api) {
                api.resetVisibility?.();
                api.setVisibleSatellites?.([newSatellite.id], [0.95, 0.95, 1.0]);
                api.setHighlightedSatellite?.(null);
                api.setSelectedId?.(newSatellite.id);
            }

            selectedIdRef.current = newSatellite.id;
            setSelectedSatellite(newSatellite);
            tooltipService.hideTooltip();

            if (typeof window !== 'undefined') {
                window.setTimeout(() => {
                    try {
                        instancedApiRef.current?.requestRender?.();
                    } catch (error) {
                        console.warn('ArcGlobe: requestRender failed after satellite create', error);
                    }
                }, 0);
            }
        } catch (error) {
            console.error('Error creating satellite:', error);
        }
    };

    const handleConstellationHighlight = (constellation: Constellation | null, interaction: 'hover' | 'select' | 'clear' = 'hover') => {
        if (!instancedApiRef.current) {
            return;
        }

        if (interaction === 'hover') {
            // Do not change visibility on hover to avoid disruptive flicker
            return;
        }

        if (interaction === 'select' && constellation) {
            const ids = constellation.satellites.map(s => s.id).filter(id => typeof id === 'number');
            if (ids.length > 0) {
                instancedApiRef.current.resetVisibility();
                instancedApiRef.current.setVisibleSatellites(ids, [1.0, 0.5, 0.0]);
                instancedApiRef.current.setHighlightedSatellite(null);
                console.log(`Highlighting ${ids.length} satellites of constellation ${constellation.name}`);
            }
            return;
        }

        // Handle clearing (either explicit clear or a deselection)
        instancedApiRef.current.resetVisibility();
        instancedApiRef.current.setHighlightedSatellite(null);
        console.log('Clearing constellation highlight');
    };

    const handleCloseWatchlist = () => {
        setShowWatchlist(false);
        setSelectedFeature(null);
    };

    const handleCloseSatellitePhotos = () => {
        setShowSatellitePhotos(false);
        setSelectedFeature(null);
    };

    const handleCloseSensors = () => {
        setShowSensors(false);
        setSelectedFeature(null);
    };

    const handleCloseSensorFov = () => {
        setShowSensorFov(false);
        setSelectedFeature(null);
    };

    const handleCloseSensorInfo = () => {
        setShowSensorInfo(false);
        setSelectedFeature(null);
    };

    const handleSensorsPanelSensor = useCallback((_sensorId: string) => {
        recomputeSensorCoverage();
    }, [recomputeSensorCoverage]);

    const handleSensorsPanelGroup = useCallback((_groupId: string) => {
        recomputeSensorCoverage();
    }, [recomputeSensorCoverage]);

    const handleSensorsPanelReset = useCallback(() => {
        handleClearSensorSelection();
    }, [handleClearSensorSelection]);

    const handleToggleSunLine = useCallback(() => {
        setSunLineActive((prev) => {
            const next = !prev;
            if (next) {
                drawSensorLine('sun');
            } else {
                removeSensorLines('sun');
            }
            return next;
        });
    }, [drawSensorLine, removeSensorLines]);

    const handleToggleMoonLine = useCallback(() => {
        setMoonLineActive((prev) => {
            const next = !prev;
            if (next) {
                drawSensorLine('moon');
            } else {
                removeSensorLines('moon');
            }
            return next;
        });
    }, [drawSensorLine, removeSensorLines]);

    const handleFocusWatchlistSatellite = (id: number) => {
        if (typeof id !== 'number' || Number.isNaN(id)) {
            return;
        }
        const satellite = satelliteService.getSatelliteById(id);
        if (!satellite) {
            console.warn('ArcGlobe: Unable to focus watchlist satellite, missing metadata for id', id);
            return;
        }
        setShowWatchlist(true);
        selectedIdRef.current = id;
        setSelectedFeature('watchlist');
        setSelectedSatellite(satellite);
        tooltipService.hideTooltip();
        try {
            const instancedApi = instancedApiRef.current;
            instancedApi?.setHighlightedSatellite?.(null);
            instancedApi?.setSelectedId?.(id);
            instancedApi?.setHighlightedSatellite?.(id, [0.2, 1.0, 0.2], false);
        } catch (error) {
            console.warn('ArcGlobe: Failed to update instanced renderer for watchlist selection', error);
        }
        const coords = instancedApiRef.current?.getLonLatHeight?.(id);
        if (coords && Array.isArray(coords) && coords.length === 3) {
            const [lon, lat, height] = coords;
            const view: any = viewRef.current;
            if (view && typeof view.goTo === 'function' && typeof lon === 'number' && typeof lat === 'number') {
                const altitude = Number.isFinite(height) ? height : 0;
                const offsetAltitude = Math.max(altitude + 400000, 700000);
                const target = {
                    type: 'point',
                    longitude: lon,
                    latitude: lat,
                    z: altitude
                };
                const position = {
                    longitude: lon,
                    latitude: lat,
                    z: offsetAltitude
                };
                view.goTo({ target, position, tilt: 25 }, { duration: 1800, easing: 'ease-in-out' }).catch(() => { /* ignore */ });
            }
        }
        const worker = workerRef.current;
        if (worker) {
            try {
                worker.postMessage({ type: 'track', id });
            } catch (error) {
                console.warn('ArcGlobe: Failed to request orbit track for watchlist satellite', error);
            }
        }
    };

    // Feature handlers
    const handleFeatureSelect = (feature: string) => {
        setSelectedFeature(feature);
        if (feature !== 'sensor-fov') {
            setShowSensorFov(false);
        }

        switch (feature) {
            case 'collision':
                setShowCollisionAnalysis(true);
                setShowConstellationAnalysis(false);
                setShowCreateSatellite(false);
                setShowDebrisScanner(false);
                setShowColorSchemes(false);
                setShowTakePhoto(false);
                setShowWatchlist(false);
                setShowSatellitePhotos(false);
                setShowSensors(false);
                setShowSensorInfo(false);
                clearSelectedSatellite();
                break;
            case 'constellation':
                setShowConstellationAnalysis(true);
                setShowCollisionAnalysis(false);
                setShowCreateSatellite(false);
                setShowDebrisScanner(false);
                setShowColorSchemes(false);
                setShowTakePhoto(false);
                setShowWatchlist(false);
                setShowSatellitePhotos(false);
                setShowSensors(false);
                setShowSensorInfo(false);
                clearSelectedSatellite();
                break;
            case 'create-satellite':
                setShowCreateSatellite(true);
                setShowCollisionAnalysis(false);
                setShowConstellationAnalysis(false);
                setShowDebrisScanner(false);
                setShowColorSchemes(false);
                setShowTakePhoto(false);
                setShowWatchlist(false);
                setShowSatellitePhotos(false);
                setShowSensors(false);
                setShowSensorInfo(false);
                clearSelectedSatellite();
                break;
            case 'color-schemes':
                setShowColorSchemes(true);
                setShowCollisionAnalysis(false);
                setShowConstellationAnalysis(false);
                setShowDebrisScanner(false);
                setShowCreateSatellite(false);
                setShowTakePhoto(false);
                setShowWatchlist(false);
                setShowSatellitePhotos(false);
                setShowSensors(false);
                setShowSensorInfo(false);
                break;
            case 'take-photo':
                setShowTakePhoto(true);
                setShowCollisionAnalysis(false);
                setShowConstellationAnalysis(false);
                setShowDebrisScanner(false);
                setShowCreateSatellite(false);
                setShowColorSchemes(false);
                setShowWatchlist(false);
                setShowSatellitePhotos(false);
                setShowSensors(false);
                setShowSensorInfo(false);
                break;
            case 'satellite-photos':
                setShowSatellitePhotos(true);
                setShowCollisionAnalysis(false);
                setShowConstellationAnalysis(false);
                setShowDebrisScanner(false);
                setShowCreateSatellite(false);
                setShowColorSchemes(false);
                setShowTakePhoto(false);
                setShowWatchlist(false);
                setShowSensors(false);
                setShowSensorInfo(false);
                break;
            case 'watchlist':
                setShowWatchlist(true);
                setShowCollisionAnalysis(false);
                setShowConstellationAnalysis(false);
                setShowDebrisScanner(false);
                setShowCreateSatellite(false);
                setShowColorSchemes(false);
                setShowTakePhoto(false);
                setShowSatellitePhotos(false);
                setShowSensors(false);
                setShowSensorInfo(false);
                break;
            case 'debris-scanner':
                setShowDebrisScanner(true);
                setShowCollisionAnalysis(false);
                setShowConstellationAnalysis(false);
                setShowCreateSatellite(false);
                setShowColorSchemes(false);
                setShowTakePhoto(false);
                setShowWatchlist(false);
                setShowSatellitePhotos(false);
                setShowSensors(false);
                setShowSensorInfo(false);
                clearSelectedSatellite();
                break;
            case 'eci-plot':
                handleOpenOrbitPlot('eci');
                setShowColorSchemes(false);
                setShowTakePhoto(false);
                setShowWatchlist(false);
                setShowSatellitePhotos(false);
                setShowSensors(false);
                setShowSensorInfo(false);
                break;
            case 'ecf-plot':
                handleOpenOrbitPlot('ecf');
                setShowColorSchemes(false);
                setShowTakePhoto(false);
                setShowWatchlist(false);
                setShowSatellitePhotos(false);
                setShowSensors(false);
                setShowSensorInfo(false);
                break;
            case 'sensors':
                setShowSensors(true);
                setShowCollisionAnalysis(false);
                setShowConstellationAnalysis(false);
                setShowCreateSatellite(false);
                setShowDebrisScanner(false);
                setShowColorSchemes(false);
                setShowTakePhoto(false);
                setShowWatchlist(false);
                setShowSatellitePhotos(false);
                setShowSensorInfo(false);
                break;
            case 'sensor-fov':
                setShowSensorFov(true);
                setShowSensors(false);
                setShowSensorInfo(false);
                setShowCollisionAnalysis(false);
                setShowConstellationAnalysis(false);
                setShowCreateSatellite(false);
                setShowDebrisScanner(false);
                setShowColorSchemes(false);
                setShowTakePhoto(false);
                setShowWatchlist(false);
                setShowSatellitePhotos(false);
                break;
            case 'sensor-info':
                if (sensorSelectionRef.current.kind === 'none') {
                    console.warn('Sensor Info requires a selected sensor.');
                    return;
                }
                setShowSensorInfo(true);
                setShowSensors(false);
                setShowCollisionAnalysis(false);
                setShowConstellationAnalysis(false);
                setShowCreateSatellite(false);
                setShowDebrisScanner(false);
                setShowColorSchemes(false);
                setShowTakePhoto(false);
                setShowWatchlist(false);
                setShowSatellitePhotos(false);
                break;
            case 'new-launch':
                console.log('New Launch feature selected');
                break;
            case 'create-breakup':
                console.log('Create Breakup feature selected');
                break;
            default:
                break;
        }
    };

    const resolveSatelliteId = (noradValue: string | number, name: string): number | undefined => {
        const sat = satelliteService.resolveSatellite(noradValue?.toString(), name);
        return sat?.id;
    };

    const handleCloseCollisionAnalysis = () => {
        setShowCollisionAnalysis(false);
        setSelectedFeature(null);
        if (instancedApiRef.current) {
            instancedApiRef.current.resetVisibility();
            instancedApiRef.current.setHighlightedSatellite(null);
        }
        clearSelectedSatellite();
    };

    const handleCloseCreateSatellite = () => {
        setShowCreateSatellite(false);
        setSelectedFeature(null);
    };

    const handleTestConstellations = () => {
        setShowConstellationAnalysis(true);
    };

    const handleCloseConstellationAnalysis = () => {
        setShowConstellationAnalysis(false);
        if (instancedApiRef.current) {
            instancedApiRef.current.resetVisibility();
            instancedApiRef.current.setHighlightedSatellite(null);
        }
    };

    const handleCloseDebrisScanner = () => {
        setShowDebrisScanner(false);
        setSelectedFeature(null);
    };

    const handleCloseColorSchemes = () => {
        setShowColorSchemes(false);
        setSelectedFeature(null);
    };

    const handleCloseTakePhoto = () => {
        setShowTakePhoto(false);
        setSelectedFeature(null);
    };

    const handleSearchSatellites = (query: string) => {
        console.log('Searching for satellites:', query);
        const results = satelliteService.searchSatellites(query);
        console.log('Search results:', results);
        // TODO: Implement visual filtering on the globe
    };

    const handleShowUserCreated = () => {
        const userCreated = satelliteService.getUserCreatedSatellites();
        if (!userCreated.length) {
            console.log('No user-created satellites available');
            return;
        }

        const ids = userCreated.map((sat) => sat.id);
        const api = instancedApiRef.current;
        if (!api) {
            return;
        }

        trackGraphicsRef.current.forEach((graphic) => {
            tracksLayerRef.current?.remove?.(graphic);
        });
        trackGraphicsRef.current.clear();

        api.resetVisibility?.();
        api.setVisibleSatellites?.(ids, [0.8, 0.95, 1.0]);
        api.setHighlightedSatellite?.(null);

        const latest = userCreated[userCreated.length - 1];
        api.setSelectedId?.(latest.id);
        selectedIdRef.current = latest.id;
        setSelectedSatellite(latest);
        tooltipService.hideTooltip();
    };

    const handleToggleFilters = (nextOpen: boolean) => {
        setFilterPanelVisible(nextOpen);
        console.log('Toggled filters panel:', nextOpen ? 'open' : 'closed');
        // TODO: render actual filter controls (country / NORAD / year)
    };

    const handleApplyFilters = (criteria: FilterCriteria) => {
        console.log('Applying filters:', criteria);
        const api = instancedApiRef.current;
        if (!api) return;

        const allSatellites = satelliteService.getAllSatellites();
        const filteredIds: number[] = allSatellites
            .filter((sat) => {
                if (criteria.country && sat.country !== criteria.country) return false;
                if (criteria.norad && !sat.norad.includes(criteria.norad)) return false;
                if (criteria.yearFrom) {
                    const year = new Date(sat.launchDate).getUTCFullYear();
                    if (year < criteria.yearFrom) return false;
                }
                if (criteria.yearTo) {
                    const year = new Date(sat.launchDate).getUTCFullYear();
                    if (year > criteria.yearTo) return false;
                }
                return true;
            })
            .map((sat) => sat.id);

        api.resetVisibility?.();
        if (filteredIds.length > 0) {
            api.setVisibleSatellites?.(filteredIds, [0.6, 0.9, 1.0]);
        }

        setFilterPanelVisible(false);
    };

    useEffect(() => {
        let view: any;
        let worker: Worker | null = null;
        let tracksLayer: any;
        let metaRef: any[] = [];
        const useInstanced = true;
        const DEBUG = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('debug') === '1';
        let instancedApi: any = null;
        // Hover picking throttling and drag gating
        let isDragging = false;
        let lastHoverId: number = -2;
        let lastMoveX = 0, lastMoveY = 0;
        let pickPending = false;
        let lastPickTs = 0;
        const HOVER_MIN_INTERVAL_MS = 120;
        const isFinePointer = typeof window !== 'undefined' && matchMedia('(pointer:fine)').matches;
        let expectedSatelliteCount = 0;

        isLoadingRef.current = true;
        setIsLoading(true);

        const markLoaded = () => {
            if (!isLoadingRef.current) return;
            isLoadingRef.current = false;
            setIsLoading(false);
        };

        // If instanced flag is on, load glue scripts early
        if (useInstanced) {
            const s1 = document.createElement('script'); s1.src = '/arcgis/instanced/renderer.js'; s1.async = true; document.head.appendChild(s1);
            const s2 = document.createElement('script'); s2.src = '/arcgis/instanced/customLayer.js'; s2.async = true; document.head.appendChild(s2);
        }


        function createTrackPolyline(pointsLngLatZ: number[][]) {
            return { type: 'polyline', paths: [pointsLngLatZ], spatialReference: { wkid: 4326 } } as const;
        }


        function start(
            Map: any,
            SceneView: any,
            GraphicsLayer: any,
            Graphic: any,
            Mesh: any,
            MeshSymbol3D: any,
            FillSymbol3DLayer: any,
            SolidEdges3D: any
        ) {
            function scheduleHoverPick(x: number, y: number) {
                if (!instancedApi) return;
                lastMoveX = x; lastMoveY = y;
                if (pickPending) return;
                pickPending = true;
                requestAnimationFrame(() => {
                    const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
                    const dt = now - lastPickTs;
                    if (dt < HOVER_MIN_INTERVAL_MS) {
                        setTimeout(() => { pickPending = false; scheduleHoverPick(lastMoveX, lastMoveY); }, HOVER_MIN_INTERVAL_MS - dt);
                        return;
                    }
                    lastPickTs = now;
                    const id = instancedApi!.pick(lastMoveX, lastMoveY);
                    if (id !== lastHoverId) {
                        lastHoverId = id;
                        if (id >= 0) {
                            const isSameAsSelected = id === selectedIdRef.current;
                            if (!isSameAsSelected) {
                                const html = tooltipService.generateSatelliteTooltip(id, true);
                                if (html) {
                                    tooltipService.showTooltip(lastMoveX, lastMoveY, html);
                                } else {
                                    tooltipService.hideTooltip();
                                }
                            } else {
                                tooltipService.hideTooltip();
                            }
                        } else {
                            tooltipService.hideTooltip();
                        }
                    }
                    pickPending = false;
                });
            }
            const map = new Map({ basemap: 'satellite', ground: 'world-elevation' });

            view = new SceneView({
                container: divRef.current!,
                map,
                qualityProfile: 'high',
                constraints: { altitude: { max: 12000000000 } },
                environment: {
                    lighting: { date: new Date(), directShadowsEnabled: true },
                    atmosphereEnabled: true,
                    starsEnabled: true,
                },
                popup: { dockEnabled: true, dockOptions: { breakpoint: false } },
            });

            try { (view as any).padding = { top: 50 }; } catch (e) { }
            viewRef.current = view as __esri.SceneView;

            tracksLayer = new GraphicsLayer();
            map.add(tracksLayer);
            tracksLayerRef.current = tracksLayer;
            const sensorLinesLayer = new GraphicsLayer({ listMode: 'hide' });
            map.add(sensorLinesLayer);
            sensorLinesLayerRef.current = sensorLinesLayer;
            const sensorFovLayer = new GraphicsLayer({ listMode: 'hide' });
            map.add(sensorFovLayer);
            sensorFovLayerRef.current = sensorFovLayer;
            sensorFovModulesRef.current = {
                Mesh,
                MeshSymbol3D,
                FillSymbol3DLayer,
                SolidEdges3D,
                Graphic
            };
            if (sensorFovActiveRef.current) {
                updateSensorFov();
            }
            try {
                screenshotService.setView(view as __esri.SceneView);
            } catch (error) {
                console.warn('ArcGlobe: unable to register SceneView with screenshot service', error);
            }

            // If instanced, attach external renderer
            if (useInstanced) {
                const id = setInterval(() => {
                    if ((window as any).ArcgisInstanced && view) {
                        clearInterval(id);
                        try {
                            instancedApi = (window as any).ArcgisInstanced.create(view, {});
                            instancedApiRef.current = instancedApi;
                            screenshotService.setInstancedApi(instancedApi);
                            watchlistService.setRenderer(instancedApi);
                            const baseColors = colorSchemeService.getColorBuffer();
                            baseColorBufferRef.current = baseColors;
                            try {
                                if (tintedColorsRef.current) {
                                    instancedApi?.setBaseColors?.(tintedColorsRef.current);
                                } else {
                                    instancedApi?.setBaseColors?.(baseColors);
                                }
                            } catch (error) {
                                console.warn('ArcGlobe: Unable to push initial color buffer to renderer', error);
                            }
                            if (sensorSelectionRef.current.kind !== 'none' && positionsReadyRef.current) {
                                recomputeSensorCoverage();
                            }

                            // Add event handlers after API is ready
                            view.on('click', (evt: any) => {
                                evt.stopPropagation();
                                if (!instancedApi) {
                                    return;
                                }

                                // Add small delay to ensure picking is stable
                                setTimeout(() => {
                                    const id = instancedApi.pick(evt.x, evt.y);
                                    if (id < 0) {
                                        // Clicked on empty space - clear selection
                                        if (selectedIdRef.current !== null) {
                                            if (trackGraphicsRef.current.has(selectedIdRef.current)) {
                                                const graphic = trackGraphicsRef.current.get(selectedIdRef.current);
                                                if (graphic) {
                                                    tracksLayerRef.current?.remove(graphic);
                                                }
                                                trackGraphicsRef.current.delete(selectedIdRef.current);
                                            }
                                            selectedIdRef.current = null;
                                            tooltipService.hideTooltip();
                                            // Clear selection in renderer
                                            instancedApi.setSelectedId(-1);
                                            clearSelectedSatellite();
                                        }
                                        return;
                                    }

                                    if (id === selectedIdRef.current) {
                                        // Clicked on same satellite - toggle off
                                        const graphic = trackGraphicsRef.current.get(id);
                                        if (graphic) {
                                            tracksLayerRef.current?.remove(graphic);
                                            trackGraphicsRef.current.delete(id);
                                        }
                                        selectedIdRef.current = null;
                                        tooltipService.hideTooltip();
                                        // Clear selection in renderer
                                        instancedApi.setSelectedId(-1);
                                        clearSelectedSatellite();
                                    } else {
                                        // Clicked on different satellite - show orbit and info
                                        selectedIdRef.current = id;
                                        // Highlight selected satellite in renderer
                                        instancedApi.setSelectedId(id);

                                        const satellite = satelliteService.getSatelliteById(id);
                                        setSelectedSatellite(satellite ?? null);

                                        // Show satellite info tooltip
                                        const html = tooltipService.generateSatelliteTooltip(id, false);
                                        if (html) {
                                            tooltipService.showTooltip(evt.x, evt.y, html);
                                        }

                                        if (worker) {
                                            worker.postMessage({ type: 'track', id: id });
                                        }
                                    }
                                }, 50); // Small delay for stable picking
                            });

                            // Track drag state and throttle hover picking to mouse-only
                            view.on('pointer-down', () => { isDragging = true; });
                            view.on('pointer-up', () => { isDragging = false; });

                            // Hover handler for satellite info (mouse-only, throttled, not during drag)
                            view.on('pointer-move', (evt: any) => {
                                if (!instancedApi) return;
                                // Skip on touch/pen; only do hover for mouse/fine pointer
                                if ((evt.pointerType && evt.pointerType !== 'mouse') || !isFinePointer) return;
                                // Skip while dragging to keep navigation smooth
                                if (isDragging) return;
                                scheduleHoverPick(evt.x, evt.y);
                            });

                        } catch (e) { if (DEBUG) console.error('[ArcGlobe] instanced create failed', e); }
                    }
                }, 50);
            }


            view.when(() => {
                view.popup.autoOpenEnabled = false;


                // Set lighting date once for dynamic lighting
                view.environment.lighting.date = new Date();

                // Update lighting less frequently to reduce fidgeting
                setInterval(() => {
                    try {
                        view.environment.lighting.date = new Date();
                    } catch (e) { }
                }, 5000); // Reduced from 1000ms to 5000ms (5 seconds)

                // Watch camera changes to trigger re-renders
                view.watch('camera', () => {
                    try {
                        // @ts-ignore - ArcGIS module loading
                        require(['esri/views/3d/externalRenderers'], function (externalRenderers: any) {
                            externalRenderers.requestRender(view);
                        });
                    } catch (e) { }
                });
            });

            (async function loadData() {
                try {
                    const MAX_SATS = 30000;
                    const datasets = (window.ArcgisDataLoader?.loadAllSources)
                        ? await window.ArcgisDataLoader.loadAllSources({
                            apiUrl: '/api-keeptrack/v3/sats',
                            asciiUrl: '/tle/TLE.txt',
                            debrisUrl: 'https://app.keeptrack.space/tle/TLEdebris.json',
                            vimpelUrl: '/api-keeptrack/v3/r2/vimpel.json',
                            extraUrl: '/tle/extra.json',
                            celestrakGroups: ['starlink'],
                        })
                        : { main: [], debris: [], vimpel: [], extra: [], celestrak: {} };


                    try {
                        // Store metadata reference for picking
                        metaRef = (datasets.main || []).slice(0, MAX_SATS);

                        // Convert to SatelliteData format and initialize service
                        const pickString = (...values: Array<string | number | null | undefined>) => {
                            for (const value of values) {
                                if (value === null || value === undefined) {
                                    continue;
                                }
                                const str = String(value).trim();
                                if (str && str.toLowerCase() !== 'null' && str.toLowerCase() !== 'undefined') {
                                    return str;
                                }
                            }
                            return undefined;
                        };

                        const normalizeObjectType = (value: string | undefined): string | undefined => {
                            if (!value) return undefined;
                            const maybe = value.toString().trim();
                            if (!maybe) return undefined;
                            if (maybe.toLowerCase() === 'null' || maybe.toLowerCase() === 'undefined') {
                                return undefined;
                            }
                            return maybe.toUpperCase();
                        };

                        const satcatLookup = await buildSatcatLookup();

                        const satelliteData: SatelliteData[] = metaRef.map((s: any, idx: number) => {
                            const noradId = (() => {
                                const direct = pickString(
                                    s.norad,
                                    s.NORAD,
                                    s.objectId,
                                    s.OBJECT_ID,
                                    s.catalogNumber,
                                    s.CATALOG_NUMBER,
                                    s.SATCAT,
                                    s.scc,
                                    s.satcat,
                                    s.SATCATNUM
                                );
                                if (direct) {
                                    return direct;
                                }
                                if (s.tle1 && s.tle1.length > 7) {
                                    const noradMatch = s.tle1.match(/^1\s+(\d{5})/);
                                    if (noradMatch) {
                                        return noradMatch[1];
                                    }
                                }
                                return 'N/A';
                            })();

                            const satcatEntry = getSatcatEntry(satcatLookup, noradId);

                            const name = pickString(
                                s.name,
                                s.object_name,
                                s.OBJECT_NAME,
                                s.payloadName,
                                s.PAYLOAD,
                                s.payload,
                                s.PAYLOAD_NAME,
                                s.payload_name,
                                s.satname,
                                s.SATNAME,
                                s.sat_name,
                                s.payloadId,
                                s.PAYLOAD_ID
                            ) || noradId || 'SAT';

                            const country = pickString(
                                s.country,
                                s.countryCode,
                                s.country_code,
                                s.country_of_registry,
                                s.owner,
                                s.ORIGIN,
                                s.origin,
                                s.countryOwner,
                                s.country_operator,
                                s.operator_country,
                                s.countryOfOperator,
                                s.COUNTRY,
                                s.Country,
                                s.Nation,
                                s.nation,
                                s.operator_country_code
                            ) || 'TBD';

                            const launchDate = pickString(
                                s.launchDate,
                                s.launch_date,
                                s.LaunchDate,
                                s.LAUNCH_DATE,
                                s.launch,
                                s.DEP_DATE
                            );

                            const objectType = normalizeObjectType(
                                pickString(
                                    s.objectType,
                                    s.object_type,
                                    s.OBJECT_TYPE,
                                    s.category,
                                    s.CATEGORY,
                                    s.type,
                                    s.TYPE
                                ) ?? satcatEntry?.OBJECT_TYPE
                            ) || 'UNKNOWN';

                            const upperObjectType = objectType.toUpperCase();
                            const typeCode = (() => {
                                if (upperObjectType.includes('PAYLOAD') || upperObjectType === 'PAY') return 1;
                                if (upperObjectType.includes('ROCKET') || upperObjectType === 'R/B' || upperObjectType === 'RB') return 2;
                                if (upperObjectType.includes('DEBRIS') || upperObjectType === 'DEB') return 3;
                                if (upperObjectType.includes('SPECIAL')) return 4;
                                if (upperObjectType.includes('UNKNOWN') || upperObjectType === 'UNK') return 5;
                                return 0;
                            })();

                            return {
                                id: typeof s.id === 'number' ? s.id : idx,
                                name,
                                tle1: s.tle1,
                                tle2: s.tle2,
                                norad: noradId,
                                launchDate: launchDate || new Date().toISOString(),
                                country: satcatEntry?.OWNER ?? country,
                                type: typeCode,
                                source: s.source || 'Unknown',
                                isUserCreated: false,
                                objectType,
                                owner: satcatEntry?.OWNER ?? country,
                                opsStatus: satcatEntry?.OPS_STATUS_CODE ?? null,
                                dataStatus: satcatEntry?.DATA_STATUS_CODE ?? null
                            };
                        });

                        expectedSatelliteCount = satelliteData.length;

                        // Use classic worker served from public to avoid bundler issues
                        try {
                            worker = new Worker('/arcgis/worker.js');
                            workerRef.current = worker;
                            console.log('ArcGlobe: Worker created successfully');

                            // Add error handling for worker
                            worker.onerror = (error) => {
                                console.error('ArcGlobe: Worker error:', error);
                            };

                            worker.onmessageerror = (error) => {
                                console.error('ArcGlobe: Worker message error:', error);
                            };
                        } catch (error) {
                            console.error('ArcGlobe: Failed to create worker:', error);
                        }
                        const payload = satelliteData.map(s => ({
                            id: s.id,
                            name: s.name,
                            tle1: s.tle1,
                            tle2: s.tle2,
                            norad: s.norad,
                            launchDate: s.launchDate,
                            country: s.country
                        }));
                        if (worker) {
                            worker.postMessage({ type: 'init', payload });

                            // Test if worker is responding
                            setTimeout(() => {
                                console.log('ArcGlobe: Testing worker communication...');
                                if (worker) {
                                    worker.postMessage({ type: 'test', message: 'Hello worker' });
                                }
                            }, 1000);

                            // Initialize satellite service
                            satelliteService.initialize(satelliteData, worker);
                            colorSchemeService.initialize(satelliteData);
                            coverageFlagsRef.current = new Float32Array(satelliteData.length);
                            try {
                                await watchlistService.hydrate('/tle/watchlist.json');
                            } catch (error) {
                                console.warn('ArcGlobe: Failed to hydrate watchlist', error);
                            }
                        }

                        if (worker) {
                            worker.onmessage = (ev: MessageEvent) => {
                                const data: any = ev.data || {};
                                if (data.type === 'log' && DEBUG) { console.log('[worker]', data.msg); return; }
                                // Ignore PV for now; renderer expects lon/lat/h. Use 'positions' path below.
                                if (data.type === 'positions' && data.positions) {
                                    const arr = data.positions instanceof Float32Array ? data.positions : new Float32Array(data.positions as ArrayBuffer);
                                    const count = Math.floor(arr.length / 3);
                                    if (useInstanced && instancedApi) {
                                        instancedApi.updatePositions(arr.buffer, count);
                                        if (expectedSatelliteCount > 0 && count >= expectedSatelliteCount && isLoadingRef.current) {
                                            requestAnimationFrame(() => {
                                                setTimeout(() => {
                                                    markLoaded();
                                                }, 150);
                                            });
                                        }
                                    }
                                    if (count > 0) {
                                        positionsReadyRef.current = true;
                                        let positionsBuffer = lastPositionsRef.current;
                                        if (!positionsBuffer || positionsBuffer.length !== arr.length) {
                                            positionsBuffer = new Float32Array(arr.length);
                                            lastPositionsRef.current = positionsBuffer;
                                        }
                                        positionsBuffer.set(arr);
                                        if (sensorSelectionRef.current.kind !== 'none') {
                                            recomputeSensorCoverage();
                                        }
                                    }
                                } else if (data.type === 'track' && data.positions) {
                                    const arr = new Float32Array(data.positions);
                                    const path: number[][] = [];
                                    for (let k = 0; k < arr.length; k += 3) {
                                        const x = arr[k], y = arr[k + 1], z = arr[k + 2];
                                        if (!Number.isNaN(x) && !Number.isNaN(y) && !Number.isNaN(z)) path.push([x, y, z]);
                                    }
                                    if (path.length > 1) {
                                        const line = new Graphic({
                                            geometry: createTrackPolyline(path),
                                            symbol: { type: 'line-3d', symbolLayers: [{ type: 'line', size: 2, material: { color: [192, 192, 192, 0.6] } }] },
                                        });
                                        if (typeof data.id === 'number') {
                                            const existing = trackGraphicsRef.current.get(data.id);
                                            if (existing) {
                                                tracksLayer.remove(existing);
                                            }
                                            trackGraphicsRef.current.set(data.id, line);
                                        }
                                        tracksLayer.add(line);
                                    }
                                }
                            };
                        }

                        setInterval(() => {
                            if (worker) worker.postMessage({ type: 'tick', time: Date.now() });
                        }, 1000);
                    } catch (e) {
                        console.error(e);
                    }
                } catch (e) {
                    console.error(e);
                }
            })();

        }

        function boot() {
            if (window.require && divRef.current) {
                window.require(
                    [
                        'esri/Map',
                        'esri/views/SceneView',
                        'esri/layers/GraphicsLayer',
                        'esri/Graphic',
                        'esri/geometry/Mesh',
                        'esri/symbols/MeshSymbol3D',
                        'esri/symbols/FillSymbol3DLayer',
                        'esri/symbols/edges/SolidEdges3D'
                    ],
                    (
                        Map: any,
                        SceneView: any,
                        GraphicsLayer: any,
                        Graphic: any,
                        Mesh: any,
                        MeshSymbol3D: any,
                        FillSymbol3DLayer: any,
                        SolidEdges3D: any
                    ) => start(Map, SceneView, GraphicsLayer, Graphic, Mesh, MeshSymbol3D, FillSymbol3DLayer, SolidEdges3D)
                );
            } else {
                const id = setInterval(() => {
                    if (window.require && divRef.current) {
                        clearInterval(id);
                        boot();
                    }
                }, 50);
            }
        }

        boot();

        return () => {
            watchlistService.setRenderer(null);
            viewRef.current = null;
            screenshotService.clearView();
            screenshotService.setInstancedApi(null);
            try { (view as any)?.destroy?.(); } catch { }
            try { worker?.terminate?.(); } catch { }
            try { tooltipService.dispose(); } catch { }
            trackGraphicsRef.current.forEach((graphic) => {
                tracksLayerRef.current?.remove?.(graphic);
            });
            trackGraphicsRef.current.clear();
            tracksLayerRef.current = null;
            clearSensorFov();
            sensorFovLayerRef.current = null;
            sensorFovModulesRef.current = null;
            selectedIdRef.current = null;
            setIsLoading(false);
            isLoadingRef.current = false;
            clearSelectedSatellite();
        };
    }, []);

    useEffect(() => {
        const unsubscribe = sensorService.subscribe((next) => {
            sensorSelectionRef.current = next;
            setSensorSelectionState(next);
            if (next.kind === 'none') {
                setSunLineActive(false);
                setMoonLineActive(false);
                removeSensorLines();
                coverageFlagsRef.current = null;
                applySensorCoverageColors(null);
            }
        });
        return unsubscribe;
    }, [removeSensorLines, applySensorCoverageColors]);

    useEffect(() => {
        if (sensorSelectionState.kind === 'none') {
            coverageFlagsRef.current = null;
            applySensorCoverageColors(null);
            return;
        }
        if (positionsReadyRef.current) {
            recomputeSensorCoverage();
        }
    }, [sensorSelectionState, recomputeSensorCoverage, applySensorCoverageColors]);

    useEffect(() => {
        sensorFovActiveRef.current = sensorFovActive;
        if (!sensorFovActive) {
            clearSensorFov();
            setSensorFovMessage(null);
            return;
        }
        updateSensorFov();
    }, [sensorFovActive, clearSensorFov, updateSensorFov]);

    useEffect(() => {
        if (sensorSelectionState.kind === 'none') {
            if (sensorFovActiveRef.current) {
                setSensorFovActive(false);
            } else {
                clearSensorFov();
                setSensorFovMessage(null);
            }
            return;
        }
        setSensorFovMessage(null);
        if (sensorFovActiveRef.current) {
            updateSensorFov();
        }
    }, [sensorSelectionState, updateSensorFov, clearSensorFov]);

    useEffect(() => (
        orbitPlotService.subscribe((event) => {
            if (orbitPlotRequestRef.current !== event.requestId) {
                return;
            }
            setOrbitPlotState((prev) => {
                if (!prev || prev.mode !== event.mode || prev.requestId !== event.requestId) {
                    return prev;
                }
                return {
                    ...prev,
                    series: event.series,
                    isLoading: false,
                    error: event.series.length ? null : 'No samples returned for this orbit.'
                };
            });
        })
    ), []);

    useEffect(() => {
        const unsubscribe = colorSchemeService.subscribe(({ buffer }) => {
            baseColorBufferRef.current = buffer;
            if (coverageFlagsRef.current && coverageFlagsRef.current.length) {
                applySensorCoverageColors(coverageFlagsRef.current);
            } else {
                const instancedApi = instancedApiRef.current;
                tintedColorsRef.current = null;
                if (instancedApi?.setBaseColors) {
                    try {
                        instancedApi.setBaseColors(buffer);
                    } catch (error) {
                        console.warn('ArcGlobe: Failed to push color buffer to renderer', error);
                    }
                }
            }
        });
        return unsubscribe;
    }, [applySensorCoverageColors]);

    const handleOpenOrbitPlot = (mode: OrbitPlotMode) => {
        const selectedIds = selectedIdRef.current !== null
            ? [selectedIdRef.current]
            : selectedSatellite?.id !== undefined
                ? [selectedSatellite.id]
                : [];

        const title = mode === 'eci' ? 'ECI Orbit Plot' : 'ECF Orbit Plot';

        if (!selectedIds.length) {
            setOrbitPlotState({
                mode,
                satellites: [],
                title,
                series: null,
                isLoading: false,
                error: 'Select a satellite to plot its orbit.',
                requestId: null
            });
            setSelectedFeature(mode === 'eci' ? 'eci-plot' : 'ecf-plot');
            return;
        }

        const requestId = (orbitPlotRequestRef.current = orbitPlotService.requestOrbitSamples(mode, selectedIds));

        setOrbitPlotState({
            mode,
            satellites: selectedIds,
            title,
            series: null,
            isLoading: true,
            error: null,
            requestId
        });
        setShowCollisionAnalysis(false);
        setShowConstellationAnalysis(false);
        setShowDebrisScanner(false);
        setShowCreateSatellite(false);
        setSelectedFeature(mode === 'eci' ? 'eci-plot' : 'ecf-plot');
    };

    const activeFeature: ActiveFeature | null = showCollisionAnalysis
        ? { name: 'collision', props: { onClose: () => handleCloseCollisionAnalysis(), onCollisionSelect: handleCollisionSelect } }
        : showCreateSatellite
            ? { name: 'create-satellite', props: { onClose: () => handleCloseCreateSatellite(), onSatelliteCreated: handleSatelliteCreated } }
            : showConstellationAnalysis
                ? { name: 'constellation', props: { onClose: () => handleCloseConstellationAnalysis(), onConstellationSelect: handleConstellationSelect, onConstellationHighlight: handleConstellationHighlight } }
                : showDebrisScanner
                    ? { name: 'debris-scanner', props: { onClose: () => handleCloseDebrisScanner(), getInstancedApi: () => instancedApiRef.current, satelliteService } }
                    : showColorSchemes
                        ? { name: 'color-schemes', props: { onClose: () => handleCloseColorSchemes() } }
                        : showTakePhoto
                            ? { name: 'take-photo', props: { onClose: () => handleCloseTakePhoto() } }
                            : showWatchlist
                                ? { name: 'watchlist', props: { onClose: () => handleCloseWatchlist(), onFocusSatellite: handleFocusWatchlistSatellite } }
                                : showSatellitePhotos
                                    ? { name: 'satellite-photos', props: { onClose: () => handleCloseSatellitePhotos(), onFocusSatellite: handleFocusWatchlistSatellite } }
                                    : showSensors
                                        ? {
                                            name: 'sensors',
                                            props: {
                                                onClose: () => handleCloseSensors(),
                                                onSelectSensor: handleSensorsPanelSensor,
                                                onSelectGroup: handleSensorsPanelGroup,
                                                onReset: handleSensorsPanelReset
                                            }
                                        }
                                        : showSensorFov
                                            ? {
                                                name: 'sensor-fov',
                                                props: {
                                                    onClose: () => handleCloseSensorFov(),
                                                    onToggle: handleToggleSensorFov,
                                                    active: sensorFovActive,
                                                    hasSelection: sensorSelectionState.kind !== 'none',
                                                    message: sensorFovMessage
                                                }
                                            }
                                            : showSensorInfo
                                                ? {
                                                    name: 'sensor-info',
                                                    props: {
                                                        onClose: () => handleCloseSensorInfo(),
                                                        onToggleSunLine: handleToggleSunLine,
                                                        onToggleMoonLine: handleToggleMoonLine,
                                                        sunLineActive,
                                                        moonLineActive
                                                    }
                                                }
                                                : orbitPlotState
                                                    ? {
                                                        name: 'orbit-plot',
                                                        props: {
                                                            onClose: handleCloseOrbitPlot,
                                                            mode: orbitPlotState.mode,
                                                            worker: workerRef.current,
                                                            satelliteIds: orbitPlotState.satellites,
                                                            title: orbitPlotState.title,
                                                            data: orbitPlotState.series,
                                                            loading: orbitPlotState.isLoading,
                                                            error: orbitPlotState.error
                                                        }
                                                    }
                                                    : null;

    const activeFeatureTitle = activeFeature ? (
        activeFeature.name === 'collision' ? 'Collision Analysis'
            : activeFeature.name === 'create-satellite' ? 'Create Satellite'
                : activeFeature.name === 'constellation' ? 'Constellation Analysis'
                    : activeFeature.name === 'debris-scanner' ? 'Debris Scanner'
                        : activeFeature.name === 'color-schemes' ? 'Color Schemes'
                            : activeFeature.name === 'take-photo' ? 'Take Photo'
                                : activeFeature.name === 'watchlist' ? 'Watchlist'
                                    : activeFeature.name === 'satellite-photos' ? 'Satellite Photos'
                                        : activeFeature.name === 'sensors' ? 'Sensors'
                                            : activeFeature.name === 'sensor-fov' ? 'Sensor FOV'
                                                : activeFeature.name === 'sensor-info' ? 'Sensor Info'
                                                    : activeFeature.name === 'orbit-plot' ? activeFeature.props.title
                                                        : null
    ) : null;

    const featureAvailability = useMemo(() => ({
        'sensor-info': sensorSelectionState.kind !== 'none',
        'sensor-fov': sensorSelectionState.kind !== 'none'
    }), [sensorSelectionState.kind]);

    return (
        <>
            <div id="viewDiv" ref={divRef} style={{ position: 'absolute', inset: 0 }} />
            {isLoading && (
                <div className="loading-overlay">
                    <div className="loading-card">
                        <div className="loading-spinner" />
                        <div className="loading-text">
                            <p>Loading Deepspace</p>
                            <p className="loading-subtext">Fetching orbital data and rendering satellites…</p>
                        </div>
                    </div>
                </div>
            )}
            <Header
                onFeatureSelect={handleFeatureSelect}
                selectedFeature={selectedFeature}
                onSearchSatellites={handleSearchSatellites}
                onShowUserCreated={handleShowUserCreated}
                onTestConstellations={handleTestConstellations}
                isFilterOpen={filterPanelVisible}
                onToggleFilters={handleToggleFilters}
                onApplyFilters={handleApplyFilters}
                onResetView={handleGlobalReset}
                resetDisabled={isLoading}
                featureAvailability={featureAvailability}
            />
            <Footer
                isVisible={!!activeFeature}
                title={activeFeatureTitle}
                onClose={() => {
                    setShowCollisionAnalysis(false);
                    setShowCreateSatellite(false);
                    setShowConstellationAnalysis(false);
                    setShowDebrisScanner(false);
                    setShowColorSchemes(false);
                    setShowTakePhoto(false);
                    setShowWatchlist(false);
                    setShowSatellitePhotos(false);
                    setShowSensors(false);
                    setShowSensorInfo(false);
                    setShowSensorFov(false);
                    setSunLineActive(false);
                    setMoonLineActive(false);
                    removeSensorLines();
                    setOrbitPlotState(null);
                    setSelectedFeature(null);
                }}
            >
                <FeatureHost active={activeFeature} />
            </Footer>
            {filterPanelVisible && (
                <div className="filter-panel-placeholder">
                    <h4>Satellite Filters</h4>
                    <p>Filter by Country, NORAD, or Year (coming soon).</p>
                </div>
            )}
            <SelectedObjectPanel satellite={selectedSatellite} />
        </>
    );
};


