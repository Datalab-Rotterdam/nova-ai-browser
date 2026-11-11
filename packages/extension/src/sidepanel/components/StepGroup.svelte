<script lang="ts">
    /**
     * Consecutive steps (thinking, tool calls) of an answer, folded into one line that says what
     * Nova is doing, or did; it opens to the separate steps. Ported from nova-ai-vscode's
     * webview/src/chat/StepGroup.svelte.
     */
    import { isStepActive, stepsLine, type ConversationEntry } from '../steps';
    import ThinkingStep from './ThinkingStep.svelte';
    import ToolCard from './ToolCard.svelte';

    interface Props {
        group: Extract<ConversationEntry, { kind: 'group' }>;
        /** Nova is working on a step of this group. */
        running: boolean;
    }

    let { group, running }: Props = $props();

    let open = $state(false);
    const failed = $derived(group.failed > 0);
    const line = $derived(stepsLine(group.steps, running));
    const count = $derived(`${group.steps.length} ${group.steps.length === 1 ? 'step' : 'steps'}`);
</script>

<div class="group" class:failed>
    <button class="summary" aria-expanded={open} aria-label={`${line} (${count})`} onclick={() => (open = !open)}>
        <span class="status" aria-hidden="true">
            {#if running}<span class="codicon codicon-loading codicon-modifier-spin"></span>
            {:else if failed}<span class="codicon codicon-warning"></span>
            {:else}<span class="codicon codicon-check"></span>{/if}
        </span>
        <span class="line" class:working={running}>{line}</span>
        <span class="count">{count}</span>
        <span class={`codicon codicon-chevron-${open ? 'up' : 'down'} chevron`} aria-hidden="true"></span>
    </button>
    {#if open}
        <div class="body">
            {#each group.steps as step (step.id)}
                {#if step.kind === 'thinking'}
                    <ThinkingStep text={step.text} durationMs={step.durationMs} running={running && isStepActive(step)} />
                {:else}
                    <ToolCard name={step.call.name} args={step.call.args} result={step.result} />
                {/if}
            {/each}
        </div>
    {/if}
</div>

<style lang="scss">
  .group {
    min-width: 0;
  }

  .summary {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    min-width: 0;
    padding: 2px 0;
    border: 0;
    background: none;
    color: var(--nova-muted);
    font: inherit;
    font-size: 0.92em;
    text-align: left;
    cursor: pointer;

    &:hover,
    &:focus-visible {
      color: var(--nova-fg);
    }

    &:focus-visible {
      outline: 1px solid var(--nova-focus);
      outline-offset: 1px;
    }
  }

  .status {
    display: grid;
    place-items: center;
    width: 16px;
    flex: none;
    color: var(--nova-success);

    .group.failed & {
      color: var(--nova-warning);
    }
  }

  .line {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .count {
    flex: none;
    padding: 0 6px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--nova-fg) 8%, transparent);
    font-size: 0.85em;
  }

  .chevron {
    flex: none;
    margin-left: auto;
    opacity: 0;
  }

  .summary:hover .chevron,
  .summary:focus-visible .chevron,
  .summary[aria-expanded='true'] .chevron {
    opacity: 1;
  }

  .body {
    display: grid;
    gap: 6px;
    margin: 4px 0 6px 6px;
    padding: 2px 0 2px 12px;
    border-left: 2px solid var(--nova-subtle-border);
  }

  /* A light sweep over the label while Nova works. */
  .working {
    background: linear-gradient(
        90deg,
        var(--nova-muted) 0%,
        var(--nova-muted) 40%,
        var(--nova-fg) 50%,
        var(--nova-muted) 60%,
        var(--nova-muted) 100%
    );
    background-size: 200% 100%;
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    animation: nova-shimmer 1.8s linear infinite;
  }

  @media (prefers-reduced-motion: reduce) {
    .working {
      background: none;
      color: inherit;
    }
  }

  @media (forced-colors: active) {
    .working {
      background: none;
      color: CanvasText;
    }

    .count {
      border: 1px solid CanvasText;
    }
  }
</style>
