export interface AcpAgentConfig {
    name: string;
    command: string;
    args: string[];
}

/**
 * When Nova asks before acting on a site, like nova-ai-vscode's `nova.agent.approvalMode`:
 * - ask: before Nova reads or acts on a site for the first time;
 * - autoAll: never (sites the user blocked stay blocked; external agents still need approval).
 */
export type ApprovalMode = 'ask' | 'autoAll';

export interface PermissionOption {
    mode: ApprovalMode;
    label: string;
    description: string;
    icon: string;
}

/** Permission modes as the composer's menu shows them (same labels and icons as nova-ai-vscode). */
export const PERMISSION_OPTIONS: readonly PermissionOption[] = [
    { mode: 'ask', label: 'Manual permissions', description: 'Asks the first time Nova uses a website', icon: 'key' },
    { mode: 'autoAll', label: 'Allow all', description: 'Uses any website without asking', icon: 'warning' }
];

export function permissionOption(mode: ApprovalMode): PermissionOption {
    return PERMISSION_OPTIONS.find((option) => option.mode === mode) ?? PERMISSION_OPTIONS[0];
}

export interface Settings {
    apiKey: string;
    baseUrl: string;
    model: string;
    /** Chosen reasoning effort; models that do not accept it get a default (see `effortFor`). */
    effort: string;
    /** "auto" follows the model's capabilities from models.list(). */
    vision: 'auto' | 'on' | 'off';
    maxRounds: number;
    approvalMode: ApprovalMode;
    allowJavascript: boolean;
    showCursorInScreenshots: boolean;
    /** Let VS Code, Claude Code and ACP agents use the browser through the native host. */
    externalAgents: boolean;
    acpAgents: AcpAgentConfig[];
    /** Shows the tool tester in the side panel. Only offered in builds that include it (see lib/build.ts). */
    developerTools: boolean;
}

export const DEFAULT_BASE_URL = 'https://api.nova.datalabrotterdam.nl/v1';

export const DEFAULT_SETTINGS: Settings = {
    apiKey: '',
    baseUrl: DEFAULT_BASE_URL,
    model: '',
    effort: '',
    vision: 'auto',
    maxRounds: 40,
    approvalMode: 'ask',
    allowJavascript: false,
    showCursorInScreenshots: false,
    externalAgents: true,
    developerTools: false,
    acpAgents: [{ name: 'Nova AI CLI', command: 'nova-ai-cli', args: ['--acp'] }]
};

const KEY = 'settings';

/** Stored settings over the defaults; settings saved before `approvalMode` keep their old choice. */
function withDefaults(stored: (Partial<Settings> & { askBeforeActing?: boolean }) | undefined): Settings {
    const { askBeforeActing, ...rest } = stored ?? {};
    const approvalMode: ApprovalMode = rest.approvalMode === 'ask' || rest.approvalMode === 'autoAll'
        ? rest.approvalMode
        : askBeforeActing === false ? 'autoAll' : 'ask';
    return { ...DEFAULT_SETTINGS, ...rest, approvalMode };
}

export async function loadSettings(): Promise<Settings> {
    const stored = await chrome.storage.local.get(KEY);
    return withDefaults(stored[KEY] as Partial<Settings> | undefined);
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
    const next = { ...(await loadSettings()), ...patch };
    await chrome.storage.local.set({ [KEY]: next });
    return next;
}

export function onSettingsChanged(listener: (settings: Settings) => void): () => void {
    const handler = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
        if (area === 'local' && changes[KEY]) {
            listener(withDefaults(changes[KEY].newValue as Partial<Settings> | undefined));
        }
    };
    chrome.storage.onChanged.addListener(handler);
    return () => chrome.storage.onChanged.removeListener(handler);
}
