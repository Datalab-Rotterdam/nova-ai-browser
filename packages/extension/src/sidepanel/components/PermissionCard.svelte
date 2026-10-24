<script lang="ts">
    // Styled like a tool card awaiting approval in nova-ai-vscode.
    interface Props {
        subject: 'site' | 'agent';
        /** The site's origin or the agent's name. */
        target: string;
        /** External agent behind a site request, if any. */
        agent?: string;
        summary: string;
        answered?: string;
        onanswer: (decision: 'once' | 'always' | 'deny') => void;
    }

    let { subject, target, agent, summary, answered, onanswer }: Props = $props();
</script>

<div class="tool" class:awaiting={!answered} role="group" aria-label={subject === 'agent' ? `${target} wants to use the browser` : `Permission for ${target}`}>
    <div class="summary">
        <span class={`codicon codicon-${answered ? 'pass' : subject === 'agent' ? 'plug' : 'shield'} status-icon`} aria-hidden="true"></span>
        {#if subject === 'agent'}
            <span class="title"><strong>{target}</strong> wants to use your browser</span>
        {:else}
            <span class="title">{agent ? `${agent}: use` : 'Use'} <strong>{target}</strong>?</span>
        {/if}
    </div>
    <div class="approval">
        {#if subject === 'agent'}
            <p class="explain">It can then open tabs in the Nova group and read and use pages there. Each new site still needs your OK, and Stop always works.</p>
            <code class="command">First request: {summary}</code>
        {:else}
            <code class="command">{summary}</code>
        {/if}
        {#if answered}
            <p class="answered">{answered}</p>
        {:else}
            <div class="buttons">
                <button class="nova-button" onclick={() => onanswer('once')}>Allow</button>
                <button class="nova-button secondary" onclick={() => onanswer('always')} title={subject === 'agent' ? `Always allow ${target}` : `Always allow Nova on ${target}`}>Always allow</button>
                <button class="nova-button secondary" onclick={() => onanswer('deny')}>Deny</button>
            </div>
            <p class="hint">{subject === 'agent' ? '"Allow" lasts until the browser closes.' : '"Allow" lasts until this task ends.'}</p>
        {/if}
    </div>
</div>

<style lang="scss">
  .tool {
    border: 1px solid var(--nova-subtle-border);
    border-radius: var(--nova-radius-large);
    background: var(--nova-surface);

    &.awaiting {
      border-color: var(--nova-focus);
    }
  }

  .summary {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
  }

  .title {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .status-icon {
    flex: none;
    color: var(--nova-muted);
  }

  .awaiting .status-icon {
    color: var(--nova-focus);
  }

  .approval {
    display: grid;
    gap: 8px;
    padding: 2px 8px 8px;
  }

  .explain {
    color: var(--nova-fg);
  }

  .command {
    display: block;
    padding: 4px 6px;
    border-radius: var(--nova-radius);
    background: var(--nova-input-bg);
    font-family: var(--nova-mono);
    font-size: 0.92em;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }

  .buttons {
    display: flex;
    gap: 6px;

    .nova-button {
      width: auto;
      flex: 1 1 auto;
      padding: 2px 8px;
    }
  }

  .answered,
  .hint {
    color: var(--nova-muted);
    font-size: 0.92em;
  }
</style>
