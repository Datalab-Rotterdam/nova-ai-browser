# Roadmap: Nova AI Browser

Status on 2026-10-25 (host `1.3.0` on npm; the Chrome Web Store release is on hold). What is
done, what is still open, and why. Update this file as work lands.

## Done

| Feature | PR | Notes |
|---|---|---|
| **Host on npm** | #1 | `@datalabrotterdam/nova-ai-browser-host`. Nova for VS Code and nova-ai-cli install it on start-up. |
| **Saved chats** | #3 | The last 50 chats in `chrome.storage.local`, without screenshots; the panel reopens the last one. A copy goes to `~/.nova-ai/browser/sessions/` while the host is connected, so agents can refer to past sessions. |
| **Host home `~/.nova-ai/browser`** | #3 | bin, host builds, `hosts/`, log, screenshots and sessions. Does not follow `NOVA_AI_HOME` (the browser starts the host without the installer's environment). |
| **Full-page screenshots** | #3 | `computer` `screenshot` with `full_page: true`, stitched per viewport. The model gets a scaled copy, the user the full resolution with a note. |
| **Image viewer** | #3 | Click a screenshot to zoom (pinch, Ctrl/⌘+wheel, buttons, keys) and pan. |
| **Text tool calls only when tools are rejected** | #4 | `isToolCallingRejected` (from nova-ai-vscode) instead of any 400/422. |
| **Context window** | #5 | Before each request: older tool results shortened, then older turns summarized, then dropped (`packages/protocol/src/model/context.ts`). On an overflow error: learn the real limit, compact hard, retry once. Context length from the model list, 32k when unknown. |
| **Own tab group** | #6 | Nova starts in a new empty tab instead of taking the user's tab; the user's tabs join only through "Use this tab". New chat or closing the panel closes Nova's tabs and ungroups the user's. |
| **Tab marker** | #7, #11 | The Nova mark is the favicon of every tab Nova is using, until it is done. |
| **Model and effort menu** | #8, #11 | nova-ai-vscode's model menu: search, effort slider or thinking switch, sent as `reasoning_effort`. |
| **Chat list** | #9, #11 | Reopen or delete any of the 50 saved chats. |
| **Qwen3-Coder tool calls** | #10 | `<function=…><parameter=…>` inside `<tool_call>` is parsed. |
| **Pre-approved agents** | #12 | An agent whose user already approved a call (`NOVA_BROWSER_PREAPPROVED=1`) skips the site prompt; the agent itself still needs approval in the browser. |

## Still to do

Each item ships as its own PR into `main`, with tests. Port nova-ai-vscode's code where it
already solves the problem rather than writing new code.

### Phase 1: bugs and risks

#### 3. Confirm irreversible actions in code
- **What:** "ask before purchases, sending, deleting" is only a rule in the system prompt (`agent/prompt.ts`).
- **Why:** a model that ignores it, or a page that injects instructions, can still click "Pay".
- **How:** before a click or `form_input` on an element whose label matches pay, buy, order, send, submit, delete or similar (from `page/resolve` / `page/describe-point`), ask the user with `requestDecision` (`packages/extension/src/background/permissions.ts`). For every caller, so MCP agents too.

#### 4. Smaller loop and prompt fixes
- A permission prompt that times out (3 minutes) silently counts as deny: tell the user in the panel.
- Repeat detection only catches the same call three times in a row; also catch alternating between two calls.

### Phase 2: features from nova-ai-vscode

#### 6. Tokens and cost
- Request usage with the stream (`stream_options: { include_usage: true }`), show tokens and cost per chat. nova-ai-vscode: `webview/src/chat/usage.ts`, usage handling in `src/model/modelProvider.ts`.
- With usage, port `TokenCalibration` (nova-ai-vscode `src/agent/ContextManager.ts`) so compaction (#5) starts at the right moment for each tokenizer.

#### 7. Read-only mode
- An "Ask" mode that only reads pages: refuse calls for which `isReadOnlyCall` (`packages/protocol/src/tools.ts`) is false, and say so in the prompt. Like nova-ai-vscode's `resources/chat/agents/modes/ask.md`.

#### 8. Per-site rules
- Rules beside "always allow / deny" per site, e.g. always ask before form submits on a bank's site. nova-ai-vscode `src/permissions/rules.ts` has allow / ask / deny rules; item 3 would use them.

### Phase 3: quality

#### 9. README
- A root README: what the extension does, installing (extension and host), `npm run dev`, tests, and how `extension`, `host` and `protocol` fit together.

#### 10. Unit tests for the extension
- Pure logic without tests: `pruneImages` (`agent/loop.ts`), `normalizeRef` (`background/tools/index.ts`), `originOf` (`background/permissions.ts`), repeat detection. Tests go in `packages/extension/test/`; `loop.test.ts` shows how to run the agent against a stubbed `fetch`.

#### 11. Dutch
- The UI in Dutch and English with `chrome.i18n` (`_locales/`), no library.

### Later

- **Full-page screenshots:** fixed and sticky headers show on every slice; pages that scroll an inner element come out as one viewport; a faint line where Chrome's debugging bar slid in. Hide fixed elements while capturing, find the scrolling element.
- **nova-ai-cli:** its `read_file` only allows the workspace, so the CLI agent cannot open browser screenshots (`~/.nova-ai/browser/screenshots`). nova-ai-vscode allows images there (`browserScreenshots()` in `src/agent/tools/readTools.ts`).
- **External agents' tabs:** the host does not say when an MCP agent is done, so the tabs it opened stay until the panel's chat ends. A client-disconnect message from the host would let them close.
- **Text tool calls:** text tool results are user messages, so compaction cannot shorten them (only summarize or drop). A Qwen XML parameter that is only digits arrives as a number; the tool schema could keep it text.
- **nova-ai-vscode:** port the Qwen3-Coder XML tool-call parser (#10) to its `src/model/textToolCalls.ts`.
- **Chrome Web Store:** the upload waits for the repository variable `PUBLISH_CHROME_EXTENSION`.
