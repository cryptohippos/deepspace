import React from 'react';
import { CollisionAnalysis, type CollisionEvent } from '~/components/features/CollisionAnalysis';
import { ConstellationAnalysis } from '~/components/features/ConstellationAnalysis';
import { CreateSatellite } from '~/components/features/CreateSatellite';
import { DebrisScanner } from '~/components/features/DebrisScanner';
import { ColorSchemePanel } from '~/components/features/color-schemes/ColorSchemePanel';
import { OrbitPlot } from '~/components/features/orbit-plots/OrbitPlot';
import type { OrbitPlotMode, OrbitPlotSeries } from '~/components/features/orbit-plots/types';
import { SatellitePhotosPanel } from '~/components/features/satellite-photos/SatellitePhotosPanel';
import { TakePhotoPanel } from '~/components/features/take-photo/TakePhotoPanel';
import { WatchlistPanel } from '~/components/features/watchlist/WatchlistPanel';

export type ActiveFeature =
    | { name: 'collision'; props: { onClose: () => void; onCollisionSelect: (e: CollisionEvent) => void } }
    | { name: 'constellation'; props: { onClose: () => void; onConstellationSelect: (c: any) => void; onConstellationHighlight: (c: any, i?: 'hover' | 'select' | 'clear') => void } }
    | { name: 'create-satellite'; props: { onClose: () => void; onSatelliteCreated: (sat: any) => void } }
    | { name: 'debris-scanner'; props: { onClose: () => void; getInstancedApi: () => any; satelliteService: any } }
    | { name: 'color-schemes'; props: { onClose: () => void } }
    | { name: 'take-photo'; props: { onClose: () => void } }
    | { name: 'watchlist'; props: { onClose: () => void; onFocusSatellite: (id: number) => void } }
    | { name: 'satellite-photos'; props: { onClose: () => void; onFocusSatellite: (id: number) => void } }
    | { name: 'orbit-plot'; props: { onClose: () => void; mode: OrbitPlotMode; worker: Worker | null; satelliteIds: number[]; title: string; data: OrbitPlotSeries[] | null; loading: boolean; error: string | null } };

interface FeatureHostProps {
    active: ActiveFeature | null;
}

export const FeatureHost: React.FC<FeatureHostProps> = ({ active }) => {
    if (!active) return null;
    switch (active.name) {
        case 'collision':
            return (
                <CollisionAnalysis
                    isVisible={true}
                    onClose={active.props.onClose}
                    onCollisionSelect={active.props.onCollisionSelect}
                />
            );
        case 'constellation':
            return (
                <ConstellationAnalysis
                    isVisible={true}
                    onClose={active.props.onClose}
                    onConstellationSelect={active.props.onConstellationSelect}
                    onConstellationHighlight={active.props.onConstellationHighlight}
                />
            );
        case 'create-satellite':
            return (
                <CreateSatellite
                    isVisible={true}
                    onClose={active.props.onClose}
                    onSatelliteCreated={active.props.onSatelliteCreated}
                />
            );
        case 'debris-scanner':
            return (
                <DebrisScanner
                    isVisible={true}
                    onClose={active.props.onClose}
                    getInstancedApi={active.props.getInstancedApi}
                    satelliteService={active.props.satelliteService}
                />
            );
        case 'color-schemes':
            return (
                <ColorSchemePanel
                    isVisible={true}
                    onClose={active.props.onClose}
                />
            );
        case 'take-photo':
            return (
                <TakePhotoPanel
                    isVisible={true}
                    onClose={active.props.onClose}
                />
            );
        case 'watchlist':
            return (
                <WatchlistPanel
                    isVisible={true}
                    onClose={active.props.onClose}
                    onFocusSatellite={active.props.onFocusSatellite}
                />
            );
        case 'satellite-photos':
            return (
                <SatellitePhotosPanel
                    isVisible={true}
                    onClose={active.props.onClose}
                    onFocusSatellite={active.props.onFocusSatellite}
                />
            );
        case 'orbit-plot':
            return (
                <OrbitPlot
                    isVisible={true}
                    mode={active.props.mode}
                    worker={active.props.worker}
                    satelliteIds={active.props.satelliteIds}
                    title={active.props.title}
                    onClose={active.props.onClose}
                    initialData={active.props.data}
                    isRemoteLoading={active.props.loading}
                    errorMessage={active.props.error}
                />
            );
        default:
            return null;
    }
};
