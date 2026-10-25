// Ported from nova-ai-vscode src/agent/ContextManager.ts and src/model/tokenEstimator.ts for
// OpenAI-style messages; keep them in sync.
import type { ChatMessage } from '@datalabrotterdam/nova-sdk';

export type CompactionStage = 'none' | 'pruned' | 'summarized' | 'trimmed';

export interface FitOptions {
    /** Input tokens available for messages (context window minus output, tools and margin). */
    budget: number;
    /** Compact once the estimate exceeds this share of the budget. */
    threshold: number;
    /** Writes a summary of the given transcript. */
    summarize?: (transcript: string) => Promise<string>;
}

export interface FitResult {
    messages: ChatMessage[];
    stage: CompactionStage;
    estimatedTokens: number;
}

/** Rough cost of one image in the prompt; the bytes themselves are not text. */
const IMAGE_TOKENS = 1_000;
const PRUNED_RESULT_TOKENS = 400;
const KEEP_RECENT_TOOL_RESULTS = 4;
const TRANSCRIPT_RESULT_CHARS = 1_500;
/** Output room for models that do not advertise a limit (nova-ai-vscode DEFAULT_MAX_OUTPUT_TOKENS). */
const MAX_OUTPUT_TOKENS = 16_384;

type Part = { type: string; text?: string };
type ToolCallLike = { function?: { name?: string; arguments?: string } };

/**
 * Input tokens left for the conversation in a context window: a quarter (at most 16k) is kept
 * for the answer and 2% (at least 1,024) for chat-template overhead and estimation error.
 */
export function inputBudget(contextWindow: number): number {
    const output = Math.min(MAX_OUTPUT_TOKENS, Math.floor(contextWindow / 4));
    return Math.max(1, contextWindow - output - Math.max(1_024, Math.ceil(contextWindow * 0.02)));
}

/** Conservative estimate: ~3 UTF-8 bytes per token. */
export function estimateTextTokens(text: string): number {
    return Math.max(1, Math.ceil(new TextEncoder().encode(text).length / 3));
}

export function estimateMessagesTokens(messages: readonly ChatMessage[]): number {
    return messages.reduce((total, message) => {
        const images = parts(message).filter((part) => part.type === 'image_url').length;
        return total + 4 + images * IMAGE_TOKENS + estimateTextTokens(messageText(message));
    }, 0);
}

/**
 * Keeps a conversation inside the model's input budget. Stages, cheapest first:
 * 1. prune old tool results to their head and tail,
 * 2. summarize older turns with one model call (when `summarize` is given),
 * 3. drop the oldest turns.
 * Tool calls and their results are never separated.
 */
export async function fitToBudget(messages: readonly ChatMessage[], options: FitOptions): Promise<FitResult> {
    const trigger = options.budget * options.threshold;
    // Compact well below the trigger so the next rounds have room.
    const target = options.budget * Math.min(options.threshold, 0.6);

    let current = [...messages];
    let tokens = estimateMessagesTokens(current);
    if (tokens <= trigger) {
        return { messages: current, stage: 'none', estimatedTokens: tokens };
    }

    current = pruneToolResults(current);
    tokens = estimateMessagesTokens(current);
    if (tokens <= target) {
        return { messages: current, stage: 'pruned', estimatedTokens: tokens };
    }

    if (options.summarize) {
        const summarized = await summarizeOlderTurns(current, options.summarize, target);
        if (summarized) {
            tokens = estimateMessagesTokens(summarized);
            if (tokens <= options.budget) {
                return { messages: summarized, stage: 'summarized', estimatedTokens: tokens };
            }
            current = summarized;
        }
    }

    current = trimOldest(current, options.budget);
    return { messages: current, stage: 'trimmed', estimatedTokens: estimateMessagesTokens(current) };
}

/** Shortens tool results outside the most recent ones to a head and tail excerpt. */
export function pruneToolResults(messages: readonly ChatMessage[]): ChatMessage[] {
    const resultIndexes = messages.flatMap((message, index) => (message.role === 'tool' ? [index] : []));
    const recent = new Set(resultIndexes.slice(-KEEP_RECENT_TOOL_RESULTS));

    return messages.map((message, index) => {
        if (message.role !== 'tool' || recent.has(index)) {
            return message;
        }
        const text = messageText(message);
        return estimateTextTokens(text) <= PRUNED_RESULT_TOKENS
            ? message
            : { ...message, content: excerpt(text, PRUNED_RESULT_TOKENS * 3) };
    });
}

async function summarizeOlderTurns(
    messages: readonly ChatMessage[],
    summarize: (transcript: string) => Promise<string>,
    target: number
): Promise<ChatMessage[] | undefined> {
    const boundaries = safeBoundaries(messages);

    // Keep as many recent messages as fit in half of the target, starting at a safe boundary.
    const cut = boundaries.find((index) => estimateMessagesTokens(messages.slice(index)) <= target / 2)
        ?? boundaries[boundaries.length - 1];
    if (cut === undefined) {
        return undefined;
    }

    const summary = (await summarize(buildTranscript(messages.slice(0, cut)))).trim();
    if (!summary) {
        return undefined;
    }
    return [{ role: 'user', content: summaryBlock(summary) }, ...messages.slice(cut)];
}

/** Drops the oldest messages, at safe boundaries, until the conversation fits. */
function trimOldest(messages: readonly ChatMessage[], budget: number): ChatMessage[] {
    const boundaries = safeBoundaries(messages);
    if (!boundaries.length) {
        return [...messages];
    }
    const note: ChatMessage = { role: 'user', content: '[Earlier messages were removed to fit the context window.]' };
    for (const boundary of boundaries) {
        const candidate = [note, ...messages.slice(boundary)];
        if (estimateMessagesTokens(candidate) <= budget) {
            return candidate;
        }
    }
    // Even the last turn alone does not fit: keep it and let the server decide.
    return [note, ...messages.slice(boundaries[boundaries.length - 1])];
}

/**
 * Indexes where the conversation can be cut: before an assistant message, so a tool call is
 * never separated from its result, and the user message put in front (summary or note) keeps
 * roles alternating for servers that require it.
 */
function safeBoundaries(messages: readonly ChatMessage[]): number[] {
    return messages.flatMap((message, index) => (index > 0 && message.role === 'assistant' ? [index] : []));
}

/** How a summary of compacted turns is given to the model. */
export function summaryBlock(summary: string): string {
    return `<conversation-summary>\nEarlier parts of this conversation were compacted. Summary:\n\n${summary}\n</conversation-summary>`;
}

export function buildTranscript(messages: readonly ChatMessage[]): string {
    return messages.map((message) => {
        if (message.role === 'tool') {
            return `Tool result:\n${excerpt(messageText(message), TRANSCRIPT_RESULT_CHARS)}`;
        }
        const text = messageText(message).trim();
        if (!text || message.role === 'system') {
            return '';
        }
        return `${message.role === 'assistant' ? 'Assistant' : 'User'}:\n${text}`;
    }).filter(Boolean).join('\n\n');
}

function messageText(message: ChatMessage): string {
    const text = typeof message.content === 'string'
        ? message.content
        : parts(message).map((part) => part.text ?? '').filter(Boolean).join('\n');
    const calls = (message.tool_calls ?? []) as ToolCallLike[];
    return [text, ...calls.map((call) => `[tool call] ${call.function?.name} ${call.function?.arguments}`)].filter(Boolean).join('\n');
}

function parts(message: ChatMessage): Part[] {
    return Array.isArray(message.content) ? message.content as Part[] : [];
}

function excerpt(text: string, maxChars: number): string {
    if (text.length <= maxChars) {
        return text;
    }
    const half = Math.floor(maxChars / 2);
    const omitted = estimateTextTokens(text.slice(half, text.length - half));
    return `${text.slice(0, half)}\n[… ${omitted} tokens truncated …]\n${text.slice(text.length - half)}`;
}
