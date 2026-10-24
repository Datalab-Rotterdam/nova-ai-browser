/**
 * Real input through CDP. Every pointer action first moves the virtual cursor and waits for it
 * to arrive, so what the user sees matches what the page receives.
 */
import { MODIFIER, parseKeyCombo, parseKeySequence, type KeyStroke, type Point } from '@datalabrotterdam/nova-ai-browser-protocol';
import { send } from './cdp';
import { overlay } from './content';

export type MouseButton = 'left' | 'right' | 'middle';

const BUTTON_MASK: Record<MouseButton, number> = { left: 1, right: 2, middle: 4 };
/** Upper bound for waiting on the cursor animation before input is sent anyway. */
const CURSOR_WAIT_MS = 800;

let isMac: boolean | undefined;

async function platformIsMac(): Promise<boolean> {
    if (isMac === undefined) {
        isMac = (await chrome.runtime.getPlatformInfo()).os === 'mac';
    }
    return isMac;
}

export async function parseModifiers(text: string | undefined): Promise<number> {
    if (!text) return 0;
    const mac = await platformIsMac();
    let modifiers = 0;
    for (const part of text.split(/[+\s]+/).filter(Boolean)) {
        modifiers |= parseKeyCombo(`${part}+a`, mac).modifiers;
    }
    return modifiers;
}

async function moveCursor(tabId: number, point: Point, label?: string): Promise<void> {
    await overlay(tabId, { type: 'overlay/move', x: point.x, y: point.y, label }, CURSOR_WAIT_MS);
}

function mouse(tabId: number, params: Record<string, unknown>): Promise<unknown> {
    return send(tabId, 'Input.dispatchMouseEvent', {
        ...params,
        x: Math.round(params.x as number),
        y: Math.round(params.y as number)
    });
}

export async function hover(tabId: number, point: Point, label?: string): Promise<void> {
    await moveCursor(tabId, point, label);
    await mouse(tabId, { type: 'mouseMoved', x: point.x, y: point.y, button: 'none', buttons: 0 });
}

export async function click(
    tabId: number,
    point: Point,
    options: { button?: MouseButton; clickCount?: number; modifiers?: number; label?: string } = {}
): Promise<void> {
    const button = options.button ?? 'left';
    const clicks = options.clickCount ?? 1;
    const modifiers = options.modifiers ?? 0;

    await hover(tabId, point, options.label);
    await overlay(tabId, { type: 'overlay/press', x: point.x, y: point.y, button });
    for (let count = 1; count <= clicks; count++) {
        await mouse(tabId, { type: 'mousePressed', x: point.x, y: point.y, button, buttons: BUTTON_MASK[button], clickCount: count, modifiers });
        await mouse(tabId, { type: 'mouseReleased', x: point.x, y: point.y, button, buttons: 0, clickCount: count, modifiers });
    }
}

export async function drag(tabId: number, from: Point, to: Point, label?: string): Promise<void> {
    await hover(tabId, from, label);
    await mouse(tabId, { type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1 });
    // Intermediate moves let drag-and-drop libraries see a real drag; the cursor follows each step.
    const steps = 12;
    for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const x = from.x + (to.x - from.x) * t;
        const y = from.y + (to.y - from.y) * t;
        void overlay(tabId, { type: 'overlay/move', x, y }, 0);
        await mouse(tabId, { type: 'mouseMoved', x, y, button: 'left', buttons: 1 });
        await new Promise((resolve) => setTimeout(resolve, 16));
    }
    await moveCursor(tabId, to);
    await mouse(tabId, { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', buttons: 0, clickCount: 1 });
}

export async function scroll(tabId: number, point: Point, deltaX: number, deltaY: number): Promise<void> {
    await moveCursor(tabId, point);
    await mouse(tabId, { type: 'mouseWheel', x: point.x, y: point.y, deltaX, deltaY });
}

async function pressStroke(tabId: number, stroke: KeyStroke): Promise<void> {
    const base = {
        modifiers: stroke.modifiers,
        key: stroke.key,
        code: stroke.code,
        windowsVirtualKeyCode: stroke.keyCode,
        nativeVirtualKeyCode: stroke.keyCode
    };
    await send(tabId, 'Input.dispatchKeyEvent', {
        ...base,
        type: stroke.text ? 'keyDown' : 'rawKeyDown',
        ...(stroke.text ? { text: stroke.text, unmodifiedText: stroke.text } : {}),
        ...(stroke.commands ? { commands: stroke.commands } : {})
    });
    await send(tabId, 'Input.dispatchKeyEvent', { ...base, type: 'keyUp' });
}

export async function pressKeys(tabId: number, sequence: string, repeat = 1): Promise<void> {
    const strokes = parseKeySequence(sequence, await platformIsMac());
    if (!strokes.length) {
        throw new Error('`text` must name at least one key, e.g. "Enter" or "ctrl+a".');
    }
    for (let i = 0; i < Math.min(Math.max(1, repeat), 100); i++) {
        for (const stroke of strokes) {
            await pressStroke(tabId, stroke);
        }
    }
}

/** Types text into the focused element. Newlines press Enter, so multi-line input and submit both work. */
export async function typeText(tabId: number, text: string): Promise<void> {
    const mac = await platformIsMac();
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
        if (lines[i]) {
            await send(tabId, 'Input.insertText', { text: lines[i] });
        }
        if (i < lines.length - 1) {
            await pressStroke(tabId, parseKeyCombo('Enter', mac));
        }
    }
}

export { MODIFIER };
