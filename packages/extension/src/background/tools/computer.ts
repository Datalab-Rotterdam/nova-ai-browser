import { COMPUTER_ACTIONS, textResult, type Point, type ResolvedRef, type ToolResult } from '@datalabrotterdam/nova-ai-browser-protocol';
import { loadSettings } from '../../lib/settings';
import { overlay, pageRequest } from '../content';
import { click, drag, hover, parseModifiers, pressKeys, scroll, typeText, type MouseButton } from '../input';
import { fullPageScreenshot, geometryFor, screenshot, toCssPoint, zoom } from '../screenshot';
import { settle } from '../tabs';
import type { ToolContext } from './context';

const CLICKS: Record<string, { button: MouseButton; clickCount: number; verb: string; done: string }> = {
    left_click: { button: 'left', clickCount: 1, verb: 'Clicking', done: 'Clicked' },
    right_click: { button: 'right', clickCount: 1, verb: 'Right-clicking', done: 'Right-clicked' },
    middle_click: { button: 'middle', clickCount: 1, verb: 'Middle-clicking', done: 'Middle-clicked' },
    double_click: { button: 'left', clickCount: 2, verb: 'Double-clicking', done: 'Double-clicked' },
    triple_click: { button: 'left', clickCount: 3, verb: 'Triple-clicking', done: 'Triple-clicked' }
};

interface Target {
    point: Point;
    description: string;
}

async function resolveRef(tabId: number, ref: string): Promise<ResolvedRef> {
    return pageRequest<ResolvedRef>(tabId, { type: 'page/resolve', ref, scroll: true });
}

/** Where to act: a ref (exact, scrolled into view) or a screenshot coordinate. */
async function target(ctx: ToolContext, args: Record<string, unknown>, coordinateKey = 'coordinate'): Promise<Target> {
    if (typeof args.ref === 'string' && args.ref && coordinateKey === 'coordinate') {
        const resolved = await resolveRef(ctx.tabId, args.ref);
        if (resolved.coveredBy) {
            throw new Error(`${args.ref} (${resolved.description}) is covered by ${resolved.coveredBy}. Close or scroll past the covering element, or take a screenshot and click by coordinate.`);
        }
        return { point: { x: resolved.x, y: resolved.y }, description: resolved.description };
    }
    if (args[coordinateKey] === undefined) {
        throw new Error(`Provide ${coordinateKey === 'coordinate' ? '`ref` or `coordinate`' : `\`${coordinateKey}\``}.`);
    }
    const point = await toCssPoint(ctx.tabId, args[coordinateKey]);
    const description = await pageRequest<string>(ctx.tabId, { type: 'page/describe-point', x: point.x, y: point.y }).catch(() => 'the page');
    return { point, description };
}

function screenshotResult(capture: { data: string; mimeType: string; geometry: { imageWidth: number; imageHeight: number } }, note: string): ToolResult {
    return {
        content: [
            { type: 'text', text: `${note} Image is ${capture.geometry.imageWidth}x${capture.geometry.imageHeight}px; use these pixel coordinates.` },
            { type: 'image', data: capture.data, mimeType: capture.mimeType }
        ]
    };
}

function shortLabel(text: string): string {
    return text.length > 48 ? `${text.slice(0, 47)}…` : text;
}

/** Spellings models use for actions; accepting them saves a failed round trip. */
const ACTION_ALIASES: Record<string, string> = {
    click: 'left_click', left: 'left_click', tap: 'left_click',
    right: 'right_click', context_click: 'right_click', middle: 'middle_click',
    double: 'double_click', doubleclick: 'double_click', dblclick: 'double_click',
    triple: 'triple_click', tripleclick: 'triple_click',
    move: 'hover', mouse_move: 'hover', mousemove: 'hover',
    drag: 'left_click_drag', drag_and_drop: 'left_click_drag',
    type_text: 'type', input: 'type', write: 'type',
    press: 'key', keypress: 'key', key_press: 'key', hotkey: 'key',
    scroll_into_view: 'scroll_to', capture: 'screenshot', take_screenshot: 'screenshot', sleep: 'wait'
};

function normalizeAction(value: unknown): string {
    const action = String(value ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
    return ACTION_ALIASES[action] ?? ACTION_ALIASES[action.replace(/_/g, '')] ?? action;
}

export async function computer(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const action = normalizeAction(args.action);
    if (!(COMPUTER_ACTIONS as readonly string[]).includes(action)) {
        throw new Error(`Unknown action "${action}". Use one of: ${COMPUTER_ACTIONS.join(', ')}.`);
    }
    const { tabId } = ctx;
    const settings = await loadSettings();

    if (action in CLICKS) {
        const spec = CLICKS[action];
        const where = await target(ctx, args);
        await click(tabId, where.point, {
            button: spec.button,
            clickCount: spec.clickCount,
            modifiers: await parseModifiers(args.modifiers as string | undefined),
            label: shortLabel(`${spec.verb} ${where.description}`)
        });
        await settle(tabId);
        // Native <select> popups are drawn outside the page: invisible in screenshots and not clickable.
        const selectHint = where.description.startsWith('combobox') || where.description.startsWith('listbox')
            ? ' This is a dropdown whose options do not show in screenshots: choose an option with form_input (ref from read_page or find) and the option text.'
            : '';
        return textResult(`${spec.done} ${where.description}.${selectHint}`);
    }

    switch (action) {
        case 'screenshot': {
            await overlay(tabId, { type: 'overlay/label', label: 'Looking at the page' });
            if (args.full_page === true || args.full_page === 'true') {
                const page = await fullPageScreenshot(tabId, { showCursor: settings.showCursorInScreenshots });
                const cut = page.truncated ? ` Only the top ${page.geometry.cssHeight}px of the ${page.pageHeight}px page fit.` : '';
                return {
                    content: [
                        { type: 'text', text: `Full-page screenshot of tab ${tabId} (page ${page.pageWidth}x${page.pageHeight} CSS px), image ${page.geometry.imageWidth}x${page.geometry.imageHeight}px.${cut} For looking only: do not click by its coordinates; use refs or take a normal screenshot. The user sees it at full resolution.` },
                        { type: 'image', data: page.data, mimeType: page.mimeType }
                    ],
                    userImage: {
                        type: 'image',
                        data: page.full.data,
                        mimeType: page.full.mimeType,
                        note: `You see the full image (${page.full.width}×${page.full.height} px). Nova only got a scaled-down copy (${page.geometry.imageWidth}×${page.geometry.imageHeight} px) and can miss small text or details.${cut}`
                    }
                };
            }
            const capture = await screenshot(tabId, { showCursor: settings.showCursorInScreenshots });
            return screenshotResult(capture, `Screenshot of tab ${tabId}.`);
        }
        case 'zoom': {
            const region = args.region;
            if (!Array.isArray(region) || region.length !== 4) {
                throw new Error('zoom needs region [x0, y0, x1, y1] in screenshot pixels.');
            }
            const capture = await zoom(tabId, region.map(Number) as [number, number, number, number], { showCursor: settings.showCursorInScreenshots });
            return {
                content: [
                    { type: 'text', text: `Zoomed view of region [${region.join(', ')}]. Coordinates for clicks still refer to the full screenshot.` },
                    { type: 'image', data: capture.data, mimeType: capture.mimeType }
                ]
            };
        }
        case 'hover': {
            const where = await target(ctx, args);
            await hover(tabId, where.point, shortLabel(`Hovering ${where.description}`));
            await new Promise((resolve) => setTimeout(resolve, 300));
            return textResult(`Hovering over ${where.description}.`);
        }
        case 'left_click_drag': {
            const from = await target(ctx, args, 'start_coordinate');
            const to = await target(ctx, args, 'coordinate');
            await drag(tabId, from.point, to.point, shortLabel(`Dragging ${from.description}`));
            await settle(tabId);
            return textResult(`Dragged from ${from.description} to ${to.description}.`);
        }
        case 'type': {
            if (typeof args.text !== 'string') throw new Error('type needs `text`.');
            if (args.ref || args.coordinate) {
                const where = await target(ctx, args);
                await click(tabId, where.point, { label: shortLabel(`Typing into ${where.description}`) });
            } else {
                await overlay(tabId, { type: 'overlay/label', label: 'Typing' });
            }
            await typeText(tabId, args.text);
            await settle(tabId);
            return textResult(`Typed ${args.text.length} characters.`);
        }
        case 'key': {
            if (typeof args.text !== 'string') throw new Error('key needs `text`, e.g. "Enter" or "ctrl+a".');
            await overlay(tabId, { type: 'overlay/label', label: shortLabel(`Pressing ${args.text}`) });
            await pressKeys(tabId, args.text, Number(args.repeat ?? 1));
            await settle(tabId);
            return textResult(`Pressed ${args.text}${Number(args.repeat ?? 1) > 1 ? ` ×${args.repeat}` : ''}.`);
        }
        case 'scroll': {
            const direction = String(args.scroll_direction ?? 'down');
            const amount = Math.min(Math.max(Number(args.scroll_amount ?? 3), 1), 30);
            let point: Point;
            if (args.ref || args.coordinate) {
                point = (await target(ctx, args)).point;
            } else {
                const geometry = await geometryFor(tabId);
                point = { x: geometry.cssWidth / 2, y: geometry.cssHeight / 2 };
            }
            const delta = amount * 100;
            const [dx, dy] = direction === 'up' ? [0, -delta] : direction === 'left' ? [-delta, 0] : direction === 'right' ? [delta, 0] : [0, delta];
            await overlay(tabId, { type: 'overlay/label', label: `Scrolling ${direction}` });
            await scroll(tabId, point, dx, dy);
            await new Promise((resolve) => setTimeout(resolve, 350));
            return textResult(`Scrolled ${direction} by ${amount} step${amount === 1 ? '' : 's'}.`);
        }
        case 'scroll_to': {
            if (typeof args.ref !== 'string') throw new Error('scroll_to needs `ref`.');
            const resolved = await resolveRef(tabId, args.ref);
            await hover(tabId, { x: resolved.x, y: resolved.y }, shortLabel(`Scrolled to ${resolved.description}`));
            return textResult(`Scrolled ${resolved.description} into view.`);
        }
        case 'wait': {
            const seconds = Math.min(Math.max(Number(args.duration ?? 1), 0), 10);
            await overlay(tabId, { type: 'overlay/label', label: 'Waiting' });
            await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
            return textResult(`Waited ${seconds}s.`);
        }
    }
    throw new Error(`Action "${action}" is not implemented.`);
}
