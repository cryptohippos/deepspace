import type {
    OrbitPlotEvent,
    OrbitPlotMode,
    OrbitPlotSeries,
    OrbitPlotWorkerRequest,
    OrbitPlotWorkerResponse,
    OrbitPlotWorkerSeries
} from '~/components/features/orbit-plots/types';
import { SatelliteService } from './satelliteService';

type OrbitPlotListener = (event: OrbitPlotEvent) => void;

class OrbitPlotService {
    private static instance: OrbitPlotService;

    private listeners: Set<OrbitPlotListener> = new Set();

    private pendingMode: OrbitPlotMode | null = null;

    private requestId = 0;

    private worker: Worker | null = null;

    static getInstance(): OrbitPlotService {
        if (!OrbitPlotService.instance) {
            OrbitPlotService.instance = new OrbitPlotService();
        }
        return OrbitPlotService.instance;
    }

    private constructor() {
        this.ensureWorkerListener();
    }

    private getWorker(): Worker | null {
        const satService = SatelliteService.getInstance();
        return satService.getWorkerInstance?.() ?? null;
    }

    private ensureWorkerListener(): Worker | null {
        const current = this.getWorker();
        if (current && current !== this.worker) {
            if (this.worker) {
                this.worker.removeEventListener('message', this.handleWorkerMessage);
            }
            current.addEventListener('message', this.handleWorkerMessage);
            this.worker = current;
        }
        return current ?? this.worker;
    }

    private handleWorkerMessage = (event: MessageEvent) => {
        const data = event.data as OrbitPlotWorkerResponse | any;
        if (!data || data.type !== 'orbitSample') {
            return;
        }
        if (this.pendingMode === null || data.mode !== this.pendingMode || data.requestId !== this.requestId) {
            return;
        }
        const series: OrbitPlotSeries[] = (data.series ?? []).map((entry: OrbitPlotWorkerSeries) => ({
            id: entry.id,
            name: entry.name ?? `Sat ${entry.id}`,
            points: (entry.points ?? []).map((p) => ({
                x: (p?.[0] ?? 0) / 1000,
                y: (p?.[1] ?? 0) / 1000,
                z: (p?.[2] ?? 0) / 1000,
                time: p?.[3] ?? 0
            }))
        }));
        this.pendingMode = null;
        const payload: OrbitPlotEvent = {
            mode: data.mode,
            series,
            requestId: data.requestId
        };
        this.listeners.forEach((listener) => listener(payload));
    };

    requestOrbitSamples(mode: OrbitPlotMode, ids: number[], points = 120): number {
        const worker = this.ensureWorkerListener();
        if (!worker) {
            throw new Error('Orbit worker unavailable');
        }
        if (!ids.length) {
            throw new Error('No satellites available for orbit plotting');
        }

        this.requestId = (this.requestId + 1) % Number.MAX_SAFE_INTEGER;
        this.pendingMode = mode;
        const message: OrbitPlotWorkerRequest = {
            type: 'orbitSample',
            requestId: this.requestId,
            ids,
            points,
            mode
        };

        worker.postMessage(message);
        return this.requestId;
    }

    subscribe(listener: OrbitPlotListener): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }
}

export const orbitPlotService = OrbitPlotService.getInstance();

