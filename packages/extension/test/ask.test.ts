import type { ChatMessage } from '@datalabrotterdam/nova-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ASK_USER, parseQuestion } from '../src/sidepanel/agent/ask';
import { NovaBrowserAgent } from '../src/sidepanel/agent/loop';

type Body = { messages: ChatMessage[]; tools?: Array<{ function: { name: string } }> };

function sse(delta: Record<string, unknown>, finish: string): Response {
    const chunk = { object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: finish }] };
    return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
}

/** A Nova server that asks one question with ask_user, then answers. */
function server() {
    const requests: Body[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as Body;
        requests.push(body);
        if (requests.length === 1) {
            return sse({
                tool_calls: [{
                    index: 0,
                    id: 'call_1',
                    type: 'function',
                    function: { name: ASK_USER, arguments: JSON.stringify({ question: 'Which shop?', options: [{ label: 'A', recommended: true }, { label: 'B' }] }) }
                }]
            }, 'tool_calls');
        }
        return sse({ content: 'Done.' }, 'stop');
    });
    return requests;
}

const events = () => ({ text: vi.fn(), thinking: vi.fn(), toolStart: vi.fn(), toolEnd: vi.fn(), roundEnd: vi.fn(), notice: vi.fn() });

function agent(ask?: (question: unknown, signal: AbortSignal) => Promise<string | undefined>) {
    const runTool = vi.fn(async () => ({ content: [] }));
    return {
        runTool,
        agent: new NovaBrowserAgent({ apiKey: 'k', baseUrl: 'http://nova.test/v1', model: 'm', vision: false, maxRounds: 5, runTool, ask })
    };
}

afterEach(() => vi.unstubAllGlobals());

describe('parseQuestion', () => {
    it('requires a question', () => {
        expect(() => parseQuestion({ question: '  ' })).toThrow('"question" is required');
    });

    it('cleans options and keeps one recommendation for a single choice', () => {
        const question = parseQuestion({
            question: ' Which one? ',
            options: ['A', { label: ' B ', description: ' second ', recommended: true }, { label: 'C', recommended: true }, { label: '' }, null, { label: 'A' }]
        });
        expect(question).toEqual({
            question: 'Which one?',
            options: [{ label: 'A' }, { label: 'B', description: 'second', recommended: true }, { label: 'C' }],
            multiSelect: false,
            allowOther: true
        });
    });

    it('keeps several recommendations for multiSelect and always allows free text without options', () => {
        const multi = parseQuestion({ question: 'Which?', options: [{ label: 'A', recommended: true }, { label: 'B', recommended: true }], multiSelect: true, allowOther: false });
        expect(multi.options.every((option) => option.recommended)).toBe(true);
        expect(multi.allowOther).toBe(false);
        expect(parseQuestion({ question: 'Name?', allowOther: false, multiSelect: true })).toMatchObject({ allowOther: true, multiSelect: false });
    });
});

describe('ask_user in the agent', () => {
    it('is only offered when the panel can ask', async () => {
        const requests = server();
        await agent().agent.run('Buy milk', events(), new AbortController().signal);
        expect(requests[0].tools?.map((tool) => tool.function.name)).not.toContain(ASK_USER);
    });

    it('shows the question and hands the answer back to the model, not to the browser', async () => {
        const requests = server();
        const ask = vi.fn(async () => 'B');
        const { agent: nova, runTool } = agent(ask);
        await nova.run('Buy milk', events(), new AbortController().signal);

        expect(requests[0].tools?.map((tool) => tool.function.name)).toContain(ASK_USER);
        expect(ask).toHaveBeenCalledWith(expect.objectContaining({ question: 'Which shop?', options: [{ label: 'A', recommended: true }, { label: 'B' }] }), expect.any(AbortSignal));
        expect(runTool).not.toHaveBeenCalled();
        expect(requests[1].messages).toContainEqual({ role: 'tool', tool_call_id: 'call_1', content: 'The user answered: B' });
    });

    it('tells the model when the user skipped', async () => {
        const requests = server();
        await agent(async () => undefined).agent.run('Buy milk', events(), new AbortController().signal);
        const reply = requests[1].messages.find((message) => message.role === 'tool');
        expect(String(reply?.content)).toContain('skipped');
    });

    it('ends the run when Nova is stopped while the question is open', async () => {
        const requests = server();
        const controller = new AbortController();
        const ask = (_question: unknown, signal: AbortSignal) => new Promise<string | undefined>((resolve) => {
            signal.addEventListener('abort', () => resolve(undefined));
            controller.abort(new DOMException('Stopped', 'AbortError'));
        });
        const { agent: nova } = agent(ask);
        await expect(nova.run('Buy milk', events(), controller.signal)).rejects.toThrow('Stopped');
        expect(requests).toHaveLength(1);
        expect(nova.history).toContainEqual({ role: 'tool', tool_call_id: 'call_1', content: '(cancelled by the user)' });
    });
});
