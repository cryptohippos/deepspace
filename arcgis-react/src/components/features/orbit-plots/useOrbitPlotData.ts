import { useCallback, useEffect, useRef, useState } from 'react';
import type {
    OrbitPlotMode,
    OrbitPlotSeries,
    OrbitPlotWorkerRequest,
    OrbitPlotWorkerResponse,
    OrbitPlotWorkerSeries
} from './types';

interface OrbitPlotState {
    series: OrbitPlotSeries[] | null;
    isLoading: boolean;
    error: string | null;
}

const DEFAULT_POINTS = 120;

export const useOrbitPlotData = (worker: Worker | null, mode: OrbitPlotMode, initialData: OrbitPlotSeries[] | null = null) => {
    const [{ series, error, isLoading }, setState] = useState<OrbitPlotState>({
        series: initialData,
        error: null,
        isLoading: false
    });
    const requestIdRef = useRef(0);
    const pendingModeRef = useRef<OrbitPlotMode | null>(null);
    const hasRequestedRef = useRef(false);

    useEffect(() => {
        if (!worker) {
            setState({ series: null, error: 'Orbit worker unavailable', isLoading: false });
            return;
        }

        const handleMessage = (event: MessageEvent) => {
            const data = event.data as OrbitPlotWorkerResponse | any;
            if (!data || data.type !== 'orbitSample') {
                return;
            }
            if (data.requestId !== requestIdRef.current) {
                return;
            }
            const mode = pendingModeRef.current;
            if (!mode || mode !== data.mode) {
                return;
            }
            const normalized: OrbitPlotSeries[] = (data.series ?? []).map((entry: OrbitPlotWorkerSeries) => ({
                id: entry.id,
                name: entry.name ?? `Sat ${entry.id}`,
                points: (entry.points ?? []).map((p) => ({
                    x: (p?.[0] ?? 0) / 1000,
                    y: (p?.[1] ?? 0) / 1000,
                    z: (p?.[2] ?? 0) / 1000,
                    time: p?.[3] ?? 0
                }))
            }));
            pendingModeRef.current = null;
            hasRequestedRef.current = true;
            setState({ series: normalized, error: null, isLoading: false });
        };

        const handleError = () => {
            if (pendingModeRef.current) {
                hasRequestedRef.current = false;
                setState({ series: null, error: 'Failed to sample orbit', isLoading: false });
                pendingModeRef.current = null;
            }
        };

        worker.addEventListener('message', handleMessage);
        worker.addEventListener('error', handleError);

        return () => {
            worker.removeEventListener('message', handleMessage);
            worker.removeEventListener('error', handleError);
        };
    }, [worker]);

    const requestData = useCallback((ids: number[]) => {
        if (!worker) {
            hasRequestedRef.current = false;
            setState({ series: null, error: 'Orbit worker unavailable', isLoading: false });
            return;
        }
        if (!ids || !ids.length) {
            hasRequestedRef.current = false;
            setState({ series: null, error: 'Select a satellite to view this plot.', isLoading: false });
            return;
        }
        requestIdRef.current = (requestIdRef.current + 1) % Number.MAX_SAFE_INTEGER;
        pendingModeRef.current = mode;
        setState(prev => ({ series: prev.series, error: null, isLoading: true }));
        const message: OrbitPlotWorkerRequest = {
            type: 'orbitSample',
            requestId: requestIdRef.current,
            ids,
            points: DEFAULT_POINTS,
            mode
        };
        try {
            worker.postMessage(message);
        } catch (err) {
            setState({ series: null, error: err instanceof Error ? err.message : 'Failed to sample orbit', isLoading: false });
            pendingModeRef.current = null;
            hasRequestedRef.current = false;
        }
        hasRequestedRef.current = true;
    }, [mode, worker]);

    return {
        data: series,
        isLoading,
        error,
        requestData,
        hasRequestedRef,
        hydrate: useCallback((payload: OrbitPlotSeries[] | null) => {
            hasRequestedRef.current = payload !== null;
            setState({ series: payload, error: null, isLoading: false });
        }, [])
    };
};
