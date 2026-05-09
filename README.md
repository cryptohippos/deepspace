# Deepspace

Deepspace is an ArcGIS-based satellite visualization and orbital analysis app. The actual product code lives in `arcgis-react`.

This repository was forked from `keeptrack.space`, so many top-level directories (`src`, `public`, `build`, `test`, `docs`) are still the classic KeepTrack app and supporting assets. Treat those as upstream/reference unless you are intentionally working on the fork. For normal Deepspace work, start in `arcgis-react`.

## Run Locally

Prerequisites:

- Node.js and npm
- Network access to the ArcGIS JS SDK CDN, `satellite.js`, KeepTrack APIs, CelesTrak, and the configured imagery providers

```bash
cd arcgis-react
npm install
npm run dev
```

The app runs on `http://localhost:8081`.

Useful app scripts:

```bash
npm run dev       # Start Vite on port 8081
npm run build     # Type-check and production build
npm run lint      # Run ESLint
npm run preview   # Preview the production build
```

## App Layout

```text
arcgis-react/
|-- index.html                         # Loads ArcGIS JS SDK, satellite.js, helper scripts, React entry
|-- package.json                       # Vite/React scripts and app dependencies
|-- vite.config.ts                     # Port 8081 and /api-keeptrack proxy
|-- src/
|   |-- main.tsx                       # React entry point
|   |-- ArcGlobe.tsx                   # Main ArcGIS scene, worker, renderer, and feature coordinator
|   |-- components/header/             # Feature menu, filters, reset controls
|   |-- components/features/           # Tool panels rendered by FeatureHost
|   |-- components/selected/           # Selected satellite detail panel
|   |-- components/footer/             # Bottom-sheet host for active feature panels
|   |-- services/                      # Shared app state and renderer-facing service objects
|   |-- data/sensors.ts                # Generated ground sensor catalog and sensor groups
|   |-- styles/                        # App and feature CSS
|   `-- types/                         # ArcGIS/third-party type shims
`-- public/
    |-- arcgis/modules/data-loader.js  # Catalog/TLE loader and source fallback logic
    |-- arcgis/modules/ui.js           # Browser-loaded ArcGIS UI glue
    |-- arcgis/worker.js               # satellite.js propagation/orbit sampling worker
    |-- arcgis/instanced/              # Custom ArcGIS external renderer
    |-- tle/                           # Local TLE fallback/enrichment JSON
    `-- images/flags/                  # Static UI assets
```

## Architecture

`arcgis-react/index.html` loads the ArcGIS JS SDK from `https://js.arcgis.com/4.29/`, `satellite.js`, and browser-global helper scripts from `public/arcgis`. Vite then boots `src/main.tsx`, which mounts `ArcGlobe`.

`ArcGlobe` is the integration hub. It creates the ArcGIS `Map` and `SceneView`, adds graphics layers for orbit tracks, sensor lines, and sensor FOV meshes, loads satellite catalogs, starts the propagation worker, attaches the custom instanced renderer, and routes feature-menu selections into React panels.

The app deliberately splits responsibilities:

- React owns feature panels, active tool state, selected satellite metadata, filters, and user interactions.
- `public/arcgis/worker.js` owns TLE propagation, orbit tracks, ECI/ECF orbit sampling, and user-created satellite worker state.
- `public/arcgis/instanced/customLayer.js` and `renderer.js` own high-volume satellite drawing, picking, highlighting, watchlist flags, color buffers, and renderer capture.
- Services under `src/services` bridge UI state to app data and renderer APIs.

## Runtime Flow

1. `index.html` loads ArcGIS, `satellite.js`, `data-loader.js`, and `ui.js`.
2. `src/main.tsx` mounts `ArcGlobe`.
3. `ArcGlobe` creates the ArcGIS `SceneView` and adds support layers.
4. `ArcgisDataLoader.loadAllSources()` pulls KeepTrack/CelesTrak/local TLE data.
5. `ArcGlobe` normalizes catalog records into `SatelliteData` and initializes `SatelliteService`.
6. `/arcgis/worker.js` receives the TLE payload and starts responding to `tick`, `track`, `addSatellite`, and `orbitSample` messages.
7. The worker posts propagated positions back once per second.
8. `ArcGlobe` forwards position buffers to the instanced renderer and recomputes sensor coverage when needed.
9. Feature panels call services or `ArcGlobe` callbacks to update renderer visibility, selections, overlays, and charts.

## Key Services

- `SatelliteService`: normalized satellite metadata, NORAD/name indexes, user-created satellites, worker reference.
- `WatchlistService`: local watchlist persistence, NORAD resolution, renderer watchlist flags, overlay flags.
- `SensorService`: sensor/group selection, local persistence, sensor catalog access.
- `ColorSchemeService`: object-type and mono color schemes, renderer color buffers.
- `OrbitPlotService`: worker-backed ECI/ECF sample requests and subscriptions.
- `ScreenshotService`: ArcGIS view capture plus custom renderer capture fallback.
- `SatellitePhotoService`: satellite imagery provider definitions, caching, refresh behavior.
- `TooltipService`: satellite hover/selection tooltip HTML.

## Feature Maturity

| Feature area | Status | Notes |
| --- | --- | --- |
| ArcGIS globe, catalog load, worker propagation, instanced rendering | Fully usable | Main scene, API loading, worker ticks, renderer updates, picking, and highlighting are wired end-to-end. |
| Satellite click selection and selected object panel | Fully usable | Click selects renderer object, draws an orbit track, shows metadata/TLE-derived orbital fields. |
| Reset View | Fully usable | Clears selected object, tracks, renderer filters/highlights, sensor selections, and active panels. |
| Color Schemes | Fully usable | Object-type and mono schemes produce renderer color buffers and persist active scheme. |
| Take Photo | Fully usable | Captures via instanced renderer when available and falls back to ArcGIS `takeScreenshot`. |
| Sensors and Sensor Info | Fully usable | Sensor/group browser, selected sensor details, and sun/moon line controls are wired. |
| Collision Analysis | Partial | Fetches SOCRATES data and highlights resolved satellite pairs, but depends on external API shape and is mostly a highlighting workflow. |
| Constellation Analysis | Partial | Heuristic grouping from TLE fields; selection can highlight groups, hover is intentionally non-disruptive/no-op. |
| Create Satellite | Partial | Adds an in-memory user satellite and posts it to the worker; no persistence, and generated TLEs should be treated as rough/notional. |
| Watchlist | Partial | Add/import/localStorage and renderer flags exist. Default `/tle/watchlist.json` is referenced but not present, so default hydrate usually does nothing. |
| Satellite Photos | Partial | UI and provider cache exist, but providers are direct external image/API calls and can fail due to network/CORS/provider availability. |
| Sensor FOV and coverage tinting | Partial | Real FOV mesh and coverage color logic exists, but the math/visuals are approximate and not deeply validated. |
| Orbit Plots | Partial | Worker supports ECI/ECF sampling and ECharts renders plots, but request plumbing is duplicated between `OrbitPlotService` and `useOrbitPlotData`. |
| Filters | Partial | Filter panel calls renderer visibility, but country options are hardcoded and may not match normalized catalog owner values. |
| Debris Scanner | Experimental / not trustworthy | UI exists, but scanner treats renderer snapshots as position/velocity vectors while the current renderer path is mostly lon/lat/height plus weak/zero velocity data. Results should not be considered valid. |
| Feature menu search | Not working | Search currently logs results only; `handleSearchSatellites` still has a TODO for visual filtering. |
| New Launch | Not working | Menu item only logs selection. |
| Create Breakup | Not working | Menu item only logs selection. |

## Data Sources

The ArcGIS app uses a mix of live and local sources:

- `/api-keeptrack/v3/sats`, proxied by Vite to `https://api.keeptrack.space/v3/sats`
- `/api-keeptrack/v3/satcat/latest` for SATCAT metadata
- `https://api.keeptrack.space/v2/socrates/latest` for collision data
- `https://celestrak.org/NORAD/elements/gp.php` for configured CelesTrak groups
- Local fallback/enrichment files under `arcgis-react/public/tle`
- External imagery URLs/APIs in `SatellitePhotoService`

The Vite proxy only covers `/api-keeptrack`. Direct browser calls to CelesTrak and imagery providers still depend on network and browser policy.

## Development Notes

- Use `arcgis-react/src/ArcGlobe.tsx` as the first stop for scene lifecycle, worker wiring, renderer wiring, selected satellite state, feature toggles, and panel routing.
- Add user-facing tools under `arcgis-react/src/components/features`, register the tool in `FeatureHost`, then add a menu entry in `components/header/FeatureMenu.tsx`.
- Put cross-panel state or renderer-facing behavior in `arcgis-react/src/services` instead of passing it through unrelated components.
- Keep high-volume satellite drawing out of React. Use the worker for propagation/math and the instanced renderer for bulk drawing, picking, filtering, and highlighting.
- `arcgis-react/src/data/sensors.ts` is generated. Update the generator/source data instead of hand-editing it if the generation pipeline is available.
- Browser-global ArcGIS helper scripts in `arcgis-react/public/arcgis` are intentionally not bundled by Vite. Moving them into `src` means updating the ArcGIS AMD/global loading assumptions.

## KeepTrack Fork Reference

The root `package.json` still belongs to the inherited KeepTrack app. Only use these commands when validating or changing the forked KeepTrack code, not for normal Deepspace ArcGIS work.

```bash
npm install
npm run build
npm start
```

Useful root scripts:

```bash
npm run build       # KeepTrack production build
npm run build:dev   # KeepTrack development build
npm run build:watch # KeepTrack development watch build
npm run lint        # KeepTrack lint
npm test            # KeepTrack Jest tests
npm start           # Serve root dist on port 5544
```

## License

This repository includes a fork of KeepTrack.Space, which is licensed under the GNU Affero General Public License. See `LICENSE` for the repository license text.
