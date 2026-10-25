export interface AcpAgentConfig {
    name: string;
    command: string;
    args: string[];
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
    /** Ask before Nova acts on a site for the first time. */
    askBeforeActing: boolean;
    allowJavascript: boolean;
    showCursorInScreenshots: boolean;
    /** Let VS Code, Claude Code and ACP agents use the browser through the native host. */
    externalAgents: boolean;
    acpAgents: AcpAgentConfig[];
}

export const DEFAULT_BASE_URL = 'https://api.nova.datalabrotterdam.nl/v1';

export const DEFAULT_SETTINGS: Settings = {
    apiKey: '',
    baseUrl: DEFAULT_BASE_URL,
    model: '',
    effort: '',
    vision: 'auto',
    maxRounds: 40,
    askBeforeActing: true,
    allowJavascript: false,
    showCursorInScreenshots: false,
    externalAgents: true,
    acpAgents: [{ name: 'Nova AI CLI', command: 'nova-ai-cli', args: ['--acp'] }]
};

const KEY = 'settings';

export async function loadSettings(): Promise<Settings> {
    const stored = await chrome.storage.local.get(KEY);
    return { ...DEFAULT_SETTINGS, ...(stored[KEY] as Partial<Settings> | undefined) };
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
    const next = { ...(await loadSettings()), ...patch };
    await chrome.storage.local.set({ [KEY]: next });
    return next;
}

export function onSettingsChanged(listener: (settings: Settings) => void): () => void {
    const handler = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
        if (area === 'local' && changes[KEY]) {
            listener({ ...DEFAULT_SETTINGS, ...(changes[KEY].newValue as Partial<Settings>) });
        }
    };
    chrome.storage.onChanged.addListener(handler);
    return () => chrome.storage.onChanged.removeListener(handler);
}
