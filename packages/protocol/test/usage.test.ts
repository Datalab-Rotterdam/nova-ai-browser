import { describe, expect, it } from 'vitest';
import { addUsage, EMPTY_USAGE, formatCost, formatTokens, readUsage, usageSummary } from '../src/usage';

describe('readUsage', () => {
    it('reads provider usage and the cached part, and flags gateway estimates', () => {
        expect(readUsage({ usage: { prompt_tokens: 1200, completion_tokens: 80, prompt_tokens_details: { cached_tokens: 1000 } } }))
            .toEqual({ inputTokens: 1200, outputTokens: 80, cachedTokens: 1000, estimated: false });
        expect(readUsage({ usage: { prompt_tokens: 10, completion_tokens: 2 }, usage_source: 'gateway_estimated' })?.estimated).toBe(true);
    });

    it('ignores chunks without usable numbers', () => {
        expect(readUsage({})).toBeUndefined();
        expect(readUsage({ usage: null })).toBeUndefined();
        expect(readUsage({ usage: { prompt_tokens: 'x' } })).toBeUndefined();
    });
});

describe('addUsage', () => {
    const request = { inputTokens: 10_000, outputTokens: 2_000, cachedTokens: 0, estimated: false };

    it('sums tokens and prices each request with its own model', () => {
        const first = addUsage(EMPTY_USAGE, request, { inputPer1m: 1, outputPer1m: 4, currency: 'EUR' });
        expect(first.cost).toBeCloseTo(0.018);
        const second = addUsage(first, request, { inputPer1m: 2, outputPer1m: 8, currency: 'EUR' });
        expect(second).toMatchObject({ inputTokens: 20_000, outputTokens: 4_000, requests: 2, currency: 'EUR', costComplete: true });
        expect(second.cost).toBeCloseTo(0.018 + 0.036);
    });

    it('marks the cost as a lower bound when a model has no prices', () => {
        const total = addUsage(addUsage(EMPTY_USAGE, request, { inputPer1m: 1, outputPer1m: 4 }), request);
        expect(total.costComplete).toBe(false);
        expect(total.requests).toBe(2);
    });
});

describe('formatting', () => {
    it('shortens token counts', () => {
        expect([950, 1200, 12_400, 1_250_000].map(formatTokens)).toEqual(['950', '1.2k', '12.4k', '1.25M']);
    });

    it('formats cost with a currency symbol and enough digits', () => {
        expect(formatCost(0.0312, 'EUR')).toBe('€0.03');
        expect(formatCost(0.0042, 'USD')).toBe('$0.0042');
        expect(formatCost(1.5, 'CHF')).toBe('1.50 CHF');
    });

    it('writes one summary line', () => {
        const total = addUsage(EMPTY_USAGE, { inputTokens: 12_400, outputTokens: 1_200, cachedTokens: 0, estimated: false }, { inputPer1m: 1, outputPer1m: 4, currency: 'EUR' });
        expect(usageSummary(total)).toBe('12.4k in · 1.2k out · €0.02');
        expect(usageSummary(EMPTY_USAGE)).toBeUndefined();
    });
});
