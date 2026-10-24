/**
 * Geometry of the last screenshot of a tab. The model sees screenshot pixels; CDP input
 * wants CSS pixels of the viewport. Keeping both sizes makes the mapping independent of
 * devicePixelRatio and of how much the image was scaled down.
 */
export interface ScreenshotGeometry {
    imageWidth: number;
    imageHeight: number;
    cssWidth: number;
    cssHeight: number;
}

export interface Point {
    x: number;
    y: number;
}

/** Maps a point in screenshot pixels to CSS pixels, clamped to the viewport. */
export function screenshotToCss(point: Point, geometry: ScreenshotGeometry): Point {
    const x = point.x * geometry.cssWidth / geometry.imageWidth;
    const y = point.y * geometry.cssHeight / geometry.imageHeight;
    return {
        x: clamp(x, 0, geometry.cssWidth - 1),
        y: clamp(y, 0, geometry.cssHeight - 1)
    };
}

/** Maps a point in CSS pixels to screenshot pixels (for showing the cursor in images or tests). */
export function cssToScreenshot(point: Point, geometry: ScreenshotGeometry): Point {
    return {
        x: point.x * geometry.imageWidth / geometry.cssWidth,
        y: point.y * geometry.imageHeight / geometry.cssHeight
    };
}

/**
 * Size to scale a capture to: the long edge at most `maxEdge` and the area at most `maxPixels`,
 * never upscaled. Keeps screenshots inside model image limits and token budgets.
 */
export function fitImageSize(width: number, height: number, maxEdge = 1280, maxPixels = 1_150_000): { width: number; height: number } {
    const scale = Math.min(1, maxEdge / Math.max(width, height), Math.sqrt(maxPixels / (width * height)));
    return {
        width: Math.max(1, Math.round(width * scale)),
        height: Math.max(1, Math.round(height * scale))
    };
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), Math.max(min, max));
}
