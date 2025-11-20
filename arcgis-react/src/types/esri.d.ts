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
}


