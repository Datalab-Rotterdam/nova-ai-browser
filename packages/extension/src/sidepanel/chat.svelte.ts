import { errorResult, modelCapabilities, type PanelEvent, type ToolResult } from '@datalabrotterdam/nova-ai-browser-protocol';
import { NovaAI, NovaAIError, type ChatMessage, type ModelResponse } from '@datalabrotterdam/nova-sdk';
import { answerPermission, callTool, releaseTabs, setAgentRunning } from '../lib/bridge';
import { latestSession, saveSession } from '../lib/sessions';
import { saveSettings, type Settings } from '../lib/settings';
import { NovaBrowserAgent, type ToolCall } from './agent/loop';

export type ChatItem =
    /** `steered`: sent while Nova was working and handed to it at its next step. */
    | { kind: 'user'; id: number; text: string; steered?: boolean }
    | { kind: 'assistant'; id: number; text: string; thinking: string }
    | { kind: 'tool'; id: number; call: ToolCall; result?: ToolResult }
    | {
        kind: 'permission';
        id: number;
        requestId: string;
        /** "site": may Nova use this site; "agent": may this external agent use the browser. */
        subject: 'site' | 'agent';
        /** The site's origin or the agent's name. */
        target: string;
        /** For site prompts on behalf of an external agent. */
        agent?: string;
        tool: string;
        summary: string;
        answered?: string;
    }
    | { kind: 'notice'; id: number; text: string; tone: 'info' | 'error' };

/**
 * A message typed while Nova works (same model as nova-ai-vscode's composer queue):
 * "steer" is handed to Nova at its next step, "queue" runs as the next prompt after the reply.
 */
export interface QueuedMessage {
    id: number;
    text: string;
    mode: 'steer' | 'queue';
}

let nextId = 1;

export class ChatSession {
    items = $state<ChatItem[]>([]);
    running = $state(false);
    models = $state<ModelResponse[]>([]);
    modelsError = $state<string | undefined>();
    queue = $state<QueuedMessage[]>([]);

    private agent: NovaBrowserAgent | undefined;
    /** Set when the user pressed Stop: queued messages then wait instead of running automatically. */
    private stoppedByUser = false;
    private lastSettings: Settings | undefined;
    private agentKey = '';
    private controller: AbortController | undefined;
    private sessionId: string = crypto.randomUUID();
    private createdAt = Date.now();
    /** The model conversation of a restored chat, until the first run creates an agent with it. */
    private restoredHistory: ChatMessage[] | undefined;

    /** Reopens the most recent chat, e.g. after the panel was closed. */
    async restore(): Promise<void> {
        const session = await latestSession();
        if (!session) return;
        for (const item of session.items) {
            // Prompts and tool calls that were open when the panel closed cannot finish any more.
            if (item.kind === 'permission' && !item.answered) item.answered = 'Expired';
            if (item.kind === 'tool' && !item.result) item.result = errorResult('Interrupted: the side panel was closed.');
            nextId = Math.max(nextId, item.id + 1);
        }
        this.items = session.items;
        this.sessionId = session.id;
        this.createdAt = session.createdAt;
        this.restoredHistory = session.history;
    }

    private save(): void {
        const first = this.items.find((item) => item.kind === 'user');
        if (!first) return;
        void saveSession({
            id: this.sessionId,
            title: first.text.slice(0, 80),
            createdAt: this.createdAt,
            updatedAt: Date.now(),
            model: this.lastSettings?.model ?? '',
            items: this.items,
            history: this.agent?.history ?? this.restoredHistory ?? []
        }).catch(() => undefined);
    }

    async loadModels(settings: Settings): Promise<void> {
        this.modelsError = undefined;
        if (!settings.apiKey) {
            this.models = [];
            return;
        }
        try {
            const client = new NovaAI({ apiKey: settings.apiKey, baseUrl: settings.baseUrl, fetch: (input, init) => fetch(input, init) });
            const list = await client.models.list();
            this.models = list.data.filter((model) => model.enabled !== false);
        } catch (error) {
            this.models = [];
            this.modelsError = error instanceof NovaAIError && error.status === 401
                ? 'The API key was rejected.'
                : `Could not load models: ${error instanceof Error ? error.message : String(error)}`;
        }
    }

    /**
     * Checks a key against the Nova API and saves it, picking a default model that can use
     * tools and see screenshots when the current one is missing.
     */
    async connect(apiKey: string, settings: Settings): Promise<string | undefined> {
        try {
            const client = new NovaAI({ apiKey, baseUrl: settings.baseUrl, fetch: (input, init) => fetch(input, init) });
            const models = (await client.models.list()).data.filter((model) => model.enabled !== false);
            const usable = models.filter((model) => modelCapabilities(model).toolCalling);
            const current = models.find((model) => model.id === settings.model);
            const model = current?.id
                ?? usable.find((m) => modelCapabilities(m).imageInput)?.id
                ?? usable[0]?.id
                ?? models.find((m) => !(m.capabilities ?? []).some((c) => /embedding|audio/.test(c)))?.id
                ?? '';
            this.models = models;
            this.modelsError = undefined;
            await saveSettings({ apiKey, model });
            return undefined;
        } catch (error) {
            return error instanceof NovaAIError && (error.status === 401 || error.status === 403)
                ? 'Nova rejected this key. Check that it is active and has the models:read and llm:call scopes.'
                : `Could not reach Nova: ${error instanceof Error ? error.message : String(error)}`;
        }
    }

    visionFor(settings: Settings): boolean {
        if (settings.vision !== 'auto') return settings.vision === 'on';
        const model = this.models.find((m) => m.id === settings.model);
        return model ? modelCapabilities(model).imageInput : false;
    }

    newChat(): void {
        this.stop();
        this.items = [];
        this.queue = [];
        this.agent = undefined;
        this.restoredHistory = undefined;
        this.sessionId = crypto.randomUUID();
        this.createdAt = Date.now();
        void releaseTabs();
    }

    stop(reason?: string): void {
        if (!this.controller) return;
        this.stoppedByUser = true;
        this.controller.abort(new DOMException(reason ?? 'Stopped', 'AbortError'));
        this.controller = undefined;
        if (reason) this.push({ kind: 'notice', id: 0, text: reason, tone: 'info' });
    }

    handleEvent(event: PanelEvent): void {
        switch (event.type) {
            case 'agent/stop':
                this.stop(this.running ? event.reason : undefined);
                break;
            case 'permission/request':
                this.push(event.kind === 'agent'
                    ? { kind: 'permission', id: 0, requestId: event.id, subject: 'agent', target: event.client.name, tool: event.tool, summary: event.summary }
                    : { kind: 'permission', id: 0, requestId: event.id, subject: 'site', target: event.origin, agent: event.agent, tool: event.tool, summary: event.summary });
                break;
            case 'permission/resolved':
                for (const item of this.items) {
                    if (item.kind === 'permission' && item.requestId === event.id && !item.answered) item.answered = 'answered';
                }
                break;
        }
    }

    async answer(item: Extract<ChatItem, { kind: 'permission' }>, decision: 'once' | 'always' | 'deny'): Promise<void> {
        item.answered = decision === 'deny' ? 'Denied'
            : decision === 'always' ? 'Always allowed'
                : item.subject === 'agent' ? 'Allowed until the browser closes' : 'Allowed for this task';
        await answerPermission(item.requestId, decision);
    }

    /** Sends a message, or queues it as steering when Nova is already working. */
    async send(text: string, settings: Settings): Promise<void> {
        const prompt = text.trim();
        if (!prompt) return;
        if (this.running) {
            this.queue.push({ id: nextId++, text: prompt, mode: 'steer' });
            return;
        }
        this.stoppedByUser = false;
        await this.run(prompt, settings, false);
    }

    setQueueMode(id: number, mode: QueuedMessage['mode']): void {
        this.queue = this.queue.map((item) => (item.id === id ? { ...item, mode } : item));
    }

    removeQueued(id: number): void {
        this.queue = this.queue.filter((item) => item.id !== id);
    }

    /** While Nova works: steer with it right away. Otherwise: run it now. */
    async sendQueuedNow(id: number, settings: Settings): Promise<void> {
        const item = this.queue.find((candidate) => candidate.id === id);
        if (!item) return;
        this.queue = this.queue.filter((candidate) => candidate !== item);
        if (this.running) {
            this.queue = [{ ...item, mode: 'steer' }, ...this.queue];
            return;
        }
        this.stoppedByUser = false;
        await this.run(item.text, settings, false);
    }

    /** Hands steering messages to the running loop and shows them in the transcript. */
    private takeSteering(): string[] {
        const steering = this.queue.filter((item) => item.mode === 'steer');
        if (!steering.length) return [];
        this.queue = this.queue.filter((item) => item.mode !== 'steer');
        for (const item of steering) {
            this.push({ kind: 'user', id: 0, text: item.text, steered: true });
        }
        return steering.map((item) => item.text);
    }

    /**
     * After a reply, runs the next waiting message: steering that arrived too late for the
     * finished run goes first, then queued follow-ups. Nothing runs automatically after Stop.
     */
    private drainQueue(): void {
        if (this.running || this.stoppedByUser || !this.queue.length || !this.lastSettings) return;
        const next = this.queue.find((item) => item.mode === 'steer') ?? this.queue[0];
        this.queue = this.queue.filter((item) => item !== next);
        const settings = this.lastSettings;
        setTimeout(() => void this.run(next.text, settings, next.mode === 'steer'), 0);
    }

    private async run(prompt: string, settings: Settings, steered: boolean): Promise<void> {
        if (this.running) return;
        this.lastSettings = settings;
        if (!settings.apiKey || !settings.model) {
            this.push({ kind: 'notice', id: 0, text: 'Add your Nova API key and pick a model in Settings first.', tone: 'error' });
            return;
        }

        const vision = this.visionFor(settings);
        const model = this.models.find((m) => m.id === settings.model);
        const contextWindow = model ? modelCapabilities(model).contextWindow : undefined;
        const key = JSON.stringify([settings.apiKey, settings.baseUrl, settings.model, vision, contextWindow, settings.maxRounds]);
        if (!this.agent || key !== this.agentKey) {
            this.agent = new NovaBrowserAgent({
                apiKey: settings.apiKey,
                baseUrl: settings.baseUrl,
                model: settings.model,
                vision,
                contextWindow,
                maxRounds: settings.maxRounds,
                runTool: (call) => callTool(call.name, call.args, 'sidepanel'),
                takeSteering: () => this.takeSteering(),
                // Keep the conversation when settings change (e.g. another model) or a chat was restored.
                history: this.agent?.history ?? this.restoredHistory
            });
            this.agentKey = key;
            this.restoredHistory = undefined;
        }

        this.push({ kind: 'user', id: 0, text: prompt, ...(steered ? { steered } : {}) });
        this.running = true;
        this.controller = new AbortController();
        const signal = this.controller.signal;
        await setAgentRunning(true);

        let current: Extract<ChatItem, { kind: 'assistant' }> | undefined;
        const assistant = () => {
            if (!current) {
                current = this.push({ kind: 'assistant', id: 0, text: '', thinking: '' }) as Extract<ChatItem, { kind: 'assistant' }>;
            }
            return current;
        };
        const toolItems = new Map<string, Extract<ChatItem, { kind: 'tool' }>>();

        try {
            await this.agent.run(prompt, {
                text: (delta) => { assistant().text += delta; },
                thinking: (delta) => { assistant().thinking += delta; },
                toolStart: (call) => {
                    current = undefined;
                    toolItems.set(call.id, this.push({ kind: 'tool', id: 0, call }) as Extract<ChatItem, { kind: 'tool' }>);
                },
                toolEnd: (call, result) => {
                    const item = toolItems.get(call.id);
                    if (item) item.result = result;
                    this.save();
                },
                roundEnd: () => {
                    if (current && !current.text.trim() && !current.thinking.trim()) {
                        this.items = this.items.filter((item) => item.id !== current!.id);
                    }
                    current = undefined;
                    this.save();
                },
                notice: (text) => { this.push({ kind: 'notice', id: 0, text, tone: 'info' }); }
            }, signal);
        } catch (error) {
            if (!signal.aborted) {
                const message = error instanceof NovaAIError
                    ? `Nova API error (${error.status}): ${error.message}`
                    : error instanceof Error ? error.message : String(error);
                this.push({ kind: 'notice', id: 0, text: message, tone: 'error' });
            }
        } finally {
            this.running = false;
            this.controller = undefined;
            this.save();
            await setAgentRunning(false);
            this.drainQueue();
        }
    }

    private push(item: ChatItem): ChatItem {
        item.id = nextId++;
        this.items.push(item);
        // Return the proxied item so later mutations are reactive.
        return this.items[this.items.length - 1];
    }
}
