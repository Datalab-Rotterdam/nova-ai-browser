/**
 * Scheduled tasks: a shortcut with a schedule runs in a popup window of the side panel's page
 * (the agent loop lives there), and a notification says when it is done. Alarms do the timing;
 * they are rebuilt whenever the shortcuts change and whenever the service worker starts.
 * Runs missed while the browser was closed are skipped, not caught up.
 */
import { nextRun } from '@datalabrotterdam/nova-ai-browser-protocol';
import { loadSettings } from '../lib/settings';
import { loadShortcuts, runShortcutWindow } from '../lib/shortcuts';
import { isRunActive } from './presence';

const PREFIX = 'shortcut:';
const NOTIFICATION = 'task:';

async function schedule(): Promise<void> {
    for (const alarm of await chrome.alarms.getAll()) {
        if (alarm.name.startsWith(PREFIX)) await chrome.alarms.clear(alarm.name);
    }
    const now = Date.now();
    for (const shortcut of await loadShortcuts()) {
        const when = nextRun(shortcut.schedule, now);
        if (when !== undefined) chrome.alarms.create(`${PREFIX}${shortcut.id}`, { when });
    }
}

chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.shortcuts) void schedule();
});
chrome.runtime.onStartup.addListener(() => void schedule());
chrome.runtime.onInstalled.addListener(() => void schedule());
void schedule();

chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (!alarm.name.startsWith(PREFIX)) return;
    const id = alarm.name.slice(PREFIX.length);
    const shortcut = (await loadShortcuts()).find((candidate) => candidate.id === id);
    // Arm the next run first, so a failure below does not end the schedule.
    await schedule();
    if (!shortcut) return;
    // One chat at a time drives the Nova tab group; a busy Nova skips this run.
    if (isRunActive()) return;
    await runShortcutWindow(shortcut.id);
});

/** A task window reports that its run ended. */
chrome.runtime.onMessage.addListener((message: { type?: string; name?: string; summary?: string }, sender) => {
    if (message?.type !== 'task/done' || sender.id !== chrome.runtime.id) return false;
    void (async () => {
        if (!(await loadSettings()).taskNotifications) return;
        const windowId = sender.tab?.windowId;
        chrome.notifications.create(`${NOTIFICATION}${windowId ?? ''}`, {
            type: 'basic',
            iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
            title: `Nova finished /${message.name ?? 'task'}`,
            message: (message.summary ?? 'The task is done.').slice(0, 200)
        });
    })();
    return false;
});

chrome.notifications.onClicked.addListener((id) => {
    if (!id.startsWith(NOTIFICATION)) return;
    const windowId = Number(id.slice(NOTIFICATION.length));
    if (Number.isInteger(windowId)) void chrome.windows.update(windowId, { focused: true }).catch(() => undefined);
    chrome.notifications.clear(id);
});
