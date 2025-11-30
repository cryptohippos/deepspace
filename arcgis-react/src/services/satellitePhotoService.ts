export interface SatellitePhoto {
    id: string;
    providerId: string;
    label: string;
    imageUrl: string;
    captureTime?: string;
    noradId?: number;
    latitude?: number;
    longitude?: number;
    attribution?: string;
}

export interface SatellitePhotoProvider {
    id: string;
    name: string;
    description?: string;
    noradId?: number;
    fetchPhotos: () => Promise<SatellitePhoto[]>;
    refreshIntervalMs?: number;
}

const STATIC_PROVIDERS: Array<{
    id: string;
    name: string;
    description?: string;
    imageUrl: string | (() => string);
    noradId?: number;
    attribution?: string;
}> = [
        {
            id: 'meteosat11',
            name: 'Meteosat 11',
            description: 'EUMETSAT natural colour full disk imagery refreshed ~15 min.',
            imageUrl: 'https://eumetview.eumetsat.int/static-images/latestImages/EUMETSAT_MSG_RGBNatColour_LowResolution.jpg',
            noradId: 40732,
            attribution: 'EUMETSAT',
        },
        {
            id: 'meteosat9',
            name: 'Meteosat 9 (IODC)',
            description: 'Indian Ocean Data Coverage imagery refreshed ~15 min.',
            imageUrl: 'https://eumetview.eumetsat.int/static-images/latestImages/EUMETSAT_MSGIODC_RGBNatColour_LowResolution.jpg',
            noradId: 28912,
            attribution: 'EUMETSAT',
        },
        {
            id: 'goes16',
            name: 'GOES-16',
            description: 'NOAA full disk GeoColor imagery updated ~10 min.',
            imageUrl: 'https://cdn.star.nesdis.noaa.gov/GOES16/ABI/FD/GEOCOLOR/latest.jpg',
            noradId: 41866,
            attribution: 'NOAA STAR',
        },
        {
            id: 'goes18',
            name: 'GOES-18',
            description: 'GOES West GeoColor imagery updated ~10 min.',
            imageUrl: 'https://cdn.star.nesdis.noaa.gov/GOES18/ABI/FD/GEOCOLOR/latest.jpg',
            noradId: 51850,
            attribution: 'NOAA STAR',
        },
        {
            id: 'himawari8',
            name: 'Himawari-8',
            description: 'NICT Himawari-8 GeoColor imagery (~10 min cadence).',
            imageUrl: () => buildHimawariUrl(),
            noradId: 40267,
            attribution: 'NICT/JMA',
        }
    ];

const DSCOVR_PROVIDER_ID = 'dscovr-epic';
const DSCOVR_ENDPOINT = 'https://epic.gsfc.nasa.gov/api/natural';

const DEFAULT_REFRESH = 10 * 60 * 1000; // 10 minutes

interface ProviderCacheEntry {
    timestamp: number;
    photos: SatellitePhoto[];
}

class SatellitePhotoService {
    private static instance: SatellitePhotoService | null = null;

    static getInstance(): SatellitePhotoService {
        if (!SatellitePhotoService.instance) {
            SatellitePhotoService.instance = new SatellitePhotoService();
        }
        return SatellitePhotoService.instance;
    }

    private providers: SatellitePhotoProvider[];
    private cache: Map<string, ProviderCacheEntry> = new Map();
    private listeners = new Set<(providerId: string, photos: SatellitePhoto[]) => void>();

    private constructor() {
        this.providers = [
            ...STATIC_PROVIDERS.map((provider) => ({
                id: provider.id,
                name: provider.name,
                description: provider.description,
                noradId: provider.noradId,
                refreshIntervalMs: DEFAULT_REFRESH,
                fetchPhotos: async (): Promise<SatellitePhoto[]> => {
                    const url = typeof provider.imageUrl === 'function' ? provider.imageUrl() : provider.imageUrl;
                    return [
                        {
                            id: `${provider.id}-latest`,
                            providerId: provider.id,
                            label: `${provider.name} Latest`,
                            imageUrl: url,
                            noradId: provider.noradId,
                            attribution: provider.attribution,
                        }
                    ];
                }
            })),
            {
                id: DSCOVR_PROVIDER_ID,
                name: 'DSCOVR EPIC',
                description: 'NASA DSCOVR EPIC natural colour imagery.',
                refreshIntervalMs: 30 * 60 * 1000,
                fetchPhotos: async (): Promise<SatellitePhoto[]> => {
                    try {
                        const response = await fetch(DSCOVR_ENDPOINT, { cache: 'no-store' });
                        if (!response.ok) {
                            throw new Error(`HTTP ${response.status}`);
                        }
                        const json = await response.json();
                        if (!Array.isArray(json)) {
                            return [];
                        }
                        const limit = Math.min(json.length, 12);
                        const photos: SatellitePhoto[] = [];
                        for (let i = 0; i < limit; i++) {
                            const entry = json[i];
                            if (!entry?.identifier || !entry?.image) continue;
                            const captureTime = entry.date ?? entry.identifier;
                            const [year, month, day] = [
                                entry.identifier.substring(0, 4),
                                entry.identifier.substring(4, 6),
                                entry.identifier.substring(6, 8)
                            ];
                            const imageUrl = `https://epic.gsfc.nasa.gov/archive/natural/${year}/${month}/${day}/png/${entry.image}.png`;
                            photos.push({
                                id: `${DSCOVR_PROVIDER_ID}-${entry.identifier}`,
                                providerId: DSCOVR_PROVIDER_ID,
                                label: `DSCOVR ${captureTime}`,
                                imageUrl,
                                captureTime,
                                latitude: entry.centroid_coordinates?.lat,
                                longitude: entry.centroid_coordinates?.lon,
                                attribution: 'NASA EPIC',
                            });
                        }
                        return photos;
                    } catch (error) {
                        console.warn('SatellitePhotoService: DSCOVR fetch failed', error);
                        throw error;
                    }
                }
            }
        ];

        this.providers.push({
            id: 'elektro-l2',
            name: 'Elektro-L 2',
            description: 'Roscosmos Elektro-L full disk imagery (~30 min cadence).',
            refreshIntervalMs: 30 * 60 * 1000,
            noradId: 41105,
            fetchPhotos: async (): Promise<SatellitePhoto[]> => {
                const now = Date.now();
                const attempts = 8;
                for (let attempt = 0; attempt < attempts; attempt++) {
                    const candidateTime = new Date(now - (60 + attempt * 30) * 60 * 1000);
                    const url = buildElectroCandidateUrl(candidateTime);
                    try {
                        const response = await fetch(url, { cache: 'no-store' });
                        if (response.ok) {
                            const captureTime = candidateTime.toISOString();
                            return [{
                                id: `elektro-l2-${captureTime}`,
                                providerId: 'elektro-l2',
                                label: `Elektro-L 2 (${new Date(captureTime).toUTCString()})`,
                                imageUrl: url,
                                captureTime,
                                noradId: 41105,
                                attribution: 'Roscosmos',
                            }];
                        }
                    } catch (error) {
                        console.warn('SatellitePhotoService: Elektro-L attempt failed', url, error);
                    }
                }
                throw new Error('Elektro-L imagery unavailable at this time.');
            }
        });
    }

    getProviders(): SatellitePhotoProvider[] {
        return this.providers.slice();
    }

    subscribe(listener: (providerId: string, photos: SatellitePhoto[]) => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    async getPhotos(providerId: string, options: { force?: boolean } = {}): Promise<SatellitePhoto[]> {
        const provider = this.providers.find((p) => p.id === providerId);
        if (!provider) {
            throw new Error(`SatellitePhotoService: Unknown provider "${providerId}"`);
        }

        const now = Date.now();
        const cached = this.cache.get(providerId);

        if (!options.force && cached && now - cached.timestamp < (provider.refreshIntervalMs ?? DEFAULT_REFRESH)) {
            return cached.photos;
        }

        try {
            const photos = await provider.fetchPhotos();
            this.cache.set(providerId, { timestamp: now, photos });
            this.notify(providerId, photos);
            return photos;
        } catch (error) {
            if (cached) {
                console.warn(`SatellitePhotoService: Using cached photos for provider ${providerId}`);
                return cached.photos;
            }
            throw error;
        }
    }

    async refresh(providerId: string): Promise<SatellitePhoto[]> {
        this.cache.delete(providerId);
        return this.getPhotos(providerId, { force: true });
    }

    private notify(providerId: string, photos: SatellitePhoto[]): void {
        for (const listener of this.listeners) {
            try {
                listener(providerId, photos);
            } catch (error) {
                console.error('SatellitePhotoService listener error', error);
            }
        }
    }
}

const buildHimawariUrl = () => {
    const now = new Date();
    const utc = new Date(now.getTime() - 30 * 60 * 1000);
    const year = utc.getUTCFullYear();
    const month = String(utc.getUTCMonth() + 1).padStart(2, '0');
    const day = String(utc.getUTCDate()).padStart(2, '0');
    const hour = String(utc.getUTCHours()).padStart(2, '0');
    const minute = String(Math.floor(utc.getUTCMinutes() / 10) * 10).padStart(2, '0');
    return `https://himawari8.nict.go.jp/img/D531106/1d/550/${year}/${month}/${day}/${hour}${minute}00_0_0.png`;
};

const buildElectroCandidateUrl = (date: Date) => {
    const utcPlus3 = new Date(date.getTime() + 3 * 60 * 60 * 1000);
    utcPlus3.setMinutes(Math.floor(utcPlus3.getMinutes() / 30) * 30);
    utcPlus3.setSeconds(0);
    const year = utcPlus3.getUTCFullYear();
    const month = String(utcPlus3.getUTCMonth() + 1).padStart(2, '0');
    const day = String(utcPlus3.getUTCDate()).padStart(2, '0');
    const hour = String(utcPlus3.getUTCHours()).padStart(2, '0');
    return `https://electro.ntsomz.ru/i/splash/${year}${month}${day}-${hour}00.jpg`;
};

export const satellitePhotoService = SatellitePhotoService.getInstance();


