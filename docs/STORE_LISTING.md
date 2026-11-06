# Chrome Web Store and Edge Add-ons listing

Text for the store dashboard. Keep in sync with `packages/extension/manifest.config.ts`.

## Name and summary

- **Name:** Nova AI
- **Summary (max 132):** Let Nova AI use your browser: it clicks, types and reads pages while you watch its cursor.
- **Category:** Productivity

## Detailed description

Nova AI is an AI assistant that works in your browser. Ask it to find something, fill in a form or
gather information from several pages, and watch it do it with a visible cursor.

- It works in its own "Nova" tab group, so your own tabs are left alone unless you hand one over.
- It asks before it uses a website for the first time, and before actions that cannot be undone.
- You can stop it at any time, and closing the side panel ends the run.
- Select text and right-click, or type `nova` in the address bar, to ask about it.
- Open or close it from anywhere with Ctrl+E (Cmd+E on Mac).
- Optional: let Nova AI for VS Code, nova-ai-cli, Claude Code and other agents use the same browser
  through a small local helper.

Requires a Nova AI account and API key.

## Single purpose

Let an AI model, chosen and authorised by the user, operate the user's browser on their behalf.

## Permission justifications

| Permission | Why |
|---|---|
| `sidePanel` | The chat lives in Chrome's side panel. |
| `storage` | Saves the API key, settings, saved chats and allowed websites. |
| `unlimitedStorage` | Saved chats can outgrow the 10 MB default. |
| `scripting` | Runs the page-reading script (accessibility tree, find, form fill) in the tabs Nova uses. |
| `debugger` | Sends real clicks, keystrokes and screenshots through the Chrome DevTools Protocol so pages cannot tell them from the user's; also full-page screenshots and file uploads. Attached only to tabs Nova uses, and only during a task. |
| `tabs` | Opens, lists and closes Nova's tabs and reads the title and address of tabs it uses. |
| `tabGroups` | Puts Nova's tabs in their own "Nova" group. |
| `contextMenus` | Adds "Ask Nova about this selection / page / link" to the right-click menu. |
| `nativeMessaging` | Optional link to the local helper that lets other AI apps use the browser. Unused when that setting is off. |
| Host access `<all_urls>` | Nova may be asked to work on any website. It acts only on sites the user approved, and asks first. |
| Content scripts (`http`, `https`, `file`) | The page-reading script and the visible cursor overlay. `file://` works only if the user enables file access for the extension. |

## Remote code

None. All code is in the package. The model's replies are data, never executed by the extension.
The optional "Let Nova run scripts on pages" setting (off by default) lets the model send JavaScript to a page
through the debugger; the user turns it on knowingly.

## Data usage disclosures (dashboard form)

- Collected: web history and website content (pages the user lets Nova read), authentication information (API key, stored locally).
- Used only to provide the single purpose; not sold; not used for unrelated purposes or creditworthiness.
- Sent only to the Nova AI API the user configured.
- Privacy policy URL: https://datalabrotterdam.com/privacy-policy (details of the extension's data handling: [PRIVACY.md](./PRIVACY.md)).

## Assets to prepare

- 128x128 icon (in the package).
- At least one 1280x800 screenshot: the side panel working on a page; the settings page; a permission prompt.
- Small promo tile 440x280; marquee 1400x560 (optional).
