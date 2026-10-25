/**
 * Screenshots through CDP, scaled down for the model. The geometry of each tab's last
 * screenshot is kept so coordinates the model reads off that image map back to CSS pixels.
 */
import { fitImageSize, screenshotToCss, type Point, type ScreenshotGeometry } from '@datalabrotterdam/nova-ai-browser-protocol';
import { send } from './cdp';
import { overlay } from './content';

const geometries = new Map<number, ScreenshotGeometry>();

/** Longest page a full-page screenshot covers, in CSS pixels (about 20 viewports). */
const MAX_FULL_PAGE_HEIGHT = 16_384;
/** Long edge of the model's copy of a full-page screenshot; its pixel budget stays that of a normal screenshot. */
const FULL_PAGE_MAX_EDGE = 4_096;
/** Limits of the user's full-resolution copy: canvas size limits, and a reasonable image to open. */
const MAX_FULL_IMAGE_SIDE = 16_384;
const MAX_FULL_IMAGE_PIXELS = 40_000_000;

export interface Capture {
    data: string;
    mimeType: string;
    geometry: ScreenshotGeometry;
}

/**
 * Window size in CSS pixels. innerWidth/innerHeight include scrollbars, exactly like the captured
 * surface; layout metrics' clientWidth does not, which would skew every coordinate by the scrollbar.
 */
async function viewportSize(tabId: number): Promise<{ width: number; height: number; dpr: number }> {
    const { result } = await send<{ result: { value: [number, number, number] } }>(tabId, 'Runtime.evaluate', {
        expression: '[window.innerWidth, window.innerHeight, window.devicePixelRatio]',
        returnByValue: true
    });
    const [width, height, dpr] = result.value;
    return { width, height, dpr: dpr || 1 };
}

function toBase64(bytes: Uint8Array): string {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
}

function fromBase64(data: string): Uint8Array<ArrayBuffer> {
    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

async function encode(bitmap: ImageBitmap, source: { x: number; y: number; width: number; height: number }, width: number, height: number): Promise<string> {
    const { canvas, context } = canvas2d(width, height);
    context.drawImage(bitmap, source.x, source.y, source.width, source.height, 0, 0, width, height);
    return toJpeg(canvas);
}

async function toJpeg(canvas: OffscreenCanvas, quality = 0.82): Promise<string> {
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
    return toBase64(new Uint8Array(await blob.arrayBuffer()));
}

async function captureRaw(tabId: number, showCursor: boolean): Promise<ImageBitmap> {
    if (!showCursor) {
        await overlay(tabId, { type: 'overlay/capture-begin' });
    }
    try {
        const { data } = await send<{ data: string }>(tabId, 'Page.captureScreenshot', {
            format: 'png',
            fromSurface: true,
            captureBeyondViewport: false
        });
        return await createImageBitmap(new Blob([fromBase64(data)], { type: 'image/png' }));
    } finally {
        if (!showCursor) {
            await overlay(tabId, { type: 'overlay/capture-end' });
        }
    }
}

export async function screenshot(tabId: number, options: { showCursor?: boolean } = {}): Promise<Capture> {
    const css = await viewportSize(tabId);
    const bitmap = await captureRaw(tabId, options.showCursor ?? false);
    try {
        const size = fitImageSize(bitmap.width, bitmap.height);
        const data = await encode(bitmap, { x: 0, y: 0, width: bitmap.width, height: bitmap.height }, size.width, size.height);
        const geometry: ScreenshotGeometry = { imageWidth: size.width, imageHeight: size.height, cssWidth: css.width, cssHeight: css.height };
        geometries.set(tabId, geometry);
        return { data, mimeType: 'image/jpeg', geometry };
    } finally {
        bitmap.close();
    }
}

export interface FullPageCapture extends Capture {
    /** The page's size in CSS pixels, and whether it was longer than the capture. */
    pageWidth: number;
    pageHeight: number;
    truncated: boolean;
    /** The page at screen resolution, for the user only. */
    full: { data: string; mimeType: string; width: number; height: number };
}

function canvas2d(width: number, height: number): { canvas: OffscreenCanvas; context: OffscreenCanvasRenderingContext2D } {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not create a canvas for the screenshot.');
    context.imageSmoothingQuality = 'high';
    return { canvas, context };
}

async function evaluate<T>(tabId: number, expression: string): Promise<T> {
    const { result } = await send<{ result: { value: T } }>(tabId, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    return result.value;
}

/**
 * The whole scrollable page, stitched from one capture per viewport while scrolling
 * (chrome.debugger only captures the visible surface). Returns it twice: at screen resolution
 * for the user, and scaled into the screenshot budget for the model. For looking only: its
 * pixels are page coordinates, so it leaves the tab's geometry for clicks alone.
 * ponytail: fixed and sticky headers show on every slice, and pages that scroll an inner element
 * instead of the window come out as one viewport; hide fixed elements while capturing if that matters.
 */
export async function fullPageScreenshot(tabId: number, options: { showCursor?: boolean } = {}): Promise<FullPageCapture> {
    const css = await viewportSize(tabId);
    const [scrollX, scrollY, scrollHeight] = await evaluate<[number, number, number]>(tabId, '[window.scrollX, window.scrollY, document.documentElement.scrollHeight]');
    const pageHeight = Math.ceil(scrollHeight);
    const height = Math.min(pageHeight, MAX_FULL_PAGE_HEIGHT);
    // Screen resolution, within what canvases and image viewers handle.
    const fullScale = Math.min(css.dpr, MAX_FULL_IMAGE_SIDE / height, Math.sqrt(MAX_FULL_IMAGE_PIXELS / (css.width * height)));
    const full = canvas2d(Math.round(css.width * fullScale), Math.round(height * fullScale));

    try {
        for (let top = 0, previous = -1; top < height;) {
            // The last slice is clamped by the browser; draw it where it really is.
            const actual = await evaluate<number>(tabId, `window.scrollTo(0, ${top}), new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(window.scrollY))))`);
            if (actual <= previous) break; // the window does not scroll any further
            previous = actual;
            const bitmap = await captureRaw(tabId, options.showCursor ?? false);
            try {
                // Place each slice by its own size: the viewport can shrink meanwhile (Chrome's debugging bar).
                const sliceHeight = bitmap.height * css.width / bitmap.width;
                full.context.drawImage(bitmap, 0, actual * fullScale, full.canvas.width, sliceHeight * fullScale);
                top = actual + sliceHeight;
            } finally {
                bitmap.close();
            }
        }
    } finally {
        await evaluate(tabId, `window.scrollTo(${scrollX}, ${scrollY})`);
    }

    const size = fitImageSize(css.width, height, FULL_PAGE_MAX_EDGE);
    const scaled = canvas2d(size.width, size.height);
    scaled.context.drawImage(full.canvas, 0, 0, size.width, size.height);
    return {
        data: await toJpeg(scaled.canvas),
        mimeType: 'image/jpeg',
        geometry: { imageWidth: size.width, imageHeight: size.height, cssWidth: css.width, cssHeight: height },
        pageWidth: css.width,
        pageHeight,
        truncated: pageHeight > height,
        full: { data: await toJpeg(full.canvas, 0.9), mimeType: 'image/jpeg', width: full.canvas.width, height: full.canvas.height }
    };
}

/** Close-up of a region given in screenshot pixels. Does not change the tab's geometry. */
export async function zoom(tabId: number, region: [number, number, number, number], options: { showCursor?: boolean } = {}): Promise<Capture> {
    const geometry = await geometryFor(tabId);
    const [x0, y0, x1, y1] = region;
    if (!(x1 > x0 && y1 > y0)) {
        throw new Error('region must be [x0, y0, x1, y1] with x1 > x0 and y1 > y0.');
    }
    const bitmap = await captureRaw(tabId, options.showCursor ?? false);
    try {
        const scaleX = bitmap.width / geometry.imageWidth;
        const scaleY = bitmap.height / geometry.imageHeight;
        const source = { x: x0 * scaleX, y: y0 * scaleY, width: (x1 - x0) * scaleX, height: (y1 - y0) * scaleY };
        // Upscale small regions so text is legible, within the same size limits as screenshots.
        const target = fitImageSize(source.width * 4, source.height * 4);
        const data = await encode(bitmap, source, target.width, target.height);
        return { data, mimeType: 'image/jpeg', geometry: { imageWidth: target.width, imageHeight: target.height, cssWidth: source.width, cssHeight: source.height } };
    } finally {
        bitmap.close();
    }
}

/**
 * Geometry of the tab's last screenshot, or the geometry a screenshot would have now.
 * Screenshot size is deterministic, so coordinates stay meaningful even without a fresh capture.
 */
export async function geometryFor(tabId: number): Promise<ScreenshotGeometry> {
    const known = geometries.get(tabId);
    if (known) return known;
    const css = await viewportSize(tabId);
    const size = fitImageSize(Math.round(css.width * css.dpr), Math.round(css.height * css.dpr));
    return { imageWidth: size.width, imageHeight: size.height, cssWidth: css.width, cssHeight: css.height };
}

export async function toCssPoint(tabId: number, coordinate: unknown): Promise<Point> {
    if (!Array.isArray(coordinate) || coordinate.length !== 2 || !coordinate.every((n) => Number.isFinite(Number(n)))) {
        throw new Error('coordinate must be [x, y] in screenshot pixels.');
    }
    return screenshotToCss({ x: Number(coordinate[0]), y: Number(coordinate[1]) }, await geometryFor(tabId));
}

export function forgetGeometry(tabId: number): void {
    geometries.delete(tabId);
}
