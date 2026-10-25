/**
 * The "Nova direct" agent: streams Nova chat completions, runs the browser tools the model
 * asks for (through the service worker) and feeds results back until the model answers.
 *
 * - Native OpenAI tool calls when the model supports them; text tool calls (`<tool_call>`)
 *   as fallback when the server rejects tools.
 * - Screenshots go back as `image_url` parts for vision models. Only the newest few images
 *   stay in the history, older ones become a placeholder, to bound context size.
 */
import { NovaAI, NovaAIError, type ChatMessage } from '@datalabrotterdam/nova-sdk';
import {
    ChatStreamParser,
    createToolPayload,
    resultText,
    TOOL_DEFINITIONS,
    type ToolResult
} from '@datalabrotterdam/nova-ai-browser-protocol';
import { systemPrompt } from './prompt';

const KEPT_IMAGES = 2;
const IMAGE_PLACEHOLDER = '[older screenshot removed to save context]';

export interface ToolCall {
    id: string;
    name: string;
    args: Record<string, unknown>;
}

export interface AgentEvents {
    text(delta: string): void;
    thinking(delta: string): void;
    toolStart(call: ToolCall): void;
    toolEnd(call: ToolCall, result: ToolResult): void;
    /** A model response finished; a new assistant bubble should start for the next one. */
    roundEnd(): void;
    notice(text: string): void;
}

export interface AgentOptions {
    apiKey: string;
    baseUrl: string;
    model: string;
    vision: boolean;
    maxRounds: number;
    runTool(call: ToolCall): Promise<ToolResult>;
    /**
     * Messages the user sent while Nova works ("steering"). Called before every model call
     * after the first; they join the conversation as user messages.
     */
    takeSteering?(): string[];
    /** The conversation so far, e.g. of a restored chat or the agent before a model switch. */
    history?: ChatMessage[];
}

type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

export class NovaBrowserAgent {
    private readonly client: NovaAI;
    public readonly history: ChatMessage[];
    private textTools = false;
    private lastSignature = '';
    private repeats = 0;

    public constructor(private readonly options: AgentOptions) {
        // Bind fetch: extension pages throw "Illegal invocation" for an unbound window.fetch.
        this.client = new NovaAI({ apiKey: options.apiKey, baseUrl: options.baseUrl, fetch: (input, init) => fetch(input, init) });
        this.history = options.history ?? [];
    }

    public async run(prompt: string, events: AgentEvents, signal: AbortSignal): Promise<void> {
        // A restored chat may end in tool calls that never ran (the panel closed mid-step).
        this.answerOpenToolCalls();
        this.history.push({ role: 'user', content: prompt });
        try {
            await this.loop(events, signal);
        } finally {
            this.answerOpenToolCalls();
        }
    }

    /**
     * After Stop or an error, every declared tool call still needs a result,
     * or the next request is rejected.
     */
    private answerOpenToolCalls(): void {
        const last = [...this.history].reverse().find((message) => message.role === 'assistant');
        const calls = (last?.tool_calls ?? []) as Array<{ id: string }>;
        const answered = new Set(this.history.filter((m) => m.role === 'tool').map((m) => m.tool_call_id));
        for (const call of calls) {
            if (!answered.has(call.id)) {
                this.history.push({ role: 'tool', tool_call_id: call.id, content: '(cancelled by the user)' });
            }
        }
    }

    private async loop(events: AgentEvents, signal: AbortSignal): Promise<void> {

        for (let round = 0; round < this.options.maxRounds; round++) {
            signal.throwIfAborted();
            if (round > 0) {
                for (const text of this.options.takeSteering?.() ?? []) {
                    this.addUserText(`The user sent this while you were working (follow it, it may change the plan):\n${text}`);
                }
            }
            const response = await this.complete(events, signal);
            events.roundEnd();

            if (!response.calls.length) {
                return;
            }

            const images: ContentPart[] = [];
            const textResults: string[] = [];
            for (const call of response.calls) {
                signal.throwIfAborted();
                events.toolStart(call);
                const result = await this.options.runTool(call);
                events.toolEnd(call, result);
                let text = this.resultForModel(result);

                // Small models can get stuck repeating one action; point it out so they change approach.
                const signature = JSON.stringify([call.name, call.args]);
                this.repeats = signature === this.lastSignature ? this.repeats + 1 : 1;
                this.lastSignature = signature;
                const repeatable = call.name === 'computer' && (call.args.action === 'scroll' || call.args.action === 'wait');
                if (this.repeats >= 3 && !repeatable) {
                    text += `\n\nNote: you have made this exact call ${this.repeats} times in a row. If the page is not changing, stop repeating it and try a different approach (other tool, ref, keyboard, or ask the user).`;
                }

                if (this.textTools) {
                    textResults.push(`Result of ${call.name}${result.isError ? ' (error)' : ''}:\n${text}`);
                } else {
                    this.history.push({ role: 'tool', tool_call_id: call.id, content: text });
                }
                for (const block of result.content) {
                    if (block.type === 'image' && this.options.vision) {
                        images.push({ type: 'text', text: `Screenshot from ${call.name} (${call.id}):` });
                        images.push({ type: 'image_url', image_url: { url: `data:${block.mimeType};base64,${block.data}` } });
                    }
                }
            }

            if (this.textTools) {
                this.history.push({ role: 'user', content: [{ type: 'text', text: textResults.join('\n\n') }, ...images] });
            } else if (images.length) {
                this.history.push({ role: 'user', content: images });
            }
        }

        events.notice(`Stopped after ${this.options.maxRounds} steps. Say "continue" to let Nova go on.`);
    }

    /**
     * Adds user text, joining it to a user message that is already last (tool screenshots are
     * sent as a user message): some servers reject two user messages in a row.
     */
    private addUserText(text: string): void {
        const last = this.history[this.history.length - 1];
        if (last?.role === 'user') {
            const parts: ContentPart[] = Array.isArray(last.content)
                ? [...last.content as ContentPart[]]
                : [{ type: 'text', text: String(last.content ?? '') }];
            parts.push({ type: 'text', text });
            last.content = parts;
        } else {
            this.history.push({ role: 'user', content: text });
        }
    }

    private resultForModel(result: ToolResult): string {
        const text = resultText(result);
        const hasImage = result.content.some((block) => block.type === 'image');
        if (hasImage && !this.options.vision) {
            return `${text.replace(/\[image [^\]]+\]/g, '').trim()}\n(This model cannot see images. Use read_page, find or get_page_text instead.)`;
        }
        return text.replace(/\[image [^\]]+\]/g, hasImage ? '(image attached below)' : '').trim() || '(no output)';
    }

    private async complete(events: AgentEvents, signal: AbortSignal): Promise<{ calls: ToolCall[] }> {
        try {
            return await this.stream(events, signal);
        } catch (error) {
            if (!this.textTools && error instanceof NovaAIError && (error.status === 400 || error.status === 422)) {
                // The model or server does not accept native tools: describe them in the prompt instead.
                this.textTools = true;
                events.notice('This model does not support native tool calls; using text tool calls.');
                return this.stream(events, signal);
            }
            throw error;
        }
    }

    private async stream(events: AgentEvents, signal: AbortSignal): Promise<{ calls: ToolCall[] }> {
        const tools = createToolPayload(TOOL_DEFINITIONS);
        const calls: ToolCall[] = [];
        let text = '';

        const parser = new ChatStreamParser(
            { callIdPrefix: `call_${Date.now().toString(36)}`, toolNames: tools.names },
            {
                text: (value) => {
                    text += value;
                    events.text(value);
                },
                thinking: (value) => events.thinking(value),
                toolCall: (id, name, args) => calls.push({ id, name, args })
            }
        );

        const messages: ChatMessage[] = [
            { role: 'system', content: systemPrompt({ vision: this.options.vision, textTools: this.textTools, now: new Date() }) },
            ...pruneImages(this.history, this.options.vision ? KEPT_IMAGES : 0)
        ];

        const stream = this.client.chat.completions.stream(
            { model: this.options.model, messages, ...(this.textTools ? {} : tools.payload) },
            { signal }
        );
        for await (const event of stream) {
            if (event.type === 'chunk') {
                parser.pushChunk(event.data);
            }
        }
        parser.end();

        if (this.textTools) {
            const written = calls.map((call) => `<tool_call>${JSON.stringify({ name: call.name, arguments: call.args })}</tool_call>`).join('\n');
            this.history.push({ role: 'assistant', content: [text, written].filter(Boolean).join('\n') || '(no response)' });
        } else {
            this.history.push({
                role: 'assistant',
                content: text || null,
                ...(calls.length ? {
                    tool_calls: calls.map((call) => ({
                        id: call.id,
                        type: 'function',
                        function: { name: tools.names.toNova(call.name), arguments: JSON.stringify(call.args) }
                    }))
                } : {})
            });
        }
        return { calls };
    }
}

/** Copies the history, replacing all but the newest `kept` images with a short placeholder. */
function pruneImages(history: readonly ChatMessage[], kept: number): ChatMessage[] {
    let remaining = kept;
    const result = [...history];
    for (let i = result.length - 1; i >= 0; i--) {
        const message = result[i];
        if (!Array.isArray(message.content)) continue;
        const parts = (message.content as ContentPart[]).map((part) => {
            if (part.type !== 'image_url') return part;
            if (remaining > 0) {
                remaining--;
                return part;
            }
            return { type: 'text', text: IMAGE_PLACEHOLDER } as ContentPart;
        });
        result[i] = { ...message, content: parts };
    }
    return result;
}
