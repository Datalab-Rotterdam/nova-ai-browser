import { chmodSync, existsSync, lstatSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

/** Removes a temp folder, including read-only parts such as an installed bundled skill. */
export function removeTree(path: string): void {
    if (!existsSync(path)) return;
    const unlock = (dir: string) => {
        chmodSync(dir, 0o755);
        for (const entry of readdirSync(dir)) {
            const full = join(dir, entry);
            const stat = lstatSync(full);
            if (stat.isDirectory()) unlock(full);
            else if (!stat.isSymbolicLink()) chmodSync(full, 0o644);
        }
    };
    unlock(path);
    rmSync(path, { recursive: true, force: true });
}

/** The first running host's info in a Nova AI Browser home (`hosts/<pid>.json`), if any. */
export function hostInfoIn(home: string): { file: string; info: { mcpUrl: string; token: string; extensionOrigin: string; socket: string } } | undefined {
    const dir = join(home, 'hosts');
    if (!existsSync(dir)) return undefined;
    const name = readdirSync(dir).find((entry) => entry.endsWith('.json'));
    if (!name) return undefined;
    try {
        return { file: join(dir, name), info: JSON.parse(readFileSync(join(dir, name), 'utf8')) };
    } catch {
        return undefined;
    }
}

/**
 * Environment for a test browser. Browsers find the user's real host registration (on macOS
 * from the account, whatever HOME says); a separate Nova AI Browser home makes the host
 * they start use temporary files, never the user's real ~/.nova-ai-browser.
 */
export function isolatedEnv(root: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
    return { ...process.env, HOME: root, NOVA_AI_BROWSER_HOME: join(root, 'home'), NOVA_AI_HOME: join(root, 'nova'), ...extra };
}
