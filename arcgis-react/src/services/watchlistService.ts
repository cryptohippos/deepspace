import { SatelliteService, type SatelliteData } from './satelliteService';

export interface WatchlistState {
    ids: number[];
    satellites: SatelliteData[];
}

export interface WatchlistMutationResult {
    added: SatelliteData[];
    duplicates: SatelliteData[];
    missing: string[];
}

export interface WatchlistImportResult {
    added: SatelliteData[];
    missing: string[];
}

type Listener = (state: WatchlistState) => void;

type InstancedApi = {
    setWatchlistFlags?: (flags: Float32Array | number[]) => void;
};

const STORAGE_KEY = 'arcglobe.watchlist.norads';
const DEFAULT_WATCHLIST_PATH = '/tle/watchlist.json';

const decodeTokens = (input: string): string[] => {
    if (!input) return [];
    return input
        .split(/[\s,]+/)
        .map((token) => token.trim())
        .filter(Boolean);
};

class WatchlistService {
    private static instance: WatchlistService | null = null;

    static getInstance(): WatchlistService {
        if (!WatchlistService.instance) {
            WatchlistService.instance = new WatchlistService();
        }
        return WatchlistService.instance;
    }

    private readonly satelliteService = SatelliteService.getInstance();
    private metadata: SatelliteData[] = [];
    private metadataById = new Map<number, SatelliteData>();
    private ids: number[] = [];
    private idSet = new Set<number>();
    private listeners = new Set<Listener>();
    private instancedApi: InstancedApi | null = null;
    private flags = new Float32Array(0);
    private hydrated = false;
    private initializing = false;
    private pendingHydrate: Promise<WatchlistImportResult> | null = null;

    private constructor() {
        this.syncMetadata();
        this.satelliteService.subscribe(() => {
            this.syncMetadata();
            this.reconcileIds();
            this.rebuildFlags();
            this.syncRenderer();
            this.notify();
        });
    }

    /**
     * Hydrate the watchlist from persistent storage or the default JSON file.
     */
    async hydrate(defaultPath: string = DEFAULT_WATCHLIST_PATH): Promise<WatchlistImportResult> {
        if (this.pendingHydrate) {
            return this.pendingHydrate;
        }
        if (this.hydrated) {
            return { added: this.getSatellites(), missing: [] };
        }
        this.initializing = true;
        this.pendingHydrate = this.performHydrate(defaultPath)
            .finally(() => {
                this.initializing = false;
                this.pendingHydrate = null;
            });
        return this.pendingHydrate;
    }

    private async performHydrate(defaultPath: string): Promise<WatchlistImportResult> {
        let persistedNorads: string[] = [];
        if (typeof window !== 'undefined') {
            try {
                const raw = window.localStorage?.getItem(STORAGE_KEY);
                if (raw) {
                    const parsed = JSON.parse(raw);
                    if (Array.isArray(parsed)) {
                        persistedNorads = parsed.map((value) => String(value)).filter(Boolean);
                    }
                }
            } catch (error) {
                console.warn('WatchlistService: unable to read stored watchlist', error);
            }
        }

        let result: WatchlistImportResult = { added: [], missing: [] };
        if (persistedNorads.length > 0) {
            result = this.replaceWithNorads(persistedNorads);
        } else if (defaultPath) {
            try {
                const response = await fetch(defaultPath, { cache: 'no-store' });
                if (response.ok) {
                    const json = await response.json();
                    if (Array.isArray(json)) {
                        const norads = json.map((value) => String(value)).filter(Boolean);
                        result = this.replaceWithNorads(norads);
                    }
                }
            } catch (error) {
                console.warn('WatchlistService: unable to fetch default watchlist', error);
            }
        }

        this.hydrated = true;
        this.rebuildFlags();
        this.syncRenderer();
        this.persist();
        this.notify();
        return result;
    }

    /**
     * Subscribe to watchlist updates.
     */
    subscribe(listener: Listener): () => void {
        this.listeners.add(listener);
        listener(this.getState());
        return () => {
            this.listeners.delete(listener);
        };
    }

    /**
     * Attach the instanced renderer API for GPU highlighting.
     */
    setRenderer(instancedApi: InstancedApi | null): void {
        this.instancedApi = instancedApi;
        this.syncRenderer();
    }

    /**
     * Current watchlist state snapshot.
     */
    getState(): WatchlistState {
        return {
            ids: this.ids.slice(),
            satellites: this.getSatellites()
        };
    }

    /**
     * Returns true if the satellite is in the watchlist.
     */
    isOnWatchlist(id: number | null | undefined): boolean {
        if (typeof id !== 'number' || Number.isNaN(id)) return false;
        return this.idSet.has(id);
    }

    /**
     * Add satellites using a free-form input string (comma/whitespace separated norad values).
     */
    addFromInput(input: string): WatchlistMutationResult {
        const tokens = decodeTokens(input);
        return this.addByNorads(tokens);
    }

    /**
     * Add satellites using a list of NORAD identifiers.
     */
    addByNorads(norads: string[]): WatchlistMutationResult {
        const resolved = this.resolveNorads(norads);
        const added: SatelliteData[] = [];
        const duplicates: SatelliteData[] = [];

        for (const sat of resolved.found) {
            if (this.idSet.has(sat.id)) {
                duplicates.push(sat);
                continue;
            }
            this.ids.push(sat.id);
            this.idSet.add(sat.id);
            added.push(sat);
        }

        if (added.length > 0 || (resolved.missing.length > 0 && !this.initializing)) {
            this.rebuildFlags();
            this.syncRenderer();
            this.persist();
            this.notify();
        }

        return {
            added,
            duplicates,
            missing: resolved.missing
        };
    }

    /**
     * Toggle membership for a satellite id. Returns true if now on the watchlist.
     */
    toggle(id: number): boolean {
        if (this.idSet.has(id)) {
            this.remove(id);
            return false;
        }
        this.addByIds([id]);
        return true;
    }

    /**
     * Add satellites using internal ids.
     */
    addByIds(ids: number[]): WatchlistMutationResult {
        const added: SatelliteData[] = [];
        const duplicates: SatelliteData[] = [];
        const missing: string[] = [];

        for (const id of ids) {
            if (typeof id !== 'number' || Number.isNaN(id)) {
                continue;
            }
            const sat = this.metadataById.get(id);
            if (!sat) {
                missing.push(String(id));
                continue;
            }
            if (this.idSet.has(id)) {
                duplicates.push(sat);
                continue;
            }
            this.ids.push(id);
            this.idSet.add(id);
            added.push(sat);
        }

        if (added.length > 0) {
            this.rebuildFlags();
            this.syncRenderer();
            this.persist();
            this.notify();
        }

        return { added, duplicates, missing };
    }

    /**
     * Remove a satellite id from the watchlist.
     */
    remove(id: number): void {
        if (!this.idSet.has(id)) {
            return;
        }
        this.ids = this.ids.filter((candidate) => candidate !== id);
        this.idSet.delete(id);
        this.rebuildFlags();
        this.syncRenderer();
        this.persist();
        this.notify();
    }

    /**
     * Clear the watchlist entirely.
     */
    clear(): void {
        if (this.ids.length === 0) {
            return;
        }
        this.ids = [];
        this.idSet.clear();
        this.rebuildFlags();
        this.syncRenderer();
        this.persist();
        this.notify();
    }

    /**
     * Export the watchlist as a JSON string of NORAD identifiers.
     */
    export(): string {
        const norads = this.ids
            .map((id) => this.metadataById.get(id)?.norad)
            .filter((value): value is string => Boolean(value));
        return JSON.stringify(norads, null, 2);
    }

    /**
     * Replace the watchlist using a JSON payload.
     */
    importFromJson(json: string): WatchlistImportResult {
        if (!json) {
            return { added: [], missing: [] };
        }
        try {
            const parsed = JSON.parse(json);
            if (!Array.isArray(parsed)) {
                throw new Error('Expected array payload');
            }
            const norads = parsed.map((value) => String(value)).filter(Boolean);
            const result = this.replaceWithNorads(norads);
            this.rebuildFlags();
            this.syncRenderer();
            this.persist();
            this.notify();
            return result;
        } catch (error) {
            console.error('WatchlistService: failed to import watchlist JSON', error);
            throw error;
        }
    }

    private replaceWithNorads(norads: string[]): WatchlistImportResult {
        const resolved = this.resolveNorads(norads);
        this.ids = resolved.found.map((sat) => sat.id);
        this.idSet = new Set(resolved.found.map((sat) => sat.id));
        return {
            added: resolved.found,
            missing: resolved.missing
        };
    }

    private resolveNorads(norads: string[]): { found: SatelliteData[]; missing: string[] } {
        const found: SatelliteData[] = [];
        const missing: string[] = [];
        const seen = new Set<number>();

        for (const token of norads) {
            if (!token) continue;
            const satellite = this.satelliteService.getSatelliteByNorad(token);
            if (satellite && typeof satellite.id === 'number') {
                if (!seen.has(satellite.id)) {
                    found.push(satellite);
                    seen.add(satellite.id);
                }
            } else {
                missing.push(token);
            }
        }

        return { found, missing };
    }

    private syncMetadata(): void {
        this.metadata = this.satelliteService.getAllSatellites();
        this.metadataById.clear();
        for (const sat of this.metadata) {
            if (typeof sat.id === 'number') {
                this.metadataById.set(sat.id, sat);
            }
        }
        this.rebuildFlags();
    }

    private reconcileIds(): void {
        if (this.ids.length === 0) {
            return;
        }
        const validIds: number[] = [];
        const newSet = new Set<number>();
        for (const id of this.ids) {
            if (this.metadataById.has(id) && !newSet.has(id)) {
                validIds.push(id);
                newSet.add(id);
            }
        }
        if (validIds.length !== this.ids.length) {
            this.ids = validIds;
            this.idSet = newSet;
            this.persist();
        } else {
            this.idSet = newSet;
        }
    }

    private rebuildFlags(): void {
        const length = this.metadata.length;
        if (length === 0) {
            this.flags = new Float32Array(0);
            return;
        }
        const next = new Float32Array(length);
        for (const id of this.ids) {
            if (id >= 0 && id < length) {
                next[id] = 1;
            }
        }
        this.flags = next;
    }

    private syncRenderer(): void {
        if (!this.instancedApi || typeof this.instancedApi.setWatchlistFlags !== 'function') {
            return;
        }
        try {
            this.instancedApi.setWatchlistFlags(this.flags);
        } catch (error) {
            console.warn('WatchlistService: failed to push watchlist flags to renderer', error);
        }
    }

    private persist(): void {
        if (typeof window === 'undefined') {
            return;
        }
        try {
            const norads = this.ids
                .map((id) => this.metadataById.get(id)?.norad)
                .filter((value): value is string => Boolean(value));
            window.localStorage?.setItem(STORAGE_KEY, JSON.stringify(norads));
        } catch (error) {
            console.warn('WatchlistService: failed to persist watchlist', error);
        }
    }

    private notify(): void {
        if (this.initializing) {
            return;
        }
        const snapshot = this.getState();
        for (const listener of this.listeners) {
            try {
                listener(snapshot);
            } catch (error) {
                console.error('WatchlistService listener error', error);
            }
        }
    }

    private getSatellites(): SatelliteData[] {
        const satellites: SatelliteData[] = [];
        for (const id of this.ids) {
            const sat = this.metadataById.get(id);
            if (sat) {
                satellites.push(sat);
            }
        }
        return satellites;
    }
}

export const watchlistService = WatchlistService.getInstance();


