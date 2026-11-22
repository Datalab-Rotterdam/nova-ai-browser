# Privacy policy: Nova AI browser extension

Last updated 2026-11-22. Publisher: DataLab Rotterdam. This page is the privacy policy linked from the Chrome Web Store
and Edge Add-ons listings. DataLab Rotterdam's general privacy policy is https://datalabrotterdam.com/privacy-policy;
keep the two consistent.

## What Nova AI does

Nova AI lets an AI model use your browser for you: it reads pages, clicks, types and takes screenshots
while you watch its cursor. It only acts on websites you allowed, in tabs of its own "Nova" tab group
or tabs you explicitly give it with "Use this tab".

## What data leaves your browser

When you send a message, the extension sends this to the **Nova AI API** at the address in Settings
(default `https://api.nova.datalabrotterdam.nl/v1`), using your API key:

- your messages and the conversation so far;
- the text, structure and screenshots of the pages Nova reads or acts on for that task;
- the results of the actions Nova takes.

The extension sends data to the Nova AI API during AI tasks. It has no analytics, advertising or
tracking. When you watch a page or selected text, the extension revisits the source page in your
browser profile while the browser is open. Snapshots and change history stay in the extension and
do not go to the Nova AI API. Browser notifications can display a preview of changes. How Nova AI
processes data on its servers is covered by the platform's own privacy policy.

## What is stored on your device

In the browser's local extension storage, never synced to other devices:

- your Nova API key and settings;
- your saved chats (the last 50, without screenshots);
- the URLs and latest snapshots of the pages or text you watch, the last check status, and up to ten changes per watch;
- the websites you chose to always allow or block.

"Sign out" removes the API key. Deleting a chat removes it. Removing the extension removes all of it.
Removing a watch in Settings → Watchlist deletes its local history and stops future checks.

## The optional helper program

If you let other AI apps (Nova AI for VS Code, nova-ai-cli, Claude Code, ...) use the browser, the
extension talks to a small helper program on your computer through Chrome's native messaging. The helper
keeps a copy of your saved chats and any screenshots it hands to an app in `~/.nova-ai/browser/` (files
readable only by you). Each app has to be approved by you in the browser before it can do anything. This
is off if you turn off "Let other AI apps use this browser".

## Permissions and why

See [STORE_LISTING.md](./STORE_LISTING.md) for each permission and what it is used for.

## Your control

- Nova asks before it uses a website for the first time (unless you choose "Allow all"), and you can stop it at any time.
- You can see and forget remembered websites in Settings, Permissions.
- Nova asks before irreversible actions such as paying, sending or deleting.

## Contact

Questions about this policy: open an issue at https://github.com/Datalab-Rotterdam/nova-ai-browser/issues.
