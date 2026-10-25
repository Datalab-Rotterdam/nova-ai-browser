import type { ChatMessage } from '@datalabrotterdam/nova-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NovaBrowserAgent } from '../src/sidepanel/agent/loop';

type Body = { messages: ChatMessage[]; tools?: unknown[] };

function sse(text: string): Response {
    const chunk = { object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: text }, finish_reason: 'stop' }] };
    return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
}

/** A Nova server that rejects the first chat request with `error`, then answers. */
function server(error: { status: number; message: string }) {
    const requests: Body[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as Body;
        requests.push(body);
        if (String(body.messages[0].content).startsWith('Summarize')) return sse('The user wants the price of item 3.');
        if (requests.length === 1) return new Response(JSON.stringify({ error: { message: error.message } }), { status: error.status });
        return sse('Done.');
    });
    return requests;
}

function agent(history: ChatMessage[]) {
    return new NovaBrowserAgent({
        apiKey: 'k',
        baseUrl: 'http://nova.test/v1',
        model: 'm',
        vision: false,
        contextWindow: 131_072,
        maxRounds: 5,
        runTool: async () => ({ content: [] }),
        history
    });
}

const events = () => ({ text: vi.fn(), thinking: vi.fn(), toolStart: vi.fn(), toolEnd: vi.fn(), roundEnd: vi.fn(), notice: vi.fn() });

/** Past turns that fit the advertised window but not the real one. */
const longHistory = (): ChatMessage[] => Array.from({ length: 10 }, (_, i): ChatMessage[] => [
    { role: 'user', content: `Question ${i}` },
    { role: 'assistant', content: `Answer ${i} ${'x'.repeat(3_000)}` }
]).flat();

afterEach(() => vi.unstubAllGlobals());

describe('NovaBrowserAgent', () => {
    it('compacts and retries once when the context overflows, keeping native tools', async () => {
        const requests = server({ status: 400, message: "This model's maximum context length is 8192 tokens." });
        const sink = events();
        await agent(longHistory()).run('What does item 3 cost?', sink, new AbortController().signal);

        const chats = requests.filter((body) => body.tools);
        expect(chats).toHaveLength(2);
        expect(JSON.stringify(chats[1].messages).length).toBeLessThan(JSON.stringify(chats[0].messages).length / 2);
        expect(JSON.stringify(chats[1].messages)).toContain('What does item 3 cost?');
        expect(sink.text).toHaveBeenCalledWith('Done.');
        expect(sink.notice).toHaveBeenCalledWith(expect.stringContaining('context window'));
    });

    it('does not switch to text tool calls for a 400 that is not about tools', async () => {
        server({ status: 400, message: 'messages: invalid role' });
        const sink = events();
        await expect(agent([]).run('Hi', sink, new AbortController().signal)).rejects.toThrow('invalid role');
        expect(sink.notice).not.toHaveBeenCalled();
    });
});
