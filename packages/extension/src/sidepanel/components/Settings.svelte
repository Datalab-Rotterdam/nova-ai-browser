<script lang="ts">
    import { modelCapabilities } from '@datalabrotterdam/nova-ai-browser-protocol';
    import type { ModelResponse } from '@datalabrotterdam/nova-sdk';
    import { DEFAULT_BASE_URL, saveSettings, type Settings } from '../../lib/settings';
    import ExternalAgents from './ExternalAgents.svelte';

    interface Props {
        settings: Settings;
        models: ModelResponse[];
        modelsError?: string;
        onreloadmodels: () => void;
        onsignout: () => void;
    }

    let { settings, models, modelsError, onreloadmodels, onsignout }: Props = $props();
    let sites = $state<Record<string, string>>({});

    async function loadSites() {
        sites = ((await chrome.storage.local.get('sitePermissions')).sitePermissions ?? {}) as Record<string, string>;
    }
    void loadSites();

    async function removeSite(origin: string) {
        const next = { ...sites };
        delete next[origin];
        await chrome.storage.local.set({ sitePermissions: next });
        sites = next;
    }

    function label(model: ModelResponse): string {
        const caps = modelCapabilities(model);
        const tags = [caps.imageInput ? 'vision' : '', caps.toolCalling ? 'tools' : ''].filter(Boolean).join(', ');
        return `${model.name ?? model.id}${tags ? ` — ${tags}` : ''}`;
    }

    const keyPreview = $derived(settings.apiKey ? `${settings.apiKey.slice(0, 7)}…${settings.apiKey.slice(-4)}` : '');
</script>

<div class="settings">
    <section>
        <h2>Account</h2>
        <div class="row account">
            <span class="codicon codicon-pass status" aria-hidden="true"></span>
            <span class="grow">Connected <code>{keyPreview}</code></span>
            <button class="nova-button secondary inline" onclick={onsignout}>Sign out</button>
        </div>

        <label for="model">Model</label>
        <div class="row">
            <select id="model" class="nova-input" value={settings.model} onchange={(e) => saveSettings({ model: e.currentTarget.value })} disabled={!models.length}>
                <option value="" disabled selected={!settings.model}>{models.length ? 'Pick a model' : 'No models loaded'}</option>
                {#each models as model (model.id)}
                    <option value={model.id} selected={model.id === settings.model}>{label(model)}</option>
                {/each}
            </select>
            <button class="nova-icon-button codicon codicon-refresh" onclick={onreloadmodels} title="Reload models" aria-label="Reload models"></button>
        </div>
        {#if modelsError}
            <p class="error"><span class="codicon codicon-error" aria-hidden="true"></span>{modelsError}</p>
        {/if}
    </section>

    <section>
        <h2>Behavior</h2>
        <label for="vision">Screenshots</label>
        <select id="vision" class="nova-input" value={settings.vision} onchange={(e) => saveSettings({ vision: e.currentTarget.value as Settings['vision'] })}>
            <option value="auto">Automatic (when the model supports images)</option>
            <option value="on">Always send screenshots</option>
            <option value="off">Never (read pages as text)</option>
        </select>

        <label class="check">
            <input type="checkbox" checked={settings.askBeforeActing} onchange={(e) => saveSettings({ askBeforeActing: e.currentTarget.checked })} />
            <span>Ask before Nova uses a new site</span>
        </label>
        <label class="check">
            <input type="checkbox" checked={settings.showCursorInScreenshots} onchange={(e) => saveSettings({ showCursorInScreenshots: e.currentTarget.checked })} />
            <span>Show Nova's cursor in screenshots</span>
        </label>
        <label class="check">
            <input type="checkbox" checked={settings.allowJavascript} onchange={(e) => saveSettings({ allowJavascript: e.currentTarget.checked })} />
            <span>Allow Nova to run JavaScript in pages</span>
        </label>

        <details>
            <summary>Advanced</summary>
            <label for="base-url">API base URL</label>
            <input id="base-url" class="nova-input" type="text" value={settings.baseUrl}
                   onchange={(e) => saveSettings({ baseUrl: e.currentTarget.value.trim() || DEFAULT_BASE_URL })} />
            <label for="max-rounds">Max steps per message</label>
            <input id="max-rounds" class="nova-input" type="number" min="1" max="200" value={settings.maxRounds}
                   onchange={(e) => saveSettings({ maxRounds: Math.max(1, Number(e.currentTarget.value) || 40) })} />
        </details>
    </section>

    <ExternalAgents {settings} />

    <section>
        <h2>Site permissions</h2>
        {#if Object.keys(sites).length === 0}
            <p class="hint">No saved decisions. Choose "Always allow" when Nova asks to remember a site.</p>
        {:else}
            <ul class="sites">
                {#each Object.entries(sites) as [origin, decision] (origin)}
                    <li>
                        <span class={`codicon codicon-${decision === 'always' ? 'pass' : 'circle-slash'}`} aria-hidden="true"></span>
                        <span class="origin" title={origin}>{origin}</span>
                        <span class="badge">{decision === 'always' ? 'Allowed' : 'Blocked'}</span>
                        <button class="nova-icon-button codicon codicon-close" onclick={() => removeSite(origin)} title="Forget" aria-label={`Forget ${origin}`}></button>
                    </li>
                {/each}
            </ul>
        {/if}
    </section>
</div>

<style lang="scss">
  .settings {
    padding: 4px 12px 20px;
  }

  section {
    display: grid;
    gap: 6px;
    padding: 12px 0;
    border-bottom: 1px solid var(--nova-border);

    &:last-child {
      border-bottom: 0;
    }
  }

  h2 {
    margin: 0 0 2px;
    color: var(--nova-muted);
    font-size: 0.85em;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  label {
    margin-top: 6px;
  }

  .check {
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: center;
    gap: 8px;
    margin-top: 4px;

    input {
      margin: 0;
      accent-color: var(--nova-button-bg);
    }
  }

  .row {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .grow {
    flex: 1;
    min-width: 0;
  }

  .account .status {
    color: var(--nova-success);
  }

  .nova-button.inline {
    width: auto;
    padding: 2px 10px;
  }

  .hint {
    color: var(--nova-muted);
  }

  .error {
    display: flex;
    gap: 6px;
    padding: 6px 8px;
    border: 1px solid var(--nova-error-border);
    border-radius: 2px;
    background: var(--nova-error-bg);
    overflow-wrap: anywhere;

    .codicon {
      color: var(--nova-error);
    }
  }

  details {
    margin-top: 6px;

    &[open] {
      display: grid;
      gap: 6px;
    }
  }

  summary {
    color: var(--nova-muted);
    cursor: pointer;

    &:hover {
      color: var(--nova-fg);
    }
  }

  .sites {
    margin: 0;
    padding: 0;
    list-style: none;

    li {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 2px 0;
      color: var(--nova-muted);
    }
  }

  .origin {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    color: var(--nova-fg);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .badge {
    padding: 0 6px;
    border-radius: 10px;
    background: var(--nova-badge-bg);
    color: var(--nova-badge-fg);
    font-size: 0.85em;
  }
</style>
