<script lang="ts">
    import { modelCapabilities } from '@datalabrotterdam/nova-ai-browser-protocol';
    import type { ModelResponse } from '@datalabrotterdam/nova-sdk';
    import { DEFAULT_BASE_URL, PERMISSION_OPTIONS, saveSettings, type Settings } from '../../lib/settings';
    import { DEV_TOOLS } from '../../lib/build';
    import { Card, Input } from '$lib/client-lib/components';
    import ExternalAgents from './ExternalAgents.svelte';

    interface Props {
        settings: Settings;
        models: ModelResponse[];
        modelsError?: string;
        onreloadmodels: () => void;
        /** Which page of the settings to show. */
        page: 'general' | 'permissions' | 'agents' | 'advanced';
    }

    let { settings, models, modelsError, onreloadmodels, page }: Props = $props();
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
        const notes = [caps.imageInput ? 'can see pages' : '', caps.toolCalling ? '' : 'cannot use the browser'].filter(Boolean).join(', ');
        return `${model.name ?? model.id}${notes ? ` (${notes})` : ''}`;
    }

    const VISION_OPTIONS: Array<{ value: Settings['vision']; label: string; hint: string }> = [
        { value: 'auto', label: 'Automatic', hint: 'Screenshots when the model can see images, otherwise text.' },
        { value: 'on', label: 'Screenshots', hint: 'Nova looks at the page like you do.' },
        { value: 'off', label: 'Text only', hint: 'Nova reads the page text. Faster, but misses images and layout.' }
    ];

    const modelOptions = $derived(models.map((model) => ({ value: model.id, label: label(model) })));
    const siteEntries = $derived(Object.entries(sites).sort(([a], [b]) => a.localeCompare(b)));
</script>

<div class="settings">
    {#if page === 'general'}
        <Card title="Model" description="The AI that runs Nova. You can also switch it under the message box.">
<div class="body">
            <div class="row">
                <div class="grow">
                    <Input type="select" name="model" label="Model" value={settings.model} options={modelOptions} placeholder={models.length ? 'Pick a model' : 'No models loaded'}
                           disabled={!models.length} onchange={(e: Event) => saveSettings({ model: (e.currentTarget as HTMLSelectElement).value })} />
                </div>
                <button class="nova-icon-button codicon codicon-refresh" onclick={onreloadmodels} title="Reload models" aria-label="Reload models"></button>
            </div>
            {#if modelsError}
                <p class="error"><span class="codicon codicon-error" aria-hidden="true"></span>{modelsError}</p>
            {/if}
        </div>
</Card>

        <Card title="Mode" description="Ask mode lets Nova read pages and answer questions, but never click, type or change anything.">
            <div class="body">
                <Input type="checkbox" name="read-only" label="Read-only (Ask) mode" value={settings.readOnly}
                       onchange={(e: Event) => saveSettings({ readOnly: (e.currentTarget as HTMLInputElement).checked })} />
            </div>
        </Card>

        <Card title="Reading pages" description="How Nova looks at a page.">
<div class="body">
            <fieldset class="choices">
                <legend class="sr-only">How Nova looks at a page</legend>
                {#each VISION_OPTIONS as option (option.value)}
                    <label class="choice">
                        <input type="radio" name="vision" value={option.value} checked={settings.vision === option.value}
                               onchange={() => saveSettings({ vision: option.value })} />
                        <span class="text">
                            <span class="name">{option.label}</span>
                            <span class="hint">{option.hint}</span>
                        </span>
                    </label>
                {/each}
            </fieldset>
        </div>
</Card>
    {:else if page === 'permissions'}
        <Card title="Websites" description="Before Nova uses a website.">
<div class="body">
            <fieldset class="choices">
                <legend class="sr-only">Before Nova uses a website</legend>
                {#each PERMISSION_OPTIONS as option (option.mode)}
                    <label class="choice" class:warn={option.mode === 'autoAll'}>
                        <input type="radio" name="approval-mode" value={option.mode} checked={settings.approvalMode === option.mode}
                               onchange={() => saveSettings({ approvalMode: option.mode })} />
                        <span class={`codicon codicon-${option.icon}`} aria-hidden="true"></span>
                        <span class="text">
                            <span class="name">{option.label}</span>
                            <span class="hint">{option.description}</span>
                        </span>
                    </label>
                {/each}
            </fieldset>
        </div>
</Card>

        <Card title="Remembered websites" description="Websites you allowed or blocked for Nova.">
<div class="body">
            {#if siteEntries.length === 0}
                <p class="empty">None yet. Pick "Always allow" when Nova asks, and the website shows up here.</p>
            {:else}
                <ul class="sites">
                    {#each siteEntries as [origin, decision] (origin)}
                        <li>
                            <span class={`codicon codicon-${decision === 'always' ? 'pass' : 'circle-slash'}`} class:allowed={decision === 'always'} class:blocked={decision !== 'always'} aria-hidden="true"></span>
                            <span class="origin" title={origin}>{origin}</span>
                            <span class="badge">{decision === 'always' ? 'Allowed' : 'Blocked'}</span>
                            <button class="nova-icon-button codicon codicon-close" onclick={() => removeSite(origin)} title="Forget: ask again next time" aria-label={`Forget ${origin}`}></button>
                        </li>
                    {/each}
                </ul>
            {/if}
        </div>
</Card>
    {:else if page === 'agents'}
        <ExternalAgents {settings} />
    {:else}
        <Card title="Advanced">
<div class="body">
            <Input type="checkbox" name="allow-javascript" label="Let Nova run scripts on pages" description="Lets Nova do things clicking and typing cannot. Only turn this on if you trust the websites Nova visits." value={settings.allowJavascript}
                   onchange={(e: Event) => saveSettings({ allowJavascript: (e.currentTarget as HTMLInputElement).checked })} />

            <Input type="checkbox" name="show-cursor" label="Show Nova's cursor in screenshots" value={settings.showCursorInScreenshots}
                   onchange={(e: Event) => saveSettings({ showCursorInScreenshots: (e.currentTarget as HTMLInputElement).checked })} />

            <Input type="number" name="max-rounds" label="Steps per message" description="Nova pauses after this many actions. Say &quot;continue&quot; to let it go on." min="1" max="200" value={settings.maxRounds}
                   onchange={(e: Event) => saveSettings({ maxRounds: Math.max(1, Number((e.currentTarget as HTMLInputElement).value) || 40) })} />

            <Input type="text" name="base-url" label="Server address" description="Only change this if your organization runs its own Nova server." value={settings.baseUrl}
                   onchange={(e: Event) => saveSettings({ baseUrl: (e.currentTarget as HTMLInputElement).value.trim() || DEFAULT_BASE_URL })} />
        </div>
</Card>

        {#if DEV_TOOLS}
            <Card title="Developer" description="For working on Nova itself. Not part of the Chrome Web Store version.">
                <div class="body">
                    <Input type="checkbox" name="developer-tools" label="Show the tool tester in the side panel" description="Adds a button to the side panel for running browser tools by hand, without a model." value={settings.developerTools}
                           onchange={(e: Event) => saveSettings({ developerTools: (e.currentTarget as HTMLInputElement).checked })} />
                </div>
            </Card>
        {/if}
    {/if}
</div>

<style lang="scss">
  .body {
    display: grid;
    gap: 8px;
  }

  .settings {
    display: grid;
    gap: 16px;
  }

  .empty {
    color: var(--nova-muted);
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }

  .narrow {
    max-width: 120px;
  }

  label {
    margin-top: 6px;
  }

  p {
    margin: 0;
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

  /* Hints under a checkbox line up with its text. */
  .indent {
    padding-left: 21px;
  }

  fieldset {
    margin: 0;
    padding: 0;
    border: 0;
  }

  legend {
    margin-bottom: 2px;
    padding: 0;
  }

  .choices {
    display: grid;
    gap: 2px;
  }

  .choice {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin: 0;
    padding: 6px 8px;
    border: 1px solid transparent;
    border-radius: var(--nova-radius);
    cursor: pointer;

    &:hover {
      background: var(--nova-hover);
    }

    &:has(input:checked) {
      border-color: var(--nova-subtle-border, var(--nova-border));
      background: var(--nova-hover);
    }

    input {
      margin: 2px 0 0;
      accent-color: var(--nova-button-bg);
    }

    .codicon {
      margin-top: 1px;
      color: var(--nova-muted);
    }

    &.warn .codicon {
      color: var(--nova-warning);
    }
  }

  .text {
    display: grid;
    flex: 1;
    min-width: 0;
    gap: 1px;
  }

  .name {
    font-weight: 600;
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
    font-size: 0.92em;
  }

  .sub {
    margin-top: 8px;
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

  details[open] {
    display: grid;
    gap: 6px;
  }

  summary {
    color: var(--nova-muted);
    font-size: 0.85em;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    cursor: pointer;

    &:hover {
      color: var(--nova-fg);
    }
  }

  .link-row {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    margin-top: 4px;
    padding: 6px 8px;
    border: 1px solid var(--nova-subtle-border, var(--nova-border));
    border-radius: var(--nova-radius);
    background: transparent;
    color: var(--nova-fg);
    font: inherit;
    text-align: left;
    cursor: pointer;

    &:hover,
    &:focus-visible {
      background: var(--nova-hover);
    }

    > .codicon {
      color: var(--nova-muted);
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

    .allowed {
      color: var(--nova-success);
    }

    .blocked {
      color: var(--nova-error);
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

  @media (forced-colors: active) {
    .choice:has(input:checked) {
      border-color: Highlight;
    }
  }
</style>
