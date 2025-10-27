export type OrbitPlotMode = 'eci' | 'ecf';

export interface OrbitPlotSeriesPoint {
    x: number;
    y: number;
    z: number;
    time: number; // epoch ms
}

export interface OrbitPlotSeries {
    id: number;
    name: string;
    points: OrbitPlotSeriesPoint[];
}

export type OrbitPlotWorkerPoint = [number, number, number, number];

export interface OrbitPlotWorkerSeries {
    id: number;
    name?: string | null;
    points: OrbitPlotWorkerPoint[];
}

export interface OrbitPlotWorkerRequest {
    type: 'orbitSample';
    requestId: number;
    ids: number[];
    points?: number;
    mode: OrbitPlotMode;
}

export interface OrbitPlotWorkerResponse {
    type: 'orbitSample';
    requestId: number;
    mode: OrbitPlotMode;
    series: OrbitPlotWorkerSeries[];
}

export interface OrbitPlotEvent {
    mode: OrbitPlotMode;
    series: OrbitPlotSeries[];
    requestId: number;
}

