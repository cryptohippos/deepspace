declare namespace __esri {
    interface Graphic {
        geometry?: unknown;
        symbol?: unknown;
        attributes?: Record<string, unknown>;
    }

    interface GraphicsLayer {
        add(graphic: Graphic): void;
        remove(graphic: Graphic): void;
        removeAll(): void;
    }

    interface PointProperties {
        type: 'point';
        longitude: number;
        latitude: number;
        z?: number;
    }

    interface SceneView {
        container: HTMLElement;
        width: number;
        height: number;
        externalRenderers?: { items?: Array<{ renderer?: unknown }> };
        takeScreenshot(options: {
            width: number;
            height: number;
            format?: 'png' | 'jpg';
            quality?: number;
        }): Promise<{
            dataUrl: string;
            width: number;
            height: number;
            format: string;
        }>;
        destroy(): void;
        goTo(target: PointProperties | { target: PointProperties; position?: PointProperties; tilt?: number }, options?: { duration?: number; easing?: string }): Promise<void>;
        graphics?: {
            add(graphic: Graphic): void;
            remove(graphic: Graphic): void;
        };
    }
}


