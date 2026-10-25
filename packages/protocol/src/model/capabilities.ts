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

type EffortModel = Pick<ModelResponse, 'capabilities'> & { reasoning_efforts?: unknown; reasoning_default?: unknown };

/**
 * Levels the gateway lists in `reasoning_efforts`, lowest first; a model that can think but lists
 * none gets an Off / On switch (["none", "medium"]; "medium" stands for any level but "none").
 * Ported from nova-ai-vscode src/panel/ChatController.ts `effortsOf`.
 */
export function modelEfforts(model: EffortModel | undefined): string[] {
    const listed = Array.isArray(model?.reasoning_efforts) ? model.reasoning_efforts.filter((level) => typeof level === 'string') : [];
    return !listed.length && model?.capabilities?.includes('reasoning') ? ['none', 'medium'] : listed;
}

/** Whether the model only has thinking on or off, no levels. */
export function hasThinkingSwitch(model: EffortModel | undefined): boolean {
    return modelEfforts(model).length > 0 && !(Array.isArray(model?.reasoning_efforts) && model.reasoning_efforts.length);
}

/**
 * The `reasoning_effort` to send: the chosen level when the model accepts it, else "none" for a
 * model that thinks only on request, else its middle level; undefined for a model without levels.
 */
export function effortFor(model: EffortModel | undefined, chosen: string | undefined): string | undefined {
    const efforts = modelEfforts(model);
    if (!efforts.length) return undefined;
    if (chosen && efforts.includes(chosen)) return chosen;
    if (efforts.includes('none') && model?.reasoning_default === 'off') return 'none';
    return efforts.includes('medium') ? 'medium' : efforts[Math.floor((efforts.length - 1) / 2)];
}
