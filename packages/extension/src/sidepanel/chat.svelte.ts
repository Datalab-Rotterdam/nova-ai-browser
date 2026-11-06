import { effortFor, errorResult, modelCapabilities, type PanelEvent, type ToolResult } from '@datalabrotterdam/nova-ai-browser-protocol';
import { NovaAI, NovaAIError, type ChatMessage, type ModelResponse } from '@datalabrotterdam/nova-sdk';
import { answerPermission, callTool, releaseTabs, setAgentRunning } from '../lib/bridge';
import { latestSession, loadSession, saveSession, type StoredSession } from '../lib/sessions';
import { saveSettings, type Settings } from '../lib/settings';
import { ASK_USER, type Question } from './agent/ask';
import { TODO_WRITE, type TodoItem } from './agent/todos';
import { NovaBrowserAgent, type ToolCall } from './agent/loop';

export type ChatItem =
    /** `steered`: sent while Nova was working and handed to it at its next step. */
    | { kind: 'user'; id: number; text: string; steered?: boolean }
    | { kind: 'assistant'; id: number; text: string }
    /** The model's reasoning; `durationMs` is set once it is done. */
    | { kind: 'thinking'; id: number; text: string; durationMs?: number }
    | { kind: 'tool'; id: number; call: ToolCall; result?: ToolResult }
    /**
     * A question from the ask_user tool. `closed`: Nova stopped (or the panel closed) before
     * the user answered.
     */
    | (Question & { kind: 'question'; id: number; status: 'pending' | 'answered' | 'skipped' | 'closed'; answer?: string })
    | {
        kind: 'permission';
        id: number;
        requestId: string;
        /**
         * "site": may Nova use this site; "agent": may this external agent use the browser;
         * "upload": may these local files be uploaded to this site; "action": may Nova do this irreversible thing (summary is the element).
         */
        subject: 'site' | 'agent' | 'upload' | 'action';
        /** For upload prompts: the absolute file paths. */
        files?: string[];
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

type QuestionItem = Extract<ChatItem, { kind: 'question' }>;

export class ChatSession {
    items = $state<ChatItem[]>([]);
    running = $state(false);
    /** Nova's task list (todo_write); empty when there is none or the user closed it. */
    todos = $state<TodoItem[]>([]);
    /** The ask_user question waiting for an answer. */
    question = $state<QuestionItem | undefined>();
    models = $state<ModelResponse[]>([]);
    modelsError = $state<string | undefined>();
    queue = $state<QueuedMessage[]>([]);

    /** Read-only ("Ask") mode, copied from the settings at every send so it applies to a running chat. */
    private readOnlyMode = false;
    private agent: NovaBrowserAgent | undefined;
    /** Set when the user pressed Stop: queued messages then wait instead of running automatically. */
    private stoppedByUser = false;
    private lastSettings: Settings | undefined;
    private agentKey = '';
    private controller: AbortController | undefined;
    private sessionId = $state<string>(crypto.randomUUID());
    private createdAt = Date.now();
    /** The model conversation of a restored chat, until the first run creates an agent with it. */
    private restoredHistory: ChatMessage[] | undefined;
    /** Hands the answer to the waiting ask_user call. */
    private resolveQuestion: ((answer: string | undefined) => void) | undefined;

    /** Reopens the most recent chat, e.g. after the panel was closed. */
    async restore(): Promise<void> {
        const session = await latestSession();
        if (session) this.show(session);
    }

    /** Switches to a saved chat; not while Nova works. Returns whether it did. */
    async open(id: string): Promise<boolean> {
        const session = this.running ? undefined : await loadSession(id);
        if (!session) return false;
        this.newChat();
        this.show(session);
        return true;
    }

    get id(): string {
        return this.sessionId;
    }

    private show(session: StoredSession): void {
        for (const item of session.items) {
            nextId = Math.max(nextId, item.id + 1);
        }
        const items: ChatItem[] = [];
        for (const item of session.items) {
            // Prompts and tool calls that were open when the panel closed cannot finish any more.
            if (item.kind === 'permission' && !item.answered) item.answered = 'Expired';
            if (item.kind === 'tool' && !item.result) item.result = errorResult('Interrupted: the side panel was closed.');
            if (item.kind === 'question' && item.status === 'pending') item.status = 'closed';
            // Chats saved before thinking had its own item kept it on the answer.
            const legacy = item as ChatItem & { thinking?: string };
            if (item.kind === 'assistant' && legacy.thinking !== undefined) {
                if (legacy.thinking.trim()) items.push({ kind: 'thinking', id: nextId++, text: legacy.thinking });
                delete legacy.thinking;
                if (!item.text.trim()) continue;
            }
            items.push(item);
        }
        this.items = items;
        this.sessionId = session.id;
        this.createdAt = session.createdAt;
        this.restoredHistory = session.history;
        this.todos = session.todos ?? [];
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
            history: this.agent?.history ?? this.restoredHistory ?? [],
            ...(this.todos.length ? { todos: this.todos } : {})
        }).catch(() => undefined);
    }

    setReadOnly(on: boolean): void {
        this.readOnlyMode = on;
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
        this.todos = [];
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
                    : event.kind === 'action'
                        ? { kind: 'permission', id: 0, requestId: event.id, subject: 'action', target: event.origin, agent: event.agent, tool: event.tool, summary: event.element }
                    : event.kind === 'upload'
                        ? { kind: 'permission', id: 0, requestId: event.id, subject: 'upload', target: event.origin, agent: event.agent, files: event.files, tool: event.tool, summary: event.summary }
                        : { kind: 'permission', id: 0, requestId: event.id, subject: 'site', target: event.origin, agent: event.agent, tool: event.tool, summary: event.summary });
                break;
            case 'permission/resolved':
                for (const item of this.items) {
                    if (item.kind === 'permission' && item.requestId === event.id && !item.answered) item.answered = event.timedOut ? 'No answer after 3 minutes: counted as denied' : 'answered';
                }
                break;
        }
    }

    async answer(item: Extract<ChatItem, { kind: 'permission' }>, decision: 'once' | 'always' | 'deny'): Promise<void> {
        item.answered = decision === 'deny' ? 'Denied'
            : decision === 'always' ? 'Always allowed'
                : item.subject === 'agent' ? 'Allowed until the browser closes'
                    : item.subject === 'upload' ? 'Upload allowed' : item.subject === 'action' ? 'Action allowed' : 'Allowed for this task';
        await answerPermission(item.requestId, decision);
    }

    /**
     * Shows an ask_user question and waits for the answer (undefined when skipped). Stop closes
     * it; the agent then ends the run.
     */
    ask(question: Question, signal: AbortSignal): Promise<string | undefined> {
        return new Promise((resolve) => {
            const item = this.push({ kind: 'question', id: 0, ...question, status: 'pending' }) as QuestionItem;
            const onAbort = () => this.closeQuestion(item, 'closed', undefined);
            signal.addEventListener('abort', onAbort, { once: true });
            this.question = item;
            this.resolveQuestion = (answer) => {
                signal.removeEventListener('abort', onAbort);
                resolve(answer);
            };
            this.save();
        });
    }

    /** The user closed the task list; Nova's next update shows it again. */
    dismissTodos(): void {
        this.todos = [];
        this.save();
    }

    /** The user's answer to the open question; empty skips it. */
    answerQuestion(item: QuestionItem, answer: string | undefined): void {
        const text = answer?.trim();
        this.closeQuestion(item, text ? 'answered' : 'skipped', text || undefined);
    }

    private closeQuestion(item: QuestionItem, status: QuestionItem['status'], answer: string | undefined): void {
        if (!this.question || this.question.id !== item.id) return;
        const resolve = this.resolveQuestion;
        this.question.status = status;
        if (answer !== undefined) this.question.answer = answer;
        this.question = undefined;
        this.resolveQuestion = undefined;
        resolve?.(answer);
        this.save();
    }

    /** Sends a message, or queues it as steering when Nova is already working. */
    async send(text: string, settings: Settings): Promise<void> {
        const prompt = text.trim();
        if (!prompt) return;
        this.readOnlyMode = settings.readOnly;
        // A pending question is answered by whatever the user types.
        if (this.question) {
            this.answerQuestion(this.question, prompt);
            return;
        }
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
        const effort = effortFor(model, settings.effort);
        const key = JSON.stringify([settings.apiKey, settings.baseUrl, settings.model, vision, contextWindow, effort, settings.maxRounds]);
        if (!this.agent || key !== this.agentKey) {
            this.agent = new NovaBrowserAgent({
                apiKey: settings.apiKey,
                baseUrl: settings.baseUrl,
                model: settings.model,
                vision,
                contextWindow,
                effort,
                maxRounds: settings.maxRounds,
                runTool: (call) => callTool(call.name, call.args, 'sidepanel'),
                readOnly: () => this.readOnlyMode,
                ask: (question, signal) => this.ask(question, signal),
                setTodos: (todos) => {
                    this.todos = todos;
                    this.save();
                },
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

        // Thinking and answer text of the current model response, each its own item, in the order they arrive.
        let current: Extract<ChatItem, { kind: 'assistant' }> | undefined;
        let thought: { item: Extract<ChatItem, { kind: 'thinking' }>; startedAt: number } | undefined;
        const endThinking = () => {
            if (thought) thought.item.durationMs = Date.now() - thought.startedAt;
            thought = undefined;
        };
        const endResponse = () => {
            endThinking();
            if (current && !current.text.trim()) {
                const blank = current;
                this.items = this.items.filter((item) => item.id !== blank.id);
            }
            current = undefined;
        };
        const toolItems = new Map<string, Extract<ChatItem, { kind: 'tool' }>>();

        try {
            await this.agent.run(prompt, {
                text: (delta) => {
                    endThinking();
                    current ??= this.push({ kind: 'assistant', id: 0, text: '' }) as Extract<ChatItem, { kind: 'assistant' }>;
                    current.text += delta;
                },
                thinking: (delta) => {
                    if (!thought) {
                        // Thinking after some answer text starts a new step below it.
                        current = undefined;
                        thought = { item: this.push({ kind: 'thinking', id: 0, text: '' }) as Extract<ChatItem, { kind: 'thinking' }>, startedAt: Date.now() };
                    }
                    thought.item.text += delta;
                },
                toolStart: (call) => {
                    endResponse();
                    // A question gets its own card (see ask), not a tool card.
                    // The task list has its own strip above the composer.
                    if (call.name === ASK_USER || call.name === TODO_WRITE) return;
                    toolItems.set(call.id, this.push({ kind: 'tool', id: 0, call }) as Extract<ChatItem, { kind: 'tool' }>);
                },
                toolEnd: (call, result) => {
                    const item = toolItems.get(call.id);
                    if (item) item.result = result;
                    this.save();
                },
                roundEnd: () => {
                    endResponse();
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
            endResponse();
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
