import { SatelliteService, type SatelliteData } from './satelliteService';

export type ColorSchemeId = 'object-type' | 'mono';

export type RgbaColor = [number, number, number, number];

export interface ColorSchemeDefinition {
    id: ColorSchemeId;
    label: string;
    description?: string;
    isMenuOption: boolean;
    legend?: Array<{ label: string; color: RgbaColor }>;
    computeColor: (satellite: SatelliteData) => RgbaColor;
}

type Listener = (context: { scheme: ColorSchemeDefinition; buffer: Float32Array }) => void;

const STORAGE_KEY = 'arcglobe.colorSchemeId';

const DEFAULT_COLORS = {
    payload: [0.2, 1.0, 0.2, 1.0] as RgbaColor,
    rocketBody: [1.0, 0.45, 0.1, 1.0] as RgbaColor,
    debris: [0.7, 0.7, 0.7, 1.0] as RgbaColor,
    unknown: [0.85, 0.35, 0.8, 1.0] as RgbaColor,
    default: [1.0, 0.8, 0.15, 1.0] as RgbaColor,
    userCreated: [0.0, 0.95, 0.95, 1.0] as RgbaColor
};

const clampColor = (value: number) => Math.min(Math.max(value, 0), 1);

const normalizeColor = (color: RgbaColor): RgbaColor => [
    clampColor(color[0]),
    clampColor(color[1]),
    clampColor(color[2]),
    clampColor(color[3] ?? 1)
];

const createObjectTypeScheme = (): ColorSchemeDefinition => ({
    id: 'object-type',
    label: 'Object Type',
    description: 'Color satellites by analytical object type classification.',
    isMenuOption: true,
    legend: [
        { label: 'Payload', color: DEFAULT_COLORS.payload },
        { label: 'Rocket body', color: DEFAULT_COLORS.rocketBody },
        { label: 'Debris', color: DEFAULT_COLORS.debris },
        { label: 'Special/Unknown', color: DEFAULT_COLORS.unknown }
    ],
    computeColor: (satellite) => {
        if (satellite.isUserCreated) {
            return DEFAULT_COLORS.userCreated;
        }
        const category = classifySatelliteCategory(satellite);
        switch (category) {
            case 'payload':
                return DEFAULT_COLORS.payload;
            case 'rocketBody':
                return DEFAULT_COLORS.rocketBody;
            case 'debris':
                return DEFAULT_COLORS.debris;
            case 'special':
            case 'unknown':
                return DEFAULT_COLORS.unknown;
            default:
                return DEFAULT_COLORS.default;
        }
    }
});

const createMonoScheme = (): ColorSchemeDefinition => ({
    id: 'mono',
    label: 'Single Color',
    description: 'Use the default render color for all satellites.',
    isMenuOption: true,
    computeColor: (satellite) => (satellite.isUserCreated ? DEFAULT_COLORS.userCreated : DEFAULT_COLORS.default)
});

type SatelliteCategory = 'payload' | 'rocketBody' | 'debris' | 'special' | 'unknown' | 'default';

const classifySatelliteCategory = (satellite: SatelliteData): SatelliteCategory => {
    if (satellite.isUserCreated) {
        return 'payload';
    }

    const normalizedType = satellite.objectType?.toUpperCase() ?? '';
    let category: SatelliteCategory | null = null;
    let sawExplicitUnknown = false;

    if (normalizedType) {
        if (normalizedType.includes('PAYLOAD') || normalizedType === 'PAY') {
            category = 'payload';
        } else if (normalizedType.includes('ROCKET') || normalizedType === 'R/B' || normalizedType === 'RB') {
            category = 'rocketBody';
        } else if (normalizedType.includes('DEBRIS') || normalizedType === 'DEB') {
            category = 'debris';
        } else if (normalizedType.includes('SPECIAL')) {
            category = 'special';
        } else if (normalizedType.includes('UNKNOWN') || normalizedType === 'UNK') {
            sawExplicitUnknown = true;
        }
    }

    if (!category && typeof satellite.type === 'number') {
        switch (satellite.type) {
            case 1:
                category = 'payload';
                break;
            case 2:
                category = 'rocketBody';
                break;
            case 3:
                category = 'debris';
                break;
            case 4:
                category = 'special';
                break;
            case 5:
                sawExplicitUnknown = true;
                break;
            default:
                break;
        }
    }

    if (!category) {
        const upperName = satellite.name?.toUpperCase() ?? '';
        if (upperName) {
            if (upperName.includes('STARLINK') || upperName.includes(' SAT') || upperName.startsWith('SAT-') || upperName.includes('PAYLOAD')) {
                category = 'payload';
            } else if (/\bR\/B\b/.test(upperName) || upperName.includes('ROCKET') || upperName.includes('BOOSTER') || /\bSTAGE\b/.test(upperName)) {
                category = 'rocketBody';
            } else if (upperName.includes(' DEB') || upperName.endsWith('DEB') || upperName.includes('DEBRIS') || upperName.includes(' FRAG') || upperName.includes(' OBJECT')) {
                category = 'debris';
            } else if (upperName.includes('UNKNOWN') || upperName.includes('TBA') || upperName.includes('PROTO') || upperName.includes('SPECIAL')) {
                category = 'special';
            }
        }
    }

    if (category) {
        return category;
    }

    return sawExplicitUnknown ? 'unknown' : 'default';
};

export class ColorSchemeService {
    private static instance: ColorSchemeService | null = null;

    static getInstance(): ColorSchemeService {
        if (!ColorSchemeService.instance) {
            ColorSchemeService.instance = new ColorSchemeService();
        }
        return ColorSchemeService.instance;
    }

    private readonly schemes: ColorSchemeDefinition[] = [createObjectTypeScheme(), createMonoScheme()];
    private metadata: SatelliteData[] = [];
    private buffer: Float32Array = new Float32Array(0);
    private listeners = new Set<Listener>();
    private activeSchemeId: ColorSchemeId = 'object-type';

    private constructor() {
        if (typeof window !== 'undefined') {
            const stored = window.localStorage?.getItem(STORAGE_KEY) as ColorSchemeId | null;
            if (stored && this.schemes.some((scheme) => scheme.id === stored)) {
                this.activeSchemeId = stored;
            }
        }
    }

    initialize(metadata: SatelliteData[]): void {
        this.metadata = metadata.slice();
        this.rebuildBuffer();
    }

    updateMetadata(metadata: SatelliteData[]): void {
        this.metadata = metadata.slice();
        this.rebuildBuffer();
    }

    getSchemes(): ColorSchemeDefinition[] {
        return this.schemes.slice();
    }

    getActiveScheme(): ColorSchemeDefinition {
        return this.findScheme(this.activeSchemeId);
    }

    setScheme(id: ColorSchemeId): void {
        if (id === this.activeSchemeId) {
            return;
        }
        if (!this.schemes.some((scheme) => scheme.id === id)) {
            return;
        }
        this.activeSchemeId = id;
        try {
            window.localStorage?.setItem(STORAGE_KEY, id);
        } catch {
            // Ignore storage errors
        }
        this.rebuildBuffer();
    }

    subscribe(listener: Listener): () => void {
        this.listeners.add(listener);
        // Send immediate snapshot so UI can render synchronously
        listener({ scheme: this.getActiveScheme(), buffer: this.buffer });
        return () => {
            this.listeners.delete(listener);
        };
    }

    getColorBuffer(): Float32Array {
        return this.buffer;
    }

    private findScheme(id: ColorSchemeId): ColorSchemeDefinition {
        return this.schemes.find((scheme) => scheme.id === id) ?? this.schemes[0];
    }

    private rebuildBuffer(): void {
        if (!Array.isArray(this.metadata) || !this.metadata.length) {
            this.buffer = new Float32Array(0);
            this.notify();
            return;
        }

        const scheme = this.findScheme(this.activeSchemeId);
        const length = this.metadata.length * 4;
        const nextBuffer = new Float32Array(length);

        for (let i = 0; i < this.metadata.length; i++) {
            const sat = this.metadata[i];
            const color = normalizeColor(scheme.computeColor(sat));
            const offset = i * 4;
            nextBuffer[offset] = color[0];
            nextBuffer[offset + 1] = color[1];
            nextBuffer[offset + 2] = color[2];
            nextBuffer[offset + 3] = color[3];
        }

        this.buffer = nextBuffer;
        this.notify();
    }

    private notify(): void {
        const scheme = this.findScheme(this.activeSchemeId);
        const snapshot = { scheme, buffer: this.buffer };
        for (const listener of this.listeners) {
            try {
                listener(snapshot);
            } catch (error) {
                console.error('[ColorSchemeService] listener error', error);
            }
        }
    }
}

export const colorSchemeService = ColorSchemeService.getInstance();

// Convenience bootstrap for areas that already have satellite service initialized
export const bootstrapColorSchemeService = () => {
    const satellites = SatelliteService.getInstance().getAllSatellites();
    colorSchemeService.initialize(satellites);
};

