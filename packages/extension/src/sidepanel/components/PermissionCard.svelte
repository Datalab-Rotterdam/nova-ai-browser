<script lang="ts">
    // Styled like a tool card awaiting approval in nova-ai-vscode.
    interface Props {
        subject: 'site' | 'agent' | 'upload' | 'action';
        /** The site's origin or the agent's name. */
        target: string;
        /** External agent behind a site request, if any. */
        agent?: string;
        /** Upload prompts: the absolute paths of the files. */
        files?: string[];
        summary: string;
        answered?: string;
        onanswer: (decision: 'once' | 'always' | 'deny') => void;
    }

    let { subject, target, agent, files = [], summary, answered, onanswer }: Props = $props();
</script>

<div class="tool" class:awaiting={!answered} role="group" aria-label={subject === 'agent' ? `${target} wants to use the browser` : subject === 'upload' ? `Upload files to ${target}?` : subject === 'action' ? `Confirm action on ${target}` : `Permission for ${target}`}>
    <div class="summary">
        <span class={`codicon codicon-${answered ? 'pass' : subject === 'agent' ? 'plug' : subject === 'upload' ? 'cloud-upload' : subject === 'action' ? 'warning' : 'shield'} status-icon`} aria-hidden="true"></span>
        {#if subject === 'agent'}
            <span class="title"><strong>{target}</strong> wants to use your browser</span>
        {:else if subject === 'upload'}
            <span class="title">{agent ? `${agent}: upload` : 'Upload'} {files.length === 1 ? 'this file' : `${files.length} files`} to <strong>{target}</strong>?</span>
        {:else if subject === 'action'}
            <span class="title">{agent ? `${agent}: ` : ''}Allow this on <strong>{target}</strong>?</span>
        {:else}
            <span class="title">{agent ? `${agent}: use` : 'Use'} <strong>{target}</strong>?</span>
        {/if}
    </div>
    <div class="approval">
        {#if subject === 'agent'}
            <p class="explain">It can then open tabs in the Nova group and read and use pages there. Each new site still needs your OK, and Stop always works.</p>
            <code class="command">First request: {summary}</code>
        {:else if subject === 'upload'}
            <p class="explain">The site gets a copy of {files.length === 1 ? 'this file' : 'these files'}. Only allow files you meant to send.</p>
            <code class="command">{files.join('\n')}</code>
        {:else if subject === 'action'}
            <p class="explain">This may not be possible to undo, such as paying, sending or deleting.</p>
            <code class="command">{summary}</code>
        {:else}
            <code class="command">{summary}</code>
        {/if}
        {#if answered}
            <p class="answered">{answered}</p>
        {:else}
            <div class="buttons">
                <button class="nova-button" onclick={() => onanswer('once')}>Allow</button>
                {#if subject !== 'upload' && subject !== 'action'}
                    <button class="nova-button secondary" onclick={() => onanswer('always')} title={subject === 'agent' ? `Always allow ${target}` : `Always allow Nova on ${target}`}>Always allow</button>
                {/if}
                <button class="nova-button secondary" onclick={() => onanswer('deny')}>Deny</button>
            </div>
            <p class="hint">{subject === 'agent' ? '"Allow" lasts until the browser closes.' : subject === 'upload' ? 'Nova asks again for every upload.' : subject === 'action' ? 'Nova asks again every time.' : '"Allow" lasts until this task ends.'}</p>
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
