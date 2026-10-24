import { describe, expect, it } from 'vitest';
import { cssToScreenshot, fitImageSize, screenshotToCss, type ScreenshotGeometry } from '../src/coords';

describe('fitImageSize', () => {
    it('keeps small images as they are', () => {
        expect(fitImageSize(800, 600)).toEqual({ width: 800, height: 600 });
    });

    it('limits the long edge', () => {
        expect(fitImageSize(2560, 1440)).toEqual({ width: 1280, height: 720 });
    });

    it('limits the area for tall images', () => {
        const size = fitImageSize(1200, 1200);
        expect(size.width * size.height).toBeLessThanOrEqual(1_150_000);
        expect(size.width).toBe(size.height);
    });
});

describe('screenshotToCss', () => {
    // A 1440x900 CSS viewport on a 2x display, captured at 2880x1800 and scaled to 1280x800.
    const geometry: ScreenshotGeometry = { imageWidth: 1280, imageHeight: 800, cssWidth: 1440, cssHeight: 900 };

    it('maps screenshot pixels to CSS pixels', () => {
        expect(screenshotToCss({ x: 640, y: 400 }, geometry)).toEqual({ x: 720, y: 450 });
    });

    it('round-trips', () => {
        const css = screenshotToCss({ x: 100, y: 50 }, geometry);
        const back = cssToScreenshot(css, geometry);
        expect(back.x).toBeCloseTo(100);
        expect(back.y).toBeCloseTo(50);
    });

    it('clamps to the viewport', () => {
        expect(screenshotToCss({ x: 5000, y: -20 }, geometry)).toEqual({ x: 1439, y: 0 });
    });
});
