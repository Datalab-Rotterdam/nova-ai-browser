import { describe, expect, it } from 'vitest';
import { MODIFIER, parseKeyCombo, parseKeySequence } from '../src/keys';

describe('parseKeyCombo', () => {
    it('parses named keys with text', () => {
        expect(parseKeyCombo('Enter', false)).toEqual({ key: 'Enter', code: 'Enter', keyCode: 13, modifiers: 0, text: '\r' });
    });

    it('accepts xdotool aliases', () => {
        expect(parseKeyCombo('Return', false).key).toBe('Enter');
        expect(parseKeyCombo('BackSpace', false).key).toBe('Backspace');
        expect(parseKeyCombo('Page_Down', false).key).toBe('PageDown');
        expect(parseKeyCombo('Up', false).key).toBe('ArrowUp');
    });

    it('maps cmd to meta on macOS and ctrl elsewhere', () => {
        expect(parseKeyCombo('cmd+a', true).modifiers).toBe(MODIFIER.meta);
        expect(parseKeyCombo('cmd+a', false).modifiers).toBe(MODIFIER.ctrl);
    });

    it('adds editing commands for primary-modifier shortcuts and drops text', () => {
        const selectAll = parseKeyCombo('ctrl+a', false);
        expect(selectAll.commands).toEqual(['selectAll']);
        expect(selectAll.text).toBeUndefined();
        expect(parseKeyCombo('cmd+shift+z', true).commands).toEqual(['redo']);
        // Models mean select-all with ctrl+a on macOS too.
        expect(parseKeyCombo('ctrl+a', true).commands).toEqual(['selectAll']);
    });

    it('uppercases letters with shift', () => {
        const stroke = parseKeyCombo('shift+a', false);
        expect(stroke.text).toBe('A');
        expect(stroke.modifiers).toBe(MODIFIER.shift);
    });

    it('handles function keys, punctuation and the plus key', () => {
        expect(parseKeyCombo('F5', false)).toMatchObject({ key: 'F5', keyCode: 116 });
        expect(parseKeyCombo('/', false)).toMatchObject({ code: 'Slash', text: '/' });
        expect(parseKeyCombo('ctrl++', false)).toMatchObject({ key: '+', modifiers: MODIFIER.ctrl });
    });

    it('presses a lone modifier', () => {
        expect(parseKeyCombo('shift', false)).toMatchObject({ key: 'Shift', code: 'ShiftLeft' });
    });

    it('rejects unknown keys and double keys', () => {
        expect(() => parseKeyCombo('Hyper', false)).toThrow(/Unknown key/);
        expect(() => parseKeyCombo('a+b', false)).toThrow(/more than one/);
    });
});

describe('parseKeySequence', () => {
    it('splits on whitespace', () => {
        expect(parseKeySequence('ctrl+a Delete', false).map((s) => s.key)).toEqual(['a', 'Delete']);
        expect(parseKeySequence('  ', false)).toEqual([]);
    });
});
