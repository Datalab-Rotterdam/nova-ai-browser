import { describe, expect, it } from 'vitest';
import { chatToMarkdown } from '../src/lib/export';
import type { ChatItem } from '../src/sidepanel/chat.svelte';

describe('chatToMarkdown', () => {
    it('writes the conversation and the tools used', () => {
        const items = [
            { kind: 'user', id: 1, text: 'Find the opening hours' },
            { kind: 'tool', id: 2, call: { id: 'c1', name: 'navigate', args: {} } },
            { kind: 'assistant', id: 3, text: 'Open 9 to 5.' }
        ] as unknown as ChatItem[];
        const md = chatToMarkdown('Hours', items, 0);
        expect(md).toContain('# Hours');
        expect(md).toContain('**You:** Find the opening hours');
        expect(md).toContain('- Nova used `navigate`');
        expect(md).toContain('**Nova:** Open 9 to 5.');
    });
});
