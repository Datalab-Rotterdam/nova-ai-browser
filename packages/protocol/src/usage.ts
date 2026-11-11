/** Token usage and cost of one chat, summed over every model request. */
export interface Usage {
    inputTokens: number;
    outputTokens: number;
    /** Part of the input the server served from its cache (when it says so). */
    cachedTokens: number;
    requests: number;
    /** In `currency`; only counts requests whose model has prices. */
    cost: number;
    currency?: string;
    /** False when some request had no prices, so `cost` is a lower bound. */
    costComplete: boolean;
    /** True when the gateway estimated some token counts instead of the provider reporting them. */
    estimated: boolean;
}

export const EMPTY_USAGE: Usage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0, requests: 0, cost: 0, costComplete: true, estimated: false };

/** What one request used, as read from the stream. */
export interface RequestUsage {
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
    estimated: boolean;
}

export interface ModelPrices {
    inputPer1m?: number | null;
    outputPer1m?: number | null;
    currency?: string | null;
}

const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0);

/** The usage of a chat completion chunk (`usage`, `usage_source`); undefined when the chunk has none. */
export function readUsage(chunk: { usage?: unknown; usage_source?: unknown }): RequestUsage | undefined {
    const raw = chunk.usage as { prompt_tokens?: unknown; completion_tokens?: unknown; prompt_tokens_details?: { cached_tokens?: unknown } } | undefined | null;
    if (!raw || typeof raw !== 'object') return undefined;
    const inputTokens = count(raw.prompt_tokens);
    const outputTokens = count(raw.completion_tokens);
    if (!inputTokens && !outputTokens) return undefined;
    return { inputTokens, outputTokens, cachedTokens: count(raw.prompt_tokens_details?.cached_tokens), estimated: chunk.usage_source === 'gateway_estimated' };
}

/** Adds one request to a chat's total; the cost uses the prices of the model that ran it. */
export function addUsage(total: Usage, request: RequestUsage, prices?: ModelPrices): Usage {
    const priced = prices && typeof prices.inputPer1m === 'number' && typeof prices.outputPer1m === 'number';
    const cost = priced ? (request.inputTokens * prices.inputPer1m! + request.outputTokens * prices.outputPer1m!) / 1_000_000 : 0;
    return {
        inputTokens: total.inputTokens + request.inputTokens,
        outputTokens: total.outputTokens + request.outputTokens,
        cachedTokens: total.cachedTokens + request.cachedTokens,
        requests: total.requests + 1,
        cost: total.cost + cost,
        currency: total.currency ?? (priced ? prices.currency ?? undefined : undefined),
        costComplete: total.costComplete && Boolean(priced),
        estimated: total.estimated || request.estimated
    };
}

/** 950 -> "950", 12400 -> "12.4k", 1250000 -> "1.25M". */
export function formatTokens(tokens: number): string {
    if (tokens < 1000) return String(tokens);
    if (tokens < 1_000_000) return `${trim(tokens / 1000, tokens < 10_000 ? 2 : 1)}k`;
    return `${trim(tokens / 1_000_000, 2)}M`;
}

const trim = (value: number, digits: number) => value.toFixed(digits).replace(/\.?0+$/, '');

const SYMBOLS: Record<string, string> = { EUR: '€', USD: '$', GBP: '£' };

/** 0.0312 EUR -> "€0.03"; tiny amounts keep more digits so they do not show as zero. */
export function formatCost(cost: number, currency?: string): string {
    const symbol = currency ? SYMBOLS[currency.toUpperCase()] : '€';
    const digits = cost === 0 ? 2 : cost < 0.01 ? 4 : 2;
    const amount = cost.toFixed(digits);
    return symbol ? `${symbol}${amount}` : `${amount} ${currency ?? ''}`.trim();
}

/** One line for the panel: "12.4k in · 1.2k out · €0.03"; `undefined` before the first request. */
export function usageSummary(usage: Usage): string | undefined {
    if (!usage.requests) return undefined;
    const parts = [`${usage.estimated ? '~' : ''}${formatTokens(usage.inputTokens)} in`, `${usage.estimated ? '~' : ''}${formatTokens(usage.outputTokens)} out`];
    if (usage.cost > 0) parts.push(`${usage.costComplete ? '' : '≥'}${formatCost(usage.cost, usage.currency)}`);
    return parts.join(' · ');
}
