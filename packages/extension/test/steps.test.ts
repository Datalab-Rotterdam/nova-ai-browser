import { describe, expect, it } from 'vitest';
import type { ChatItem } from '../src/sidepanel/chat.svelte';
import { groupItems, stepsLine, thoughtFor, type StepItem } from '../src/sidepanel/steps';

const user = (id: number): ChatItem => ({ kind: 'user', id, text: 'Go' });
const text = (id: number, value = 'Done.'): ChatItem => ({ kind: 'assistant', id, text: value });
const thinking = (id: number, durationMs?: number, value = 'Let me look.'): ChatItem => ({ kind: 'thinking', id, text: value, durationMs });
const tool = (id: number, name: string, args: Record<string, unknown> = {}, result: 'ok' | 'error' | 'running' = 'ok'): ChatItem => ({
    kind: 'tool',
    id,
    call: { id: `c${id}`, name, args },
    ...(result === 'running' ? {} : { result: { content: [{ type: 'text', text: '' }], ...(result === 'error' ? { isError: true } : {}) } })
});

describe('groupItems', () => {
    it('folds consecutive thinking and tool steps into one group', () => {
        const entries = groupItems([user(1), thinking(2, 1200), tool(3, 'navigate'), tool(4, 'read_page', {}, 'error'), text(5)]);
        expect(entries.map((entry) => entry.kind)).toEqual(['item', 'group', 'item']);
        const group = entries[1];
        expect(group).toMatchObject({ kind: 'group', id: 2, first: 1, failed: 1 });
        expect(group.kind === 'group' && group.steps.map((step) => step.id)).toEqual([2, 3, 4]);
    });

    it('keeps a single step on its own and splits groups at answers, questions and prompts', () => {
        const question: ChatItem = { kind: 'question', id: 4, question: 'Which?', options: [], multiSelect: false, allowOther: true, status: 'pending' };
        const entries = groupItems([user(1), tool(2, 'navigate'), text(3, 'Looking.'), question, tool(5, 'find'), tool(6, 'computer', { action: 'left_click' })]);
        expect(entries.map((entry) => entry.kind === 'group' ? `group:${entry.steps.length}` : entry.item.kind))
            .toEqual(['user', 'tool', 'assistant', 'question', 'group:2']);
    });

    it('does not let a blank answer split a group', () => {
        const entries = groupItems([tool(1, 'navigate'), text(2, '  '), tool(3, 'find')]);
        expect(entries).toHaveLength(1);
        expect(entries[0].kind).toBe('group');
    });
});

describe('stepsLine', () => {
    const steps = (...items: ChatItem[]) => items as StepItem[];

    it('says what Nova does now while it runs', () => {
        expect(stepsLine(steps(tool(1, 'tabs_context'), tool(2, 'navigate', { url: 'example.com' }, 'running')), true)).toBe('Navigate · example.com');
        expect(stepsLine(steps(tool(1, 'tabs_context'), thinking(2, undefined, 'First line\n**Check the price**')), true)).toBe('Thinking: Check the price');
    });

    it('sums up what Nova did afterwards', () => {
        expect(stepsLine(steps(thinking(1, 8_000), tool(2, 'navigate'), tool(3, 'navigate'), tool(4, 'find'), tool(5, 'computer', { action: 'left_click' }, 'error')), false))
            .toBe('Thought for 8.0 seconds, Navigate, Find and 1 more · 1 failed');
    });
});

describe('thoughtFor', () => {
    it('formats durations', () => {
        expect(thoughtFor(null)).toBe('Thought');
        expect(thoughtFor(400)).toBe('Thought for less than a second');
        expect(thoughtFor(1_000)).toBe('Thought for 1.0 second');
        expect(thoughtFor(12_400)).toBe('Thought for 12 seconds');
    });
});
