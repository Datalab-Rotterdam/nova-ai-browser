import type { ChatMessage } from '@datalabrotterdam/nova-sdk';
import { describe, expect, it } from 'vitest';
import { estimateMessagesTokens, fitToBudget, inputBudget, pruneToolResults } from '../src/model/context';
import { modelCapabilities } from '../src/model/capabilities';

const big = (char: string) => char.repeat(30_000);

/** user → (assistant tool call → tool result) × rounds, each result `big`. */
function conversation(rounds: number): ChatMessage[] {
    const messages: ChatMessage[] = [{ role: 'user', content: 'Find the price' }];
    for (let i = 0; i < rounds; i++) {
        messages.push({ role: 'assistant', content: null, tool_calls: [{ id: `c${i}`, type: 'function', function: { name: 'get_page_text', arguments: '{}' } }] });
        messages.push({ role: 'tool', tool_call_id: `c${i}`, content: big(String(i)) });
    }
    return messages;
}

/** Every tool result follows the assistant message that declared its call. */
function callsAnswered(messages: ChatMessage[]): boolean {
    const declared = new Set<unknown>();
    return messages.every((message) => {
        for (const call of (message.tool_calls ?? []) as Array<{ id: string }>) declared.add(call.id);
        return message.role !== 'tool' || declared.has(message.tool_call_id);
    });
}

describe('context window', () => {
    it('shortens tool results except the newest four', () => {
        const pruned = pruneToolResults(conversation(6));
        const sizes = pruned.filter((m) => m.role === 'tool').map((m) => String(m.content).length);
        expect(sizes.slice(0, 2).every((size) => size < 2_000)).toBe(true);
        expect(sizes.slice(2)).toEqual([30_000, 30_000, 30_000, 30_000]);
        expect(String(pruned[2].content)).toContain('tokens truncated');
    });

    it('leaves a conversation under the threshold alone', async () => {
        const messages = conversation(1);
        const fitted = await fitToBudget(messages, { budget: 100_000, threshold: 0.8 });
        expect(fitted.stage).toBe('none');
        expect(fitted.messages).toEqual(messages);
    });

    it('summarizes older turns into one user message', async () => {
        let transcript = '';
        const fitted = await fitToBudget(conversation(12), {
            budget: 50_000,
            threshold: 0.8,
            summarize: async (text) => { transcript = text; return 'The user wants a price.'; }
        });
        expect(fitted.stage).toBe('summarized');
        expect(transcript).toContain('Find the price');
        expect(fitted.messages[0]).toMatchObject({ role: 'user' });
        expect(String(fitted.messages[0].content)).toContain('The user wants a price.');
        expect(fitted.messages[1].role).toBe('assistant');
        expect(callsAnswered(fitted.messages)).toBe(true);
        expect(estimateMessagesTokens(fitted.messages)).toBeLessThanOrEqual(50_000);
    });

    it('drops the oldest turns without separating a call from its result', async () => {
        const fitted = await fitToBudget(conversation(12), { budget: 25_000, threshold: 0.8 });
        expect(fitted.stage).toBe('trimmed');
        expect(fitted.messages[0]).toMatchObject({ role: 'user' });
        expect(fitted.messages[1].role).toBe('assistant');
        expect(callsAnswered(fitted.messages)).toBe(true);
        expect(fitted.estimatedTokens).toBeLessThanOrEqual(25_000);
    });

    it('counts images, not their bytes', () => {
        const image: ChatMessage = { role: 'user', content: [{ type: 'image_url', image_url: { url: `data:image/png;base64,${big('A')}` } }] };
        expect(estimateMessagesTokens([image])).toBeLessThan(1_100);
    });

    it('reads the context window a model advertises', () => {
        expect(modelCapabilities({ context_window: 131_072 }).contextWindow).toBe(131_072);
        expect(modelCapabilities({ metadata: { max_model_len: '8192' } }).contextWindow).toBe(8_192);
        expect(modelCapabilities({}).contextWindow).toBeUndefined();
        expect(inputBudget(32_768)).toBe(32_768 - 8_192 - 1_024);
    });
});
