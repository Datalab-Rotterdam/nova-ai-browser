<script lang="ts">
    import { usageSummary, formatTokens, type Usage } from '@datalabrotterdam/nova-ai-browser-protocol';

    let { usage }: { usage: Usage } = $props();

    const summary = $derived(usageSummary(usage));
    const detail = $derived([
        `${usage.requests} model ${usage.requests === 1 ? 'request' : 'requests'} in this chat`,
        usage.cachedTokens ? `${formatTokens(usage.cachedTokens)} input tokens came from the server's cache` : '',
        usage.estimated ? 'Some counts are estimated by the server' : '',
        usage.cost > 0 && !usage.costComplete ? 'Some requests used a model without a price, so the cost is a lower bound' : '',
        usage.cost === 0 && usage.requests ? 'This model has no price in the model list' : ''
    ].filter(Boolean).join('\n'));
</script>

{#if summary}
    <p class="usage" title={detail}><span class="codicon codicon-pulse" aria-hidden="true"></span>{summary}</p>
{/if}

<style lang="scss">
  .usage {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0;
    padding: 2px 12px;
    color: var(--nova-muted);
    font-size: 0.85em;
  }
</style>
