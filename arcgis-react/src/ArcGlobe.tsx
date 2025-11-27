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

import React, { useEffect, useRef, useState } from 'react';
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
import { SatelliteService, type SatelliteData } from './services/satelliteService';
import { screenshotService } from './services/screenshotService';
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
    const trackGraphicsRef = useRef<Map<number, __esri.Graphic>>(new Map());
    const selectedIdRef = useRef<number | null>(null);
    const isLoadingRef = useRef(true);
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

    const handleCloseOrbitPlot = () => {
        setOrbitPlotState(null);
        setSelectedFeature(null);
        orbitPlotRequestRef.current = null;
    };

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
        setSelectedFeature,
        onSelectedSatelliteChange: clearSelectedSatellite
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

        switch (feature) {
            case 'collision':
                setShowCollisionAnalysis(true);
                setShowConstellationAnalysis(false);
                setShowCreateSatellite(false);
                setShowDebrisScanner(false);
                setShowColorSchemes(false);
                setShowTakePhoto(false);
                setShowWatchlist(false);
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
                break;
            case 'take-photo':
                setShowTakePhoto(true);
                setShowCollisionAnalysis(false);
                setShowConstellationAnalysis(false);
                setShowDebrisScanner(false);
                setShowCreateSatellite(false);
                setShowColorSchemes(false);
                setShowWatchlist(false);
                break;
            case 'watchlist':
                setShowWatchlist(true);
                setShowCollisionAnalysis(false);
                setShowConstellationAnalysis(false);
                setShowDebrisScanner(false);
                setShowCreateSatellite(false);
                setShowColorSchemes(false);
                setShowTakePhoto(false);
                break;
            case 'debris-scanner':
                setShowDebrisScanner(true);
                setShowCollisionAnalysis(false);
                setShowConstellationAnalysis(false);
                setShowCreateSatellite(false);
                setShowColorSchemes(false);
                setShowTakePhoto(false);
                setShowWatchlist(false);
                clearSelectedSatellite();
                break;
            case 'eci-plot':
                handleOpenOrbitPlot('eci');
                setShowColorSchemes(false);
                setShowTakePhoto(false);
                setShowWatchlist(false);
                break;
            case 'ecf-plot':
                handleOpenOrbitPlot('ecf');
                setShowColorSchemes(false);
                setShowTakePhoto(false);
                setShowWatchlist(false);
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


        function start(Map: any, SceneView: any, GraphicsLayer: any, Graphic: any) {
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
                            try {
                                instancedApi?.setBaseColors?.(colorSchemeService.getColorBuffer());
                            } catch (error) {
                                console.warn('ArcGlobe: Unable to push initial color buffer to renderer', error);
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
                                    if (useInstanced && instancedApi) {
                                        const count = Math.floor(arr.length / 3);
                                        instancedApi.updatePositions(arr.buffer, count);
                                        if (expectedSatelliteCount > 0 && count >= expectedSatelliteCount && isLoadingRef.current) {
                                            requestAnimationFrame(() => {
                                                setTimeout(() => {
                                                    markLoaded();
                                                }, 150);
                                            });
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
                    ['esri/Map', 'esri/views/SceneView', 'esri/layers/GraphicsLayer', 'esri/Graphic'],
                    (Map: any, SceneView: any, GraphicsLayer: any, Graphic: any) => start(Map, SceneView, GraphicsLayer, Graphic)
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
            selectedIdRef.current = null;
            setIsLoading(false);
            isLoadingRef.current = false;
            clearSelectedSatellite();
        };
    }, []);

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
            const instancedApi = instancedApiRef.current;
            if (instancedApi?.setBaseColors) {
                try {
                    instancedApi.setBaseColors(buffer);
                } catch (error) {
                    console.warn('ArcGlobe: Failed to push color buffer to renderer', error);
                }
            }
        });
        return unsubscribe;
    }, []);

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
                                    : activeFeature.name === 'orbit-plot' ? activeFeature.props.title
                                        : null
    ) : null;

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


