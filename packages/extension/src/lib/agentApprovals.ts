/** Storage of external agents' approvals, shared by the service worker and the settings page. */
export const STORE_KEY = 'agentApprovals';
export const SESSION_ALLOWED = 'sessionAgents';
export const SESSION_DENIED = 'deniedAgents';

export interface AgentApproval {
    name: string;
    decision: 'always' | 'deny';
    decidedAt: string;
}

export async function agentApprovals(): Promise<Record<string, AgentApproval>> {
    return ((await chrome.storage.local.get(STORE_KEY))[STORE_KEY] ?? {}) as Record<string, AgentApproval>;
}

export async function sessionList(key: string): Promise<string[]> {
    return ((await chrome.storage.session.get(key))[key] ?? []) as string[];
}

export async function addToSessionList(key: string, id: string): Promise<void> {
    await chrome.storage.session.set({ [key]: [...new Set([...await sessionList(key), id])] });
}

export async function storeAgentApproval(id: string, approval: AgentApproval | undefined): Promise<void> {
    const all = await agentApprovals();
    if (approval) all[id] = approval;
    else delete all[id];
    await chrome.storage.local.set({ [STORE_KEY]: all });
}

/** Forgets an agent's approval or block: it has to ask again next time. */
export async function forgetAgent(id: string): Promise<void> {
    await storeAgentApproval(id, undefined);
    for (const key of [SESSION_ALLOWED, SESSION_DENIED]) {
        await chrome.storage.session.set({ [key]: (await sessionList(key)).filter((entry) => entry !== id) });
    }
}
