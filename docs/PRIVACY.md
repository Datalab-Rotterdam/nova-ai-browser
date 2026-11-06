# Privacy policy: Nova AI browser extension

Last updated 2026-11-06. Publisher: DataLab Rotterdam. This is the policy to link from the Chrome Web Store
and Edge Add-ons listings; it needs a public URL (for example a page on datalabrotterdam.nl) before submitting.

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

Nothing is sent when you are not running a task. The extension has no analytics, advertising or
tracking, and it sends nothing to anyone except the Nova AI API address you configured. How Nova AI
processes data on its servers is covered by the Nova AI platform's own terms and privacy policy.

## What is stored on your device

In the browser's local extension storage, never synced to other devices:

- your Nova API key and settings;
- your saved chats (the last 50, without screenshots);
- the websites you chose to always allow or block.

"Sign out" removes the API key. Deleting a chat removes it. Removing the extension removes all of it.

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
