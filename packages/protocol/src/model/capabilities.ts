import type { ModelResponse } from '@datalabrotterdam/nova-sdk';

export interface ModelCapabilities {
    toolCalling: boolean;
    imageInput: boolean;
}

/** Same capability names nova-ai-vscode recognizes (src/model/modelProvider.ts). */
const TOOL_CAPABILITIES = ['tool', 'tools', 'tool-calling', 'tool_calling', 'function-calling', 'function_calling', 'functions'];
const IMAGE_CAPABILITIES = ['image', 'images', 'image-input', 'image_input', 'vision', 'multimodal'];

export function modelCapabilities(model: Pick<ModelResponse, 'capabilities' | 'tags'>): ModelCapabilities {
    const names = new Set([...(model.capabilities ?? []), ...(model.tags ?? [])].map((name) => name.toLowerCase()));
    return {
        toolCalling: TOOL_CAPABILITIES.some((name) => names.has(name)),
        imageInput: IMAGE_CAPABILITIES.some((name) => names.has(name))
    };
}
