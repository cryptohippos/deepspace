import { SENSOR_DEFINITIONS, SENSOR_GROUPS, type SensorDefinition, type SensorGroupDefinition } from '~/data/sensors';

const STORAGE_KEY = 'arcglobe.sensor.selection';

export interface SensorSelection {
    kind: 'none' | 'sensor' | 'group';
    sensorIds: string[];
    primaryId: string | null;
}

type Listener = (selection: SensorSelection) => void;

const SENSOR_MAP = new Map<string, SensorDefinition>(SENSOR_DEFINITIONS.map((sensor) => [sensor.id, sensor]));

const GROUP_MAP = new Map<string, SensorGroupDefinition>(SENSOR_GROUPS.map((group) => [group.id, group]));

const DEFAULT_SELECTION: SensorSelection = { kind: 'none', sensorIds: [], primaryId: null };

class SensorService {
    private static instance: SensorService | null = null;
    private readonly listeners = new Set<Listener>();
    private selection: SensorSelection = DEFAULT_SELECTION;

    static getInstance(): SensorService {
        if (!SensorService.instance) {
            SensorService.instance = new SensorService();
        }
        return SensorService.instance;
    }

    private constructor() {
        this.selection = this.loadSelection();
    }

    listGroups(): SensorGroupDefinition[] {
        return SENSOR_GROUPS.slice();
    }

    listSensors(): SensorDefinition[] {
        return SENSOR_DEFINITIONS.slice();
    }

    getSensor(id: string): SensorDefinition | undefined {
        return SENSOR_MAP.get(id);
    }

    getSensors(ids: string[]): SensorDefinition[] {
        const results: SensorDefinition[] = [];
        for (const id of ids) {
            const sensor = SENSOR_MAP.get(id);
            if (sensor) {
                results.push(sensor);
            }
        }
        return results;
    }

    getGroup(id: string): SensorGroupDefinition | undefined {
        return GROUP_MAP.get(id);
    }

    getSelection(): SensorSelection {
        return { ...this.selection, sensorIds: [...this.selection.sensorIds] };
    }

    selectSensor(sensorId: string): void {
        if (!sensorId || !SENSOR_MAP.has(sensorId)) {
            this.clearSelection();
            return;
        }
        const selection: SensorSelection = {
            kind: 'sensor',
            sensorIds: [sensorId],
            primaryId: sensorId
        };
        this.updateSelection(selection);
    }

    selectGroup(groupId: string): void {
        const group = GROUP_MAP.get(groupId);
        if (!group) {
            this.clearSelection();
            return;
        }
        const sensorIds = group.sensorIds.filter((id) => SENSOR_MAP.has(id));
        const primary = sensorIds.length > 0 ? sensorIds[0] : null;
        const selection: SensorSelection = {
            kind: 'group',
            sensorIds,
            primaryId: primary
        };
        this.updateSelection(selection);
    }

    clearSelection(): void {
        this.updateSelection(DEFAULT_SELECTION);
    }

    subscribe(listener: Listener): () => void {
        this.listeners.add(listener);
        listener(this.getSelection());
        return () => {
            this.listeners.delete(listener);
        };
    }

    private updateSelection(next: SensorSelection): void {
        this.selection = next;
        this.persistSelection(next);
        for (const listener of this.listeners) {
            try {
                listener(this.getSelection());
            } catch (error) {
                console.error('SensorService listener error:', error);
            }
        }
    }

    private persistSelection(selection: SensorSelection): void {
        if (typeof window === 'undefined') return;
        try {
            if (selection.kind === 'none') {
                window.localStorage.removeItem(STORAGE_KEY);
            } else {
                window.localStorage.setItem(STORAGE_KEY, JSON.stringify(selection));
            }
        } catch (error) {
            console.warn('SensorService: unable to persist selection', error);
        }
    }

    private loadSelection(): SensorSelection {
        if (typeof window === 'undefined') {
            return DEFAULT_SELECTION;
        }
        try {
            const raw = window.localStorage.getItem(STORAGE_KEY);
            if (!raw) {
                return DEFAULT_SELECTION;
            }
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object') {
                return DEFAULT_SELECTION;
            }
            const sensorIds = Array.isArray(parsed.sensorIds) ? parsed.sensorIds.filter((id: unknown) => typeof id === 'string' && SENSOR_MAP.has(id as string)) : [];
            if (!sensorIds.length) {
                return DEFAULT_SELECTION;
            }
            const primary = typeof parsed.primaryId === 'string' && SENSOR_MAP.has(parsed.primaryId) ? parsed.primaryId : sensorIds[0];
            const kind = parsed.kind === 'group' ? 'group' : 'sensor';
            return {
                kind,
                sensorIds,
                primaryId: primary
            };
        } catch (error) {
            console.warn('SensorService: unable to load stored selection', error);
            return DEFAULT_SELECTION;
        }
    }
}

export const sensorService = SensorService.getInstance();

