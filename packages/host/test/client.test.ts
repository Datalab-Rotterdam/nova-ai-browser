import { describe, expect, it } from 'vitest';
import { identifyClient } from '@datalabrotterdam/nova-ai-browser-protocol';
import { callerClient, detectClient } from '../src/call';

describe('identifyClient', () => {
    it('maps names agents report in MCP initialize', () => {
        expect(identifyClient('Visual Studio Code')).toEqual({ id: 'vscode', name: 'Visual Studio Code' });
        expect(identifyClient('claude-code')).toEqual({ id: 'claude-code', name: 'Claude Code' });
        expect(identifyClient('codex-mcp-client')).toEqual({ id: 'codex', name: 'Codex' });
        expect(identifyClient('nova-ai-cli')).toEqual({ id: 'nova-ai-cli', name: 'Nova AI CLI' });
    });

    it('keeps unknown names readable with a stable id', () => {
        expect(identifyClient('My Agent 2.0')).toEqual({ id: 'my-agent-2-0', name: 'My Agent 2.0' });
        expect(identifyClient('')).toEqual({ id: 'unknown', name: 'An unknown agent' });
        expect(identifyClient('ideas-app').id).toBe('ideas-app');
    });
});

describe('detectClient (skill script)', () => {
    it('finds the app above shells and node', () => {
        expect(detectClient(['sh', 'zsh', 'Code Helper (Plugin)', 'Electron'], undefined)).toEqual({ id: 'vscode', name: 'Visual Studio Code' });
        expect(detectClient(['bash', 'node', 'claude', 'zsh', 'login'], undefined)).toEqual({ id: 'claude-code', name: 'Claude Code' });
        expect(detectClient(['sh', 'codex', 'zsh'], undefined).id).toBe('codex');
    });

    it('uses the first non-wrapper process for unknown apps', () => {
        expect(detectClient(['sh', 'node', 'my-agent', 'zsh'], undefined)).toEqual({ id: 'my-agent', name: 'my-agent' });
        expect(detectClient(['sh', '-zsh', 'login'], undefined)).toEqual({ id: 'terminal', name: 'A terminal command' });
    });

    it('honors NOVA_BROWSER_CLIENT', () => {
        expect(detectClient(['claude'], 'Nova AI CLI')).toEqual({ id: 'nova-ai-cli', name: 'Nova AI CLI' });
    });
});

describe('callerClient', () => {
    it('marks calls the app already approved', () => {
        expect(callerClient({ NOVA_BROWSER_CLIENT: 'Visual Studio Code', NOVA_BROWSER_PREAPPROVED: '1' })).toEqual({ id: 'vscode', name: 'Visual Studio Code', preApproved: true });
        expect(callerClient({ NOVA_BROWSER_CLIENT: 'Visual Studio Code' }).preApproved).toBeUndefined();
    });
});
