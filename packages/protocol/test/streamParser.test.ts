import type { ChatCompletionChunk } from '@datalabrotterdam/nova-sdk';
import { describe, expect, it } from 'vitest';
import { ChatStreamParser } from '../src/model/streamParser';
import { createToolPayload } from '../src/model/toolNames';
import { modelCapabilities } from '../src/model/capabilities';
import { TOOL_DEFINITIONS, isReadOnlyCall } from '../src/tools';

function collect(chunks: ChatCompletionChunk[]) {
    const { names } = createToolPayload(TOOL_DEFINITIONS);
    const out = { text: '', thinking: '', calls: [] as Array<{ name: string; input: Record<string, unknown> }> };
    const parser = new ChatStreamParser({ callIdPrefix: 't', toolNames: names }, {
        text: (value) => { out.text += value; },
        thinking: (value) => { out.thinking += value; },
        toolCall: (_id, name, input) => { out.calls.push({ name, input }); }
    });
    for (const chunk of chunks) parser.pushChunk(chunk);
    parser.end();
    return out;
}

const content = (text: string): ChatCompletionChunk => ({ object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: text } }] });

describe('ChatStreamParser', () => {
    it('accumulates native tool call deltas', () => {
        const out = collect([
            { object: 'chat.completion.chunk', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'a', function: { name: 'computer', arguments: '{"tabId": 1, ' } }] } }] },
            { object: 'chat.completion.chunk', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '"action": "screenshot"}' } }] }, finish_reason: 'tool_calls' }] }
        ]);
        expect(out.calls).toEqual([{ name: 'computer', input: { tabId: 1, action: 'screenshot' } }]);
    });

    it('turns text tool calls split across chunks into calls', () => {
        const out = collect([content('Let me look. <tool_'), content('call>{"name": "tabs_context", "arguments": {}}</tool_call>')]);
        expect(out.text.trim()).toBe('Let me look.');
        expect(out.calls).toEqual([{ name: 'tabs_context', input: {} }]);
    });

    it('parses Gemma 4 tool calls split across chunks', () => {
        const out = collect([
            content('<|tool_call>call:computer{action:<|"|>left_'),
            content('click<|"|>,ref:<|"|>ref_1<|"|>,tabId:1848770019,coordinate:[10, 20],extra:{flag:true}}<tool_call|>')
        ]);
        expect(out.text).toBe('');
        expect(out.calls).toEqual([{
            name: 'computer',
            input: { action: 'left_click', ref: 'ref_1', tabId: 1848770019, coordinate: [10, 20], extra: { flag: true } }
        }]);
    });

    it('keeps quotes and colons inside Gemma strings', () => {
        const out = collect([content('<|tool_call>call:computer{action:<|"|>type<|"|>,text:<|"|>He said "hi": ok<|"|>,tabId:1}<tool_call|>')]);
        expect(out.calls[0].input).toEqual({ action: 'type', text: 'He said "hi": ok', tabId: 1 });
    });

    it('keeps unknown text tool calls as text', () => {
        const out = collect([content('<tool_call>{"name": "rm_rf", "arguments": {}}</tool_call>')]);
        expect(out.calls).toEqual([]);
        expect(out.text).toContain('rm_rf');
    });

    it('routes <think> blocks to thinking', () => {
        const out = collect([content('<think>plan</think>Done.')]);
        expect(out.thinking).toBe('plan');
        expect(out.text).toBe('Done.');
    });
});

describe('tool helpers', () => {
    it('marks read-only computer actions', () => {
        expect(isReadOnlyCall('computer', { action: 'screenshot' })).toBe(true);
        expect(isReadOnlyCall('computer', { action: 'left_click' })).toBe(false);
        expect(isReadOnlyCall('read_page', {})).toBe(true);
        expect(isReadOnlyCall('navigate', {})).toBe(false);
    });

    it('builds a valid OpenAI tools payload', () => {
        const { payload } = createToolPayload(TOOL_DEFINITIONS);
        const tools = payload.tools as Array<{ function: { name: string; parameters: { type: string } } }>;
        expect(tools).toHaveLength(TOOL_DEFINITIONS.length);
        expect(tools.every((tool) => /^[a-zA-Z0-9_-]+$/.test(tool.function.name) && tool.function.parameters.type === 'object')).toBe(true);
    });

    it('reads model capabilities', () => {
        expect(modelCapabilities({ capabilities: ['Vision', 'tools'] })).toEqual({ toolCalling: true, imageInput: true });
        expect(modelCapabilities({})).toEqual({ toolCalling: false, imageInput: false });
    });
});

describe('Qwen3-Coder XML tool calls', () => {
    it('parses <function=…> calls inside <tool_call>, split across chunks', () => {
        const out = collect([
            content('I continue to read the page.\n\n<tool_call>\n<function=get_page_text>\n<parameter=max_chars>\n6000\n</param'),
            content('eter>\n<parameter=tabId>\n2051140249\n</parameter>\n</function>\n</tool_call>')
        ]);
        expect(out.text.trim()).toBe('I continue to read the page.');
        expect(out.calls).toEqual([{ name: 'get_page_text', input: { max_chars: 6000, tabId: 2051140249 } }]);
    });

    it('keeps values that are not JSON as text', () => {
        const out = collect([content('<tool_call><function=navigate><parameter=url>https://example.com/a b</parameter><parameter=tabId>7</parameter></function></tool_call>')]);
        expect(out.calls).toEqual([{ name: 'navigate', input: { url: 'https://example.com/a b', tabId: 7 } }]);
    });
});
