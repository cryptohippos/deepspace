const DEFAULT_FILENAME_PREFIX = 'arcglobe';
const MIME_TYPE = 'image/png';

export interface ScreenshotRequest {
    width: number;
    height: number;
    fileName?: string;
}

export interface ScreenshotResult {
    blob: Blob;
    dataUrl: string;
    width: number;
    height: number;
    fileName: string;
}

type InstancedCaptureResult = {
    dataUrl: string;
    width: number;
    height: number;
} | null;

class ScreenshotService {
    private static instance: ScreenshotService | null = null;
    private view: __esri.SceneView | null = null;
    private instancedApi: { capture?: (params: { width: number; height: number }) => InstancedCaptureResult | Promise<InstancedCaptureResult> } | null = null;

    static getInstance(): ScreenshotService {
        if (!ScreenshotService.instance) {
            ScreenshotService.instance = new ScreenshotService();
        }
        return ScreenshotService.instance;
    }

    setView(view: __esri.SceneView | null): void {
        this.view = view;
    }

    clearView(): void {
        this.view = null;
    }

    setInstancedApi(instancedApi: { capture?: (params: { width: number; height: number }) => InstancedCaptureResult | Promise<InstancedCaptureResult> } | null): void {
        this.instancedApi = instancedApi ?? null;
    }

    async capture(request: ScreenshotRequest): Promise<ScreenshotResult> {
        if (!this.view) {
            throw new Error('ScreenshotService: SceneView is not ready.');
        }

        const requestedWidth = Math.max(1, Math.floor(request.width));
        const requestedHeight = Math.max(1, Math.floor(request.height));

        const base = await this.captureFromInstancedRenderer(requestedWidth, requestedHeight)
            ?? await this.view.takeScreenshot({ width: requestedWidth, height: requestedHeight, format: 'png', quality: 1 });

        if (!base || !base.dataUrl) {
            throw new Error('ScreenshotService: Unable to capture screenshot.');
        }

        const normalized = this.normalizeDimensions(requestedWidth, requestedHeight, base.width, base.height);

        const fileName = this.ensureFileName(request.fileName);

        let dataUrl = base.dataUrl;
        let width = base.width;
        let height = base.height;

        if (width !== normalized.width || height !== normalized.height) {
            const scaled = await this.scaleImage(base.dataUrl, base.width, base.height, normalized.width, normalized.height);
            dataUrl = scaled.dataUrl;
            width = normalized.width;
            height = normalized.height;
        }

        const blob = await this.dataUrlToBlob(dataUrl);

        return {
            blob,
            dataUrl,
            width,
            height,
            fileName
        };
    }

    async download(request: ScreenshotRequest): Promise<ScreenshotResult> {
        const result = await this.capture(request);
        const url = URL.createObjectURL(result.blob);
        try {
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = result.fileName;
            anchor.rel = 'noopener';
            anchor.click();
        } finally {
            setTimeout(() => URL.revokeObjectURL(url), 0);
        }
        return result;
    }

    private async captureFromInstancedRenderer(width: number, height: number): Promise<{ dataUrl: string; width: number; height: number } | null> {
        if (!this.instancedApi || typeof this.instancedApi.capture !== 'function') {
            return null;
        }
        const result = await this.instancedApi.capture({ width, height });
        if (!result || typeof result.dataUrl !== 'string') {
            return null;
        }
        return result;
    }

    private ensureFileName(input?: string): string {
        const trimmed = (input ?? '').trim();
        if (!trimmed) {
            return this.buildDefaultFileName();
        }
        return trimmed.endsWith('.png') ? trimmed : `${trimmed}.png`;
    }

    private buildDefaultFileName(): string {
        const now = new Date();
        const pad = (value: number) => value.toString().padStart(2, '0');
        const timestamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}_${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
        return `${DEFAULT_FILENAME_PREFIX}-${timestamp}.png`;
    }

    private normalizeDimensions(requestWidth: number, requestHeight: number, baseWidth: number, baseHeight: number): { width: number; height: number } {
        if (requestWidth <= 0 || requestHeight <= 0) {
            return { width: baseWidth, height: baseHeight };
        }
        const aspect = baseWidth / baseHeight;
        let width = requestWidth;
        let height = requestHeight;
        const requestedAspect = width / height;
        if (Math.abs(requestedAspect - aspect) > 0.001) {
            if (requestedAspect > aspect) {
                width = Math.round(height * aspect);
            } else {
                height = Math.round(width / aspect);
            }
        }
        return { width, height };
    }

    private async scaleImage(dataUrl: string, sourceWidth: number, sourceHeight: number, targetWidth: number, targetHeight: number): Promise<{ dataUrl: string }> {
        const canvas = document.createElement('canvas');
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            throw new Error('ScreenshotService: Unable to acquire canvas context.');
        }

        await new Promise<void>((resolve, reject) => {
            const image = new Image();
            image.onload = () => {
                ctx.drawImage(image, 0, 0, sourceWidth, sourceHeight, 0, 0, targetWidth, targetHeight);
                resolve();
            };
            image.onerror = (error) => reject(error);
            image.src = dataUrl;
        });

        return { dataUrl: canvas.toDataURL(MIME_TYPE) };
    }

    private async dataUrlToBlob(dataUrl: string): Promise<Blob> {
        const [header, data] = dataUrl.split(',');
        if (!header || !data) {
            throw new Error('ScreenshotService: Invalid data URL.');
        }
        const isBase64 = header.includes('base64');
        const mime = header.match(/data:(.*?)(;base64)?$/)?.[1] ?? MIME_TYPE;

        if (isBase64) {
            const decoded = atob(data);
            const bytes = new Uint8Array(decoded.length);
            for (let i = 0; i < decoded.length; i++) {
                bytes[i] = decoded.charCodeAt(i);
            }
            return new Blob([bytes], { type: mime });
        }

        const decoded = decodeURIComponent(data);
        const encoder = new TextEncoder();
        return new Blob([encoder.encode(decoded)], { type: mime });
    }
}

export const screenshotService = ScreenshotService.getInstance();


