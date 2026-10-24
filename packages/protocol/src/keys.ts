/** CDP `Input.dispatchKeyEvent` modifier bits. */
export const MODIFIER = { alt: 1, ctrl: 2, meta: 4, shift: 8 } as const;

export interface KeyStroke {
    key: string;
    code: string;
    keyCode: number;
    /** Text the key inserts; only set for printable keys without ctrl/meta. */
    text?: string;
    modifiers: number;
    /** Editing commands Chrome should run (needed for shortcuts like select-all, which CDP does not trigger by itself). */
    commands?: string[];
}

interface KeyInfo {
    key: string;
    code: string;
    keyCode: number;
    text?: string;
}

const MODIFIER_ALIASES: Record<string, keyof typeof MODIFIER | 'cmd'> = {
    alt: 'alt', option: 'alt', opt: 'alt',
    ctrl: 'ctrl', control: 'ctrl',
    shift: 'shift',
    meta: 'meta', super: 'meta', win: 'meta', windows: 'meta',
    cmd: 'cmd', command: 'cmd', cmdorctrl: 'cmd'
};

const NAMED_KEYS: Record<string, KeyInfo> = {
    enter: { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' },
    tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
    escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
    backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
    delete: { key: 'Delete', code: 'Delete', keyCode: 46 },
    insert: { key: 'Insert', code: 'Insert', keyCode: 45 },
    space: { key: ' ', code: 'Space', keyCode: 32, text: ' ' },
    arrowup: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
    arrowdown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
    arrowleft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
    arrowright: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
    home: { key: 'Home', code: 'Home', keyCode: 36 },
    end: { key: 'End', code: 'End', keyCode: 35 },
    pageup: { key: 'PageUp', code: 'PageUp', keyCode: 33 },
    pagedown: { key: 'PageDown', code: 'PageDown', keyCode: 34 }
};

/** xdotool and other common spellings of named keys. */
const KEY_ALIASES: Record<string, string> = {
    return: 'enter', esc: 'escape', back_space: 'backspace', del: 'delete',
    up: 'arrowup', down: 'arrowdown', left: 'arrowleft', right: 'arrowright',
    page_up: 'pageup', page_down: 'pagedown', prior: 'pageup', next: 'pagedown', ' ': 'space'
};

const PUNCTUATION: Record<string, { code: string; keyCode: number }> = {
    '-': { code: 'Minus', keyCode: 189 }, '=': { code: 'Equal', keyCode: 187 },
    '[': { code: 'BracketLeft', keyCode: 219 }, ']': { code: 'BracketRight', keyCode: 221 },
    '\\': { code: 'Backslash', keyCode: 220 }, ';': { code: 'Semicolon', keyCode: 186 },
    "'": { code: 'Quote', keyCode: 222 }, ',': { code: 'Comma', keyCode: 188 },
    '.': { code: 'Period', keyCode: 190 }, '/': { code: 'Slash', keyCode: 191 },
    '`': { code: 'Backquote', keyCode: 192 }
};

/** Shortcuts (primary modifier + key) that need an explicit editing command. */
const EDIT_COMMANDS: Record<string, string> = {
    a: 'selectAll', c: 'copy', x: 'cut', v: 'paste', z: 'undo'
};

function lookupKey(name: string): KeyInfo | undefined {
    const lower = name.toLowerCase();
    const named = NAMED_KEYS[KEY_ALIASES[lower] ?? lower];
    if (named) {
        return named;
    }

    const fn = /^f([1-9]|1[0-2])$/.exec(lower);
    if (fn) {
        const n = Number(fn[1]);
        return { key: `F${n}`, code: `F${n}`, keyCode: 111 + n };
    }

    if (name.length === 1) {
        if (/[a-z]/i.test(name)) {
            return { key: name, code: `Key${name.toUpperCase()}`, keyCode: name.toUpperCase().charCodeAt(0), text: name };
        }
        if (/[0-9]/.test(name)) {
            return { key: name, code: `Digit${name}`, keyCode: name.charCodeAt(0), text: name };
        }
        const punctuation = PUNCTUATION[name];
        if (punctuation) {
            return { key: name, ...punctuation, text: name };
        }
        return { key: name, code: '', keyCode: 0, text: name };
    }
    return undefined;
}

/**
 * Parses one combo like "ctrl+shift+a" or "Enter". `cmd` means meta on macOS and ctrl elsewhere,
 * so prompts written for one platform keep working on the other.
 */
export function parseKeyCombo(combo: string, isMac: boolean): KeyStroke {
    // A lone "+" or a trailing "++" means the plus key itself.
    const parts = combo === '+' ? ['+'] : combo.replace(/\+\+$/, '+plus').split('+').map((part) => part === 'plus' ? '+' : part);
    let modifiers = 0;
    let keyName: string | undefined;

    for (const raw of parts) {
        const part = raw.trim();
        if (!part && raw !== ' ') {
            continue;
        }
        const modifier = MODIFIER_ALIASES[part.toLowerCase()];
        if (modifier && part.length > 1) {
            modifiers |= modifier === 'cmd' ? (isMac ? MODIFIER.meta : MODIFIER.ctrl) : MODIFIER[modifier];
            continue;
        }
        if (keyName !== undefined) {
            throw new Error(`Key combo "${combo}" has more than one non-modifier key.`);
        }
        keyName = raw === ' ' ? ' ' : part;
    }

    if (keyName === undefined) {
        // Only modifiers, e.g. "shift": press the modifier itself.
        const only = parts[parts.length - 1].trim().toLowerCase();
        const modifier = MODIFIER_ALIASES[only] === 'cmd' ? (isMac ? 'meta' : 'ctrl') : MODIFIER_ALIASES[only];
        const names: Record<string, KeyInfo> = {
            alt: { key: 'Alt', code: 'AltLeft', keyCode: 18 },
            ctrl: { key: 'Control', code: 'ControlLeft', keyCode: 17 },
            shift: { key: 'Shift', code: 'ShiftLeft', keyCode: 16 },
            meta: { key: 'Meta', code: 'MetaLeft', keyCode: 91 }
        };
        return { ...names[modifier as string], modifiers };
    }

    const info = lookupKey(keyName);
    if (!info) {
        throw new Error(`Unknown key "${keyName}" in "${combo}".`);
    }

    const stroke: KeyStroke = { key: info.key, code: info.code, keyCode: info.keyCode, modifiers };
    const hasCommandModifier = (modifiers & (MODIFIER.ctrl | MODIFIER.meta)) !== 0;

    if (info.text !== undefined && !hasCommandModifier) {
        let text = info.text;
        if (modifiers & MODIFIER.shift && text.length === 1 && /[a-z]/.test(text)) {
            text = text.toUpperCase();
            stroke.key = text;
        }
        stroke.text = text;
    }

    // Models write "ctrl+a" meaning select-all on every platform, so ctrl and cmd both count here.
    if (hasCommandModifier && !(modifiers & MODIFIER.alt)) {
        const lower = info.key.toLowerCase();
        if (lower === 'z' && modifiers & MODIFIER.shift) {
            stroke.commands = ['redo'];
        } else if (EDIT_COMMANDS[lower] && !(modifiers & MODIFIER.shift)) {
            stroke.commands = [EDIT_COMMANDS[lower]];
        }
    }

    return stroke;
}

/** Parses space-separated combos: "ctrl+a Delete" → two strokes. */
export function parseKeySequence(text: string, isMac: boolean): KeyStroke[] {
    const combos = text.trim() === '' ? [] : text.trim().split(/\s+/);
    return combos.map((combo) => parseKeyCombo(combo, isMac));
}
