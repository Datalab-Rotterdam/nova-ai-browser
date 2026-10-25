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
