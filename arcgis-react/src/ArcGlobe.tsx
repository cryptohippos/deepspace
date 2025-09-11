import React, { useEffect, useRef } from 'react';

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

    useEffect(() => {
        let view: any;
        let workerClient: any = null;
        let tickLoop: any = null;
        let satelliteLayer: any;
        let debrisLayer: any;
        let tracksLayer: any;
        const graphics: any[] = [];

        let isInteracting = false; void isInteracting;
        let chunker: any = null;

        function start(Map: any, SceneView: any, GraphicsLayer: any, Graphic: any) {
            const scene = (window as any).ArcgisLayers?.createGlobeScene(divRef.current!, Map, SceneView, GraphicsLayer);
            view = scene.view;
            satelliteLayer = scene.layers.satellites;
            debrisLayer = scene.layers.debris;
            tracksLayer = scene.layers.tracks;

            function addSatGraphic(sat: any) {
                const now = new Date();
                const pt = (window as any).ArcgisCoords?.getSatPointFromTle(now, sat.tle1, sat.tle2);
                if (!pt) return;
                const g = (window as any).ArcgisLayers?.addSatGraphic(satelliteLayer, Graphic, pt, {
                    name: sat.name || 'SAT',
                    id: graphics.length,
                    tle1: sat.tle1,
                    tle2: sat.tle2,
                    t0: Date.now(),
                    norad: sat.norad || null,
                    launchDate: sat.launchDate || null,
                    country: sat.country || null,
                });
                graphics.push(g);
            }

            function addDebrisGraphic(sat: any) {
                const now = new Date();
                const pt = (window as any).ArcgisCoords?.getSatPointFromTle(now, sat.tle1, sat.tle2);
                if (!pt) return;
                (window as any).ArcgisLayers?.addDebrisGraphic(debrisLayer, Graphic, pt, { name: sat.name || 'DEBRIS', tle1: sat.tle1, tle2: sat.tle2 });
            }

            function drawTrackForGraphic(graphic: any) {
                if (workerClient && (window as any).ArcgisTracks) {
                    (window as any).ArcgisTracks.drawTrackForGraphic(
                        graphic,
                        tracksLayer,
                        workerClient,
                        Graphic,
                        (window as any).ArcgisCoords.createTrackPolyline
                    );
                } else {
                    // Simple fallback: compute on main thread (rare)
                    try {
                        tracksLayer.removeAll();
                        const positions: number[][] = [];
                        const minutes = 60 * 24;
                        const startTime = new Date();
                        for (let i = 0; i < minutes; i++) {
                            const t = new Date(startTime.getTime() + i * 60 * 1000);
                            const pt = (window as any).ArcgisCoords?.getSatPointFromTle(t, graphic.attributes.tle1, graphic.attributes.tle2);
                            if (pt) positions.push([pt.x, pt.y, pt.z]);
                        }
                        if (positions.length > 1) {
                            const line = new Graphic({
                                geometry: (window as any).ArcgisCoords.createTrackPolyline(positions),
                                symbol: { type: 'line-3d', symbolLayers: [{ type: 'line', size: 2, material: { color: [192, 192, 192, 0.6] } }] },
                            });
                            tracksLayer.add(line);
                        }
                    } catch { }
                }
            }

            view.when(() => {
                view.popup.autoOpenEnabled = false;

                view.on('immediate-click', (evt: any) => {
                    view.hitTest(evt).then((res: any) => {
                        const feat = res.results && res.results.find((r: any) => r.layer === satelliteLayer)?.graphic;
                        tracksLayer.removeAll();
                        if (feat) drawTrackForGraphic(feat);
                    });
                });

                setInterval(() => {
                    view.environment.lighting.date = new Date();
                }, 1000);

                let uiRef: any = null;
                if (window.ArcgisUI?.createUI) {
                    uiRef = window.ArcgisUI.createUI({
                        root: document.body,
                        sets: ['Satellites', 'Debris'],
                        selected: ['Satellites', 'Debris'],
                        onChange: (sel: string[]) => {
                            satelliteLayer.visible = sel.includes('Satellites');
                            debrisLayer.visible = sel.includes('Debris');
                        },
                    });
                }

                view.on('pointer-move', (evt: any) => {
                    if (!uiRef) return;
                    view.hitTest(evt).then((res: any) => {
                        const hit = res.results && res.results.find((r: any) => r.layer === satelliteLayer)?.graphic;
                        if (!hit) { uiRef.hideHover(); return; }
                        const attr = hit.attributes || {};
                        const name = attr.name || 'SAT';
                        const norad = attr.norad ? String(attr.norad) : '—';
                        const launch = attr.launchDate || '—';
                        const country = (attr.country || '').toString().toUpperCase();
                        const flagUrl = country && country.length <= 3 ? `/flags/${country.toLowerCase()}.png` : '';
                        const img = flagUrl ? `<img src="${flagUrl}" alt="${country}" style="height:12px;vertical-align:middle;margin-right:6px"/>` : '';
                        const html = `${img}<b>${name}</b><br/>NORAD: ${norad}<br/>Launched: ${launch}`;
                        uiRef.showHover(html, evt.x, evt.y);
                    });
                });
            });

            (async function loadData() {
                try {
                    const MAX_SATS = 1000;
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


                    (datasets.main || []).slice(0, MAX_SATS).forEach(addSatGraphic);
                    (datasets.debris || []).slice(0, 5000).forEach(addDebrisGraphic);

                    try {
                        // Wrap worker via simple client
                        workerClient = (window as any).ArcgisWorkerClient?.createSatWorkerClient('/arcgis/worker.js');
                        const payload = (datasets.main || []).slice(0, MAX_SATS).map((s: any, idx: number) => ({ id: idx, name: s.name || 'SAT', tle1: s.tle1, tle2: s.tle2 }));
                        workerClient.init(payload);

                        workerClient.onPositions((arr: Float32Array) => {
                            if (!chunker) chunker = (window as any).ArcgisChunker?.createGeometryChunker(graphics, 4326);
                            if (chunker) chunker.feed(arr);
                        });

                        // Visibility-aware ticking
                        tickLoop = (window as any).ArcgisTickLoop?.createVisibilityTickLoop(() => {
                            try { workerClient.requestTick(Date.now()); } catch { }
                        }, 1000);

                        view.watch('interacting', (v: boolean) => { if (chunker) chunker.setInteracting(!!v); });
                    } catch {
                        setInterval(() => {
                            const now = new Date();
                            for (let i = 0; i < graphics.length; i++) {
                                const g = graphics[i];
                                const pt = (window as any).ArcgisCoords?.getSatPointFromTle(now, g.attributes.tle1, g.attributes.tle2);
                                if (pt) g.geometry = pt;
                            }
                        }, 1000);
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
            try { (view as any)?.destroy?.(); } catch { }
            try { workerClient?.dispose?.(); } catch { }
            try { tickLoop?.dispose?.(); } catch { }
            try { chunker?.dispose?.(); } catch { }
        };
    }, []);

    return <div id="viewDiv" ref={divRef} style={{ position: 'absolute', inset: 0 }} />;
};


