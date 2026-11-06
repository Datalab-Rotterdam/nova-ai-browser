import { describe, expect, it } from 'vitest';
import { readOnlyRefusal } from '../src/sidepanel/agent/readonly';

describe('readOnlyRefusal (Ask mode)', () => {
    it('lets reading, opening pages and the panel tools through', () => {
        expect(readOnlyRefusal('read_page', {})).toBeUndefined();
        expect(readOnlyRefusal('navigate', { url: 'https://example.com' })).toBeUndefined();
        expect(readOnlyRefusal('computer', { action: 'screenshot' })).toBeUndefined();
        expect(readOnlyRefusal('computer', { action: 'scroll' })).toBeUndefined();
        expect(readOnlyRefusal('ask_user', {})).toBeUndefined();
        expect(readOnlyRefusal('todo_write', {})).toBeUndefined();
    });

    it('refuses anything that changes a page', () => {
        expect(readOnlyRefusal('computer', { action: 'left_click' })).toContain('Read-only mode');
        expect(readOnlyRefusal('computer', { action: 'type' })).toContain('computer type');
        expect(readOnlyRefusal('form_input', { ref: 'ref_1', value: 'x' })).toContain('form_input');
        expect(readOnlyRefusal('upload_file', {})).toContain('Read-only mode');
        expect(readOnlyRefusal('javascript_tool', {})).toContain('Read-only mode');
    });
});
