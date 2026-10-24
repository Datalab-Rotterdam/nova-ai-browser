/**
 * Visible agent presence on the page: a virtual cursor that travels to each point before the
 * real (CDP) input event is sent, a click ripple, an action label, a glow around the viewport
 * and a Stop button. Everything lives in a closed shadow root with pointer-events: none, so
 * page styles cannot break it and it never intercepts the agent's or the user's input.
 */
import type { OverlayMessage } from '@datalabrotterdam/nova-ai-browser-protocol';
import markSource from '../assets/nova-mark.svg?raw';
import STYLE from './overlay.css?inline';

declare global {
    // eslint-disable-next-line no-var
    var __novaOverlayLoaded: boolean | undefined;
}

const HOST_ID = 'nova-ai-overlay-host';

/** The Nova mark, recolored to follow `currentColor`. */
const MARK_SVG = markSource
    .replace(/<\?xml[^>]*>|<!DOCTYPE[^>]*>/g, '')
    .replace(/fill="#[0-9a-fA-F]{3,6}"/g, 'fill="currentColor"')
    .replace(/\swidth="[^"]*"\s+height="[^"]*"/, '');

const CURSOR_SVG = `
<svg class="arrow" viewBox="0 0 20 26" aria-hidden="true">
  <path d="M1.5 1.5 L1.5 20 L6.2 15.8 L9.4 23.4 L12.8 22 L9.7 14.6 L16 14.6 Z"/>
</svg>`;

interface OverlayState {
    root: ShadowRoot;
    layer: HTMLDivElement;
    cursor: HTMLDivElement;
    label: HTMLDivElement;
    x: number;
    y: number;
    animation?: number;
}

let state: OverlayState | undefined;
let active = false;
const POSITION_KEY = 'nova-ai-cursor-position';

function ensureOverlay(): OverlayState {
    if (state && state.layer.isConnected) {
        return state;
    }

    document.getElementById(HOST_ID)?.remove();
    const host = document.createElement('div');
    host.id = HOST_ID;
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483646;';
    const root = host.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = STYLE;
    const layer = document.createElement('div');
    layer.className = 'layer';

    const edge = document.createElement('div');
    edge.className = 'edge';
    edge.innerHTML = '<div class="ring"><div class="orbit"></div></div>';

    const cursor = document.createElement('div');
    cursor.className = 'cursor';
    cursor.innerHTML = CURSOR_SVG;
    const label = document.createElement('div');
    label.className = 'label';
    label.innerHTML = `<span class="mark">${MARK_SVG}</span><span class="label-text"></span>`;
    cursor.appendChild(label);

    const stopWrap = document.createElement('div');
    stopWrap.className = 'stop-wrap';
    const stop = document.createElement('button');
    stop.className = 'stop';
    stop.type = 'button';
    stop.title = 'Stop Nova';
    stop.innerHTML = `<span class="mark">${MARK_SVG}</span><span class="who">Nova is working</span><span class="divider"></span><span class="stop-square"></span><span>Stop</span>`;
    stop.addEventListener('click', (event) => {
        // Only a real user click may stop the agent; the agent's own synthetic clicks must not.
        if (event.isTrusted) {
            void chrome.runtime.sendMessage({ type: 'overlay/stop' }).catch(() => undefined);
        }
    });
    stopWrap.appendChild(stop);

    layer.append(edge, cursor, stopWrap);
    root.append(style, layer);
    (document.body ?? document.documentElement).appendChild(host);

    const saved = readSavedPosition();
    state = {
        root,
        layer,
        cursor,
        label,
        x: saved?.x ?? Math.round(window.innerWidth / 2),
        y: saved?.y ?? Math.round(window.innerHeight / 2)
    };
    placeCursor(state.x, state.y);
    return state;
}

function readSavedPosition(): { x: number; y: number } | undefined {
    try {
        const raw = sessionStorage.getItem(POSITION_KEY);
        return raw ? JSON.parse(raw) as { x: number; y: number } : undefined;
    } catch {
        return undefined;
    }
}

function savePosition(x: number, y: number): void {
    try {
        sessionStorage.setItem(POSITION_KEY, JSON.stringify({ x, y }));
    } catch {
        // Storage may be blocked; the cursor then starts in the center after navigation.
    }
}

function placeCursor(x: number, y: number): void {
    if (!state) return;
    state.x = x;
    state.y = y;
    state.cursor.style.transform = `translate3d(${x}px, ${y}px, 0)`;
}

function setActive(value: boolean): void {
    active = value;
    const overlay = ensureOverlay();
    overlay.layer.classList.toggle('active', value);
    if (!value) {
        setLabel(null);
    }
}

function setLabel(text: string | null | undefined): void {
    if (!state) return;
    if (text) {
        state.label.querySelector('.label-text')!.textContent = text;
        state.label.classList.add('visible');
    } else {
        state.label.classList.remove('visible');
    }
}

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Moves the cursor along a gentle curve with ease-in-out, taking longer for longer distances.
 * Resolves when the cursor arrives, so the real input event lands exactly when the user sees it.
 */
function moveCursor(toX: number, toY: number): Promise<void> {
    const overlay = ensureOverlay();
    if (overlay.animation) cancelAnimationFrame(overlay.animation);

    const fromX = overlay.x;
    const fromY = overlay.y;
    const distance = Math.hypot(toX - fromX, toY - fromY);
    savePosition(toX, toY);

    if (document.hidden || reducedMotion() || distance < 2 || !active) {
        placeCursor(toX, toY);
        return Promise.resolve();
    }

    const duration = Math.min(520, 160 + distance * 0.45);
    // Control point offset perpendicular to the path makes the movement look hand-made.
    const bend = Math.min(80, distance * 0.18) * (toX >= fromX ? -1 : 1);
    const midX = (fromX + toX) / 2 + (-(toY - fromY) / (distance || 1)) * bend;
    const midY = (fromY + toY) / 2 + ((toX - fromX) / (distance || 1)) * bend;
    const start = performance.now();

    return new Promise((resolve) => {
        const fallback = setTimeout(() => {
            placeCursor(toX, toY);
            resolve();
        }, duration + 150);

        const step = (now: number) => {
            const t = Math.min(1, (now - start) / duration);
            const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
            const x = (1 - e) * (1 - e) * fromX + 2 * (1 - e) * e * midX + e * e * toX;
            const y = (1 - e) * (1 - e) * fromY + 2 * (1 - e) * e * midY + e * e * toY;
            placeCursor(x, y);
            if (t < 1) {
                overlay.animation = requestAnimationFrame(step);
            } else {
                overlay.animation = undefined;
                clearTimeout(fallback);
                resolve();
            }
        };
        overlay.animation = requestAnimationFrame(step);
    });
}

function press(x: number, y: number, button: 'left' | 'right' | 'middle'): void {
    const overlay = ensureOverlay();
    placeCursor(x, y);
    overlay.cursor.classList.add('pressed');
    setTimeout(() => overlay.cursor.classList.remove('pressed'), 140);

    const ripple = document.createElement('div');
    ripple.className = `ripple${button === 'right' ? ' right' : ''}`;
    ripple.style.left = `${x}px`;
    ripple.style.top = `${y}px`;
    overlay.layer.appendChild(ripple);
    setTimeout(() => ripple.remove(), 600);
}

/** Resolves after the browser has painted, so a screenshot taken next does or does not include the overlay. */
function afterPaint(): Promise<void> {
    if (document.hidden) return Promise.resolve();
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

async function handle(message: OverlayMessage): Promise<unknown> {
    switch (message.type) {
        case 'overlay/ping':
            return true;
        case 'overlay/show': {
            const overlay = ensureOverlay();
            // External agents work through Nova: name them so the user knows who is in control.
            const who = overlay.root.querySelector('.who');
            if (who) who.textContent = message.agent ? `${message.agent} is using Nova` : 'Nova is working';
            setActive(true);
            return true;
        }
        case 'overlay/hide':
            setActive(false);
            return true;
        case 'overlay/move':
            if (!active) setActive(true);
            if (message.label !== undefined) setLabel(message.label);
            await moveCursor(message.x, message.y);
            return true;
        case 'overlay/press':
            press(message.x, message.y, message.button);
            return true;
        case 'overlay/label':
            setLabel(message.label);
            return true;
        case 'overlay/capture-begin':
            ensureOverlay().layer.classList.add('capturing');
            await afterPaint();
            return true;
        case 'overlay/capture-end':
            ensureOverlay().layer.classList.remove('capturing');
            return true;
    }
}

if (!globalThis.__novaOverlayLoaded) {
    globalThis.__novaOverlayLoaded = true;
    chrome.runtime.onMessage.addListener((message: OverlayMessage, _sender, sendResponse) => {
        if (typeof message?.type !== 'string' || !message.type.startsWith('overlay/')) {
            return false;
        }
        handle(message).then(
            (value) => sendResponse({ ok: true, value }),
            (error: unknown) => sendResponse({ ok: false, error: String(error) })
        );
        return true;
    });
}
