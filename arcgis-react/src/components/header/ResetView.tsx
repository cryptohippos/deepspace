import React, { type MutableRefObject, useCallback } from 'react';
import type { TooltipService } from '../../services/tooltipService';

interface ResetViewDependencies {
    instancedApiRef: MutableRefObject<any>;
    tooltipService: Pick<TooltipService, 'hideTooltip'>;
    tracksLayerRef: MutableRefObject<__esri.GraphicsLayer | null>;
    trackGraphicsRef: MutableRefObject<Map<number, __esri.Graphic>>;
    selectedIdRef: MutableRefObject<number | null>;
    setShowCollisionAnalysis: (value: boolean) => void;
    setShowConstellationAnalysis: (value: boolean) => void;
    setShowDebrisScanner: (value: boolean) => void;
    setShowCreateSatellite: (value: boolean) => void;
    setSelectedFeature: (value: string | null) => void;
}

export const createResetViewHandler = ({
    instancedApiRef,
    tooltipService,
    tracksLayerRef,
    trackGraphicsRef,
    selectedIdRef,
    setShowCollisionAnalysis,
    setShowConstellationAnalysis,
    setShowDebrisScanner,
    setShowCreateSatellite,
    setSelectedFeature
}: ResetViewDependencies): (() => void) => {
    return () => {
        const api = instancedApiRef.current;
        if (api) {
            api.resetVisibility?.();
            api.setHighlightedSatellite?.(null, undefined, false);
            api.setSelectedId?.(-1);
        }

        selectedIdRef.current = null;

        tooltipService.hideTooltip();
        trackGraphicsRef.current.forEach((graphic) => {
            tracksLayerRef.current?.remove?.(graphic);
        });
        trackGraphicsRef.current.clear();

        setShowCollisionAnalysis(false);
        setShowConstellationAnalysis(false);
        setShowDebrisScanner(false);
        setShowCreateSatellite(false);
        setSelectedFeature(null);
    };
};

interface ResetViewProps {
    onReset: () => void;
    disabled?: boolean;
}

export const ResetView: React.FC<ResetViewProps> = ({ onReset, disabled }) => {
    const handleClick = useCallback(() => {
        if (!disabled) {
            onReset();
        }
    }, [disabled, onReset]);

    return (
        <button
            className="reset-view-button"
            type="button"
            title="Reset to all satellites"
            onClick={handleClick}
            disabled={disabled}
        >
            Reset View
        </button>
    );
};

