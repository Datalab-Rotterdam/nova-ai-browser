import type { ModelResponse } from '@datalabrotterdam/nova-sdk';

export interface ModelCapabilities {
    toolCalling: boolean;
    imageInput: boolean;
    /** Context window in tokens, when the model advertises one. */
    contextWindow?: number;
}

/** Same capability names nova-ai-vscode recognizes (src/model/modelProvider.ts). */
const TOOL_CAPABILITIES = ['tool', 'tools', 'tool-calling', 'tool_calling', 'function-calling', 'function_calling', 'functions'];
const IMAGE_CAPABILITIES = ['image', 'images', 'image-input', 'image_input', 'vision', 'multimodal'];
const CONTEXT_WINDOW_KEYS = ['context_window', 'max_model_len', 'contextWindow', 'maxModelLen', 'context_length', 'contextLength'];

export function modelCapabilities(model: Pick<ModelResponse, 'capabilities' | 'tags'> & Record<string, unknown>): ModelCapabilities {
    const names = new Set([...(model.capabilities ?? []), ...(model.tags ?? [])].map((name) => name.toLowerCase()));
    return {
        toolCalling: TOOL_CAPABILITIES.some((name) => names.has(name)),
        imageInput: IMAGE_CAPABILITIES.some((name) => names.has(name)),
        contextWindow: firstNumber(model, CONTEXT_WINDOW_KEYS)
    };
}

/** Looks in the places gateways put model limits (nova-ai-vscode `firstNumber`). */
function firstNumber(model: Record<string, unknown>, keys: string[]): number | undefined {
    for (const container of [model, model.metadata, model.limits]) {
        if (!container || typeof container !== 'object') continue;
        for (const key of keys) {
            const value = Number((container as Record<string, unknown>)[key] ?? NaN);
            if (Number.isFinite(value) && value > 0) return value;
        }
    }
    return undefined;
}
