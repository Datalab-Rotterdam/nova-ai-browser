/**
 * Approval of external agents. An agent (VS Code, Claude Code, Codex, the nova-browser skill
 * run from some app, …) may only use the browser after the user allowed it, for this browser
 * session or always. The agent's name is what it reports; this is a consent step that keeps
 * the user in charge, not a defense against local malware.
 */
import type { AgentClient } from '@datalabrotterdam/nova-ai-browser-protocol';
import { addToSessionList, agentApprovals, SESSION_ALLOWED, SESSION_DENIED, sessionList, storeAgentApproval } from '../lib/agentApprovals';
import { requestDecision } from './permissions';

/** Resolves when the agent may use the browser; throws a message for the agent otherwise. */
export async function ensureAgentAllowed(client: AgentClient, tool: string, summary: string): Promise<void> {
    await rememberName(client);
    const stored = (await agentApprovals())[client.id];
    if (stored?.decision === 'deny') {
        throw new Error(`The user does not allow ${client.name} to use the browser. Do not try again; the user can change this in the Nova AI extension's settings.`);
    }
    if (stored?.decision === 'always' || (await sessionList(SESSION_ALLOWED)).includes(client.id)) return;
    // A "no" holds for the rest of the browser session, so an agent cannot keep prompting.
    if ((await sessionList(SESSION_DENIED)).includes(client.id)) {
        throw new Error(`The user did not allow ${client.name} to use the browser. Do not retry; ask the user.`);
    }

    const decision = await requestDecision(`agent:${client.id}`, { kind: 'agent', client, tool, summary });
    if (decision === 'deny') {
        await addToSessionList(SESSION_DENIED, client.id);
        throw new Error(`The user did not allow ${client.name} to use the browser. Do not retry; ask the user.`);
    }
    if (decision === 'always') {
        await storeAgentApproval(client.id, { name: client.name, decision: 'always', decidedAt: new Date().toISOString() });
    } else {
        await addToSessionList(SESSION_ALLOWED, client.id);
    }
}

/** Session approvals only store ids; keep the names for the settings list. */
async function rememberName(client: AgentClient): Promise<void> {
    const names = ((await chrome.storage.session.get('agentNames')).agentNames ?? {}) as Record<string, string>;
    if (names[client.id] !== client.name) {
        await chrome.storage.session.set({ agentNames: { ...names, [client.id]: client.name } });
    }
}
