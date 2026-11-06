<script lang="ts">
    import { thoughtFor } from '../steps';

    interface Props {
        text: string;
        durationMs?: number;
        /** The model is still thinking. */
        running: boolean;
    }

    let { text, durationMs, running }: Props = $props();
</script>

<details class="thinking">
    <summary>
        <span class="codicon codicon-lightbulb" aria-hidden="true"></span>
        {#if running && durationMs === undefined}Thinking{:else}{thoughtFor(durationMs ?? null)}{/if}
    </summary>
    <p>{text}</p>
</details>

<style lang="scss">
  .thinking {
    color: var(--nova-muted);

    summary {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      cursor: pointer;
    }

    p {
      margin-top: 4px;
      padding-left: 10px;
      border-left: 2px solid var(--nova-subtle-border);
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      font-size: 0.92em;
    }
  }
</style>
