// Ported from nova-ai-vscode src/core/errors.ts; keep the two in sync.
import { NovaAIError } from '@datalabrotterdam/nova-sdk';

/**
 * Whether the server rejected the request because of its tools. Only then is the text
 * tool-call fallback worth it: other 400s (context too long, a malformed message) fail again.
 */
export function isToolCallingRejected(error: unknown): boolean {
    if (!(error instanceof NovaAIError)) {
        return false;
    }
    const message = `${error.message} ${error.code ?? ''} ${error.type ?? ''}`.toLowerCase();
    return error.status === 400 && (message.includes('tool') || message.includes('function'));
}

const CONTEXT_OVERFLOW = /context[ _-]?length|context window|maximum context|too many tokens|prompt is too long|input is too long|exceeds? (?:the )?(?:model'?s? )?(?:maximum|max)|max_model_len/i;

/** Whether the request failed because the prompt does not fit the model's context window. */
export function isContextOverflow(error: unknown): boolean {
    if (!(error instanceof Error)) {
        return false;
    }
    const status = error instanceof NovaAIError ? error.status : undefined;
    const text = error instanceof NovaAIError ? `${error.message} ${error.code ?? ''} ${error.type ?? ''}` : error.message;
    return (status === undefined || status === 400 || status === 413) && CONTEXT_OVERFLOW.test(text);
}

/** Extracts the real context window from overflow errors such as "maximum context length is 8192 tokens". */
export function parseContextLimit(error: unknown): number | undefined {
    if (!(error instanceof Error)) {
        return undefined;
    }
    const match = /(?:maximum context length|context length|context window|max_model_len)\D{0,40}?(\d{3,8})/i.exec(error.message);
    const value = match ? Number(match[1]) : NaN;
    return Number.isFinite(value) && value > 0 ? value : undefined;
}
