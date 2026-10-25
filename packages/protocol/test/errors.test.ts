import { NovaAIError } from '@datalabrotterdam/nova-sdk';
import { describe, expect, it } from 'vitest';
import { isContextOverflow, isToolCallingRejected, parseContextLimit } from '../src/model/errors';

function novaError(status: number, message: string, code: string | null = null): NovaAIError {
    return new NovaAIError(message, { status, body: null, response: new Response(), requestId: null, configId: null, type: null, code });
}

describe('isToolCallingRejected', () => {
    it('accepts a 400 about tools', () => {
        expect(isToolCallingRejected(novaError(400, '"auto" tool choice requires --enable-auto-tool-choice'))).toBe(true);
        expect(isToolCallingRejected(novaError(400, 'Bad request', 'function_calling_not_supported'))).toBe(true);
    });

    it('rejects other errors', () => {
        expect(isToolCallingRejected(novaError(400, "This model's maximum context length is 8192 tokens"))).toBe(false);
        expect(isToolCallingRejected(novaError(400, 'messages: invalid role'))).toBe(false);
        expect(isToolCallingRejected(novaError(500, 'tool server crashed'))).toBe(false);
        expect(isToolCallingRejected(new Error('tools'))).toBe(false);
    });
});

describe('context overflow', () => {
    it('recognizes overflow errors and reads the limit', () => {
        const error = novaError(400, "This model's maximum context length is 8192 tokens. However, you requested 9000 tokens.");
        expect(isContextOverflow(error)).toBe(true);
        expect(parseContextLimit(error)).toBe(8_192);
        expect(isContextOverflow(novaError(413, 'prompt is too long'))).toBe(true);
        expect(isContextOverflow(novaError(400, 'tool_choice is not supported'))).toBe(false);
        expect(isContextOverflow(novaError(500, 'maximum context length'))).toBe(false);
        expect(parseContextLimit(novaError(413, 'prompt is too long'))).toBeUndefined();
    });
});
