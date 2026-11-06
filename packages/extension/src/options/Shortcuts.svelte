<script lang="ts">
    import { onDestroy } from 'svelte';
    import { describeSchedule, NO_SCHEDULE, shortcutProblem, slugifyName, type Schedule, type ScheduleKind, type Shortcut } from '@datalabrotterdam/nova-ai-browser-protocol';
    import { Card, Input } from '$lib/client-lib/components';
    import Button from '$lib/client-lib/components/actions/Button.svelte';
    import { saveSettings, type Settings } from '../lib/settings';
    import { loadShortcuts, onShortcutsChanged, runShortcutWindow, saveShortcuts } from '../lib/shortcuts';

    let { settings }: { settings: Settings } = $props();

    let shortcuts = $state<Shortcut[]>([]);
    void loadShortcuts().then((list) => (shortcuts = list));
    const stop = onShortcutsChanged((list) => (shortcuts = list));
    onDestroy(stop);

    const KINDS: Array<{ value: ScheduleKind; label: string }> = [
        { value: 'off', label: 'Not scheduled' },
        { value: 'hourly', label: 'Every hour' },
        { value: 'daily', label: 'Every day' },
        { value: 'weekly', label: 'Every week' }
    ];
    const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((label, index) => ({ value: String(index), label }));

    interface Draft {
        id: string;
        name: string;
        prompt: string;
        startUrl: string;
        schedule: Schedule;
    }

    let draft = $state<Draft | undefined>();
    let problem = $state<string | undefined>();
    let editing = $state(false);

    function create() {
        draft = { id: crypto.randomUUID(), name: '', prompt: '', startUrl: '', schedule: { ...NO_SCHEDULE } };
        editing = false;
        problem = undefined;
    }

    function edit(shortcut: Shortcut) {
        draft = { id: shortcut.id, name: shortcut.name, prompt: shortcut.prompt, startUrl: shortcut.startUrl ?? '', schedule: { ...shortcut.schedule } };
        editing = true;
        problem = undefined;
    }

    async function save() {
        if (!draft) return;
        const next: Shortcut = {
            id: draft.id,
            name: slugifyName(draft.name),
            prompt: draft.prompt.trim(),
            ...(draft.startUrl.trim() ? { startUrl: draft.startUrl.trim() } : {}),
            schedule: draft.schedule
        };
        problem = shortcutProblem(next, shortcuts, next.id);
        if (problem) return;
        await saveShortcuts(editing ? shortcuts.map((shortcut) => (shortcut.id === next.id ? next : shortcut)) : [...shortcuts, next]);
        draft = undefined;
    }

    async function remove(shortcut: Shortcut) {
        await saveShortcuts(shortcuts.filter((other) => other.id !== shortcut.id));
    }

    const sorted = $derived([...shortcuts].sort((a, b) => a.name.localeCompare(b.name)));
</script>

<Card title="Shortcuts" description="Save a prompt, then run it by typing /name in the Nova panel, or on a schedule.">
    <div class="body">
        {#if !draft}
            <div class="head">
                <Button variant="primary" onclick={create}><i class="bi bi-plus-lg" style="margin-right: 8px"></i>Create shortcut</Button>
            </div>
        {/if}

        {#if sorted.length === 0 && !draft}
            <p class="empty">No shortcuts yet. For example <code>/morning-news</code>: "Open nos.nl and summarize the top five stories".</p>
        {/if}

        {#if sorted.length}
            <ul class="list">
                {#each sorted as shortcut (shortcut.id)}
                    <li>
                        <div class="info">
                            <strong>/{shortcut.name}</strong>
                            <span class="muted">{describeSchedule(shortcut.schedule)}{shortcut.startUrl ? ` · ${shortcut.startUrl}` : ''}</span>
                            <span class="prompt" title={shortcut.prompt}>{shortcut.prompt}</span>
                        </div>
                        <div class="actions">
                            <button class="icon" onclick={() => runShortcutWindow(shortcut.id)} title="Run now" aria-label={`Run /${shortcut.name} now`}><i class="bi bi-play-fill"></i></button>
                            <button class="icon" onclick={() => edit(shortcut)} title="Edit" aria-label={`Edit /${shortcut.name}`}><i class="bi bi-pencil"></i></button>
                            <button class="icon" onclick={() => remove(shortcut)} title="Delete" aria-label={`Delete /${shortcut.name}`}><i class="bi bi-trash"></i></button>
                        </div>
                    </li>
                {/each}
            </ul>
        {/if}
    </div>
</Card>

{#if draft}
    <Card title={editing ? 'Edit shortcut' : 'Create shortcut'}>
        <div class="body">
            <Input type="text" name="shortcut-name" label="Name" description="Typed as /name in the panel." placeholder="morning-news" value={draft.name}
                   oninput={(e: Event) => draft && (draft.name = (e.currentTarget as HTMLInputElement).value)} />
            <Input type="textarea" name="shortcut-prompt" label="Prompt" placeholder="What should Nova do?" rows={4} value={draft.prompt}
                   oninput={(e: Event) => draft && (draft.prompt = (e.currentTarget as HTMLTextAreaElement).value)} />
            <Input type="text" name="shortcut-start" label="Start from" description="Optional: a page Nova opens first." placeholder="https://example.com" value={draft.startUrl}
                   oninput={(e: Event) => draft && (draft.startUrl = (e.currentTarget as HTMLInputElement).value)} />
            <div class="schedule">
                <Input type="select" name="shortcut-schedule" label="Schedule" value={draft.schedule.kind} options={KINDS}
                       onchange={(e: Event) => draft && (draft.schedule.kind = (e.currentTarget as HTMLSelectElement).value as ScheduleKind)} />
                {#if draft.schedule.kind === 'weekly'}
                    <Input type="select" name="shortcut-weekday" label="Day" value={String(draft.schedule.weekday)} options={DAYS}
                           onchange={(e: Event) => draft && (draft.schedule.weekday = Number((e.currentTarget as HTMLSelectElement).value))} />
                {/if}
                {#if draft.schedule.kind !== 'off'}
                    <Input type="time" name="shortcut-time" label={draft.schedule.kind === 'hourly' ? 'Minute past the hour' : 'Time'} value={draft.schedule.time}
                           onchange={(e: Event) => draft && (draft.schedule.time = (e.currentTarget as HTMLInputElement).value)} />
                {/if}
            </div>
            {#if draft.schedule.kind !== 'off'}
                <p class="hint">Scheduled runs open a small Nova window and ask for permissions as usual. They only run while the browser is open, and are skipped when Nova is busy.</p>
            {/if}
            {#if problem}<p class="error"><i class="bi bi-exclamation-circle" aria-hidden="true"></i> {problem}</p>{/if}
            <div class="head">
                <Button variant="primary" onclick={save}>Save</Button>
                <Button variant="default" onclick={() => (draft = undefined)}>Cancel</Button>
            </div>
        </div>
    </Card>
{/if}

<Card title="Notifications" description="Get notified when a scheduled task is done.">
    <div class="body">
        <Input type="checkbox" name="task-notifications" label="Task completion notifications" value={settings.taskNotifications}
               onchange={(e: Event) => saveSettings({ taskNotifications: (e.currentTarget as HTMLInputElement).checked })} />
    </div>
</Card>

<style lang="scss">
  .body {
    display: grid;
    gap: 12px;
  }

  .head {
    display: flex;
    gap: 8px;
  }

  .list {
    display: grid;
    gap: 8px;
    margin: 0;
    padding: 0;
    list-style: none;

    li {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 10px 12px;
      border: 1px solid var(--color-border-primary);
      border-radius: 8px;
    }
  }

  .info {
    display: grid;
    min-width: 0;
    gap: 2px;
  }

  .muted,
  .empty,
  .hint {
    margin: 0;
    color: var(--color-text-muted);
  }

  .prompt {
    overflow: hidden;
    color: var(--color-text-secondary);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .actions {
    display: flex;
    gap: 4px;
  }

  .icon {
    padding: 6px 8px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--color-text-secondary);
    cursor: pointer;

    &:hover {
      background: var(--color-primary-soft);
      color: var(--color-text-primary);
    }
  }

  .schedule {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }

  .error {
    display: flex;
    gap: 6px;
    margin: 0;
    padding: 6px 8px;
    border: 1px solid var(--nova-error-border, var(--color-danger));
    border-radius: 4px;
    background: var(--nova-error-bg, transparent);
  }
</style>
