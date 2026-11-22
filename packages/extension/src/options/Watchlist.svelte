<script lang="ts">
    import { onMount } from 'svelte';
    import { Card } from '$lib/client-lib/components';
    import Button from '$lib/client-lib/components/actions/Button.svelte';
    import { saveSettings } from '../lib/settings';
    import { loadWatches, onWatchesChanged, type PageWatch, type WatchRequest, type WatchResponse } from '../lib/watches';

    let { notifications }: { notifications: boolean } = $props();
    let watches = $state<PageWatch[] | undefined>();
    let problem = $state(new URL(location.href).searchParams.get('watchError') ?? '');
    let pending = $state<Record<string, boolean>>({});
    const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

    onMount(() => {
        let revision = 0;
        async function refresh() {
            const request = ++revision;
            try {
                const next = await loadWatches();
                if (request === revision) watches = next;
            } catch {
                if (request === revision) problem = 'Nova could not load the watchlist.';
            }
        }
        const stop = onWatchesChanged(refresh);
        void refresh();
        return stop;
    });

    async function update(type: WatchRequest['type'], id: string) {
        pending[id] = true;
        problem = '';
        try {
            const result: WatchResponse = await chrome.runtime.sendMessage({ type, id } satisfies WatchRequest);
            if (!result.ok) problem = result.error;
        } catch {
            problem = 'Nova could not update this watch. Try again.';
        } finally {
            delete pending[id];
        }
    }

    async function setNotifications(enabled: boolean) {
        try {
            await saveSettings({ watchNotifications: enabled });
        } catch {
            problem = 'Nova could not save your notification preference.';
        }
    }
</script>

{#snippet changeTime(at: number)}
    <time class="muted" datetime={new Date(at).toISOString()}>{dateTime.format(at)}</time>
{/snippet}

{#snippet changedLines(label: string, lines: string[], count: number)}
    {#if count}
        <strong>{label} ({count})</strong>
        <ul class="changed-lines">
            {#each lines as line, index (index)}<li>{line}</li>{/each}
            {#if count > lines.length}<li class="muted">{count - lines.length} more</li>{/if}
        </ul>
    {/if}
{/snippet}

{#if problem}<p class="error" role="alert">{problem}</p>{/if}

<label class="notifications">
    <input type="checkbox" checked={notifications} onchange={(event) => setNotifications(event.currentTarget.checked)} />
    Notify me when watched content changes
</label>

{#if watches?.length === 0}
    <Card title="No pages watched yet" description="Right-click a web page and choose Watch this page to track its main content. To track a specific value, select it first and choose Watch selected text." />
{:else if watches}
    {#each watches as watch (watch.id)}
        <Card title={watch.title}>
            <div class="watch">
                <a href={watch.url} target="_blank" rel="noopener noreferrer">Open source page <i class="bi bi-box-arrow-up-right" aria-hidden="true"></i></a>
                {#if watch.kind === 'page'}
                    <div class="muted">Watching page content</div>
                {:else}
                    <div>
                        <div class="muted">Watching selected text</div>
                        <div class="value">{watch.value}</div>
                    </div>
                {/if}
                <div class="muted">
                    {#if watch.checkedAt}
                        Last checked <time datetime={new Date(watch.checkedAt).toISOString()}>{dateTime.format(watch.checkedAt)}</time>
                    {:else}
                        Waiting for first check
                    {/if}
                </div>
                {#if watch.error}<p class="error" role="status">{watch.error}</p>{/if}
                {#if watch.changes.length}
                    <details>
                        <summary>Change history ({watch.changes.length})</summary>
                        <ul class="history">
                            {#if watch.kind === 'page'}
                                {#each watch.changes as change, index (index)}
                                    <li>
                                        {@render changeTime(change.at)}
                                        {@render changedLines('Added', change.added, change.addedCount)}
                                        {@render changedLines('Removed', change.removed, change.removedCount)}
                                    </li>
                                {/each}
                            {:else}
                                {#each watch.changes as change, index (index)}
                                    <li>
                                        {@render changeTime(change.at)}
                                        <span>From {change.previous}</span>
                                        <span>To {change.current}</span>
                                    </li>
                                {/each}
                            {/if}
                        </ul>
                    </details>
                {/if}
                <div class="actions">
                    <Button variant="default" disabled={pending[watch.id]} onclick={() => update('watch/check', watch.id)}>
                        {pending[watch.id] ? 'Working…' : 'Check now'}
                    </Button>
                    <Button variant="transparent" disabled={pending[watch.id]} onclick={() => update('watch/delete', watch.id)}>Remove watch</Button>
                </div>
            </div>
        </Card>
    {/each}
{/if}

<style lang="scss">
    .watch {
        display: grid;
        justify-items: start;
        gap: 12px;
        overflow-wrap: anywhere;
    }

    .value { font-weight: 600; }
    .muted { color: var(--color-text-secondary); }
    .error { color: var(--color-danger); margin: 0; }
    summary { cursor: pointer; }

    .notifications {
        display: flex;
        align-items: center;
        gap: 8px;
    }

    ul {
        display: grid;
        gap: 8px;
        margin: 8px 0 0;
        padding-left: 20px;
    }

    .history > li > * { display: block; }
    .changed-lines { margin-top: 4px; }
    .history strong { margin-top: 8px; }

    .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
    }
</style>
