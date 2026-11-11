/**
 * Registers the native messaging host with Chromium-based browsers for the current user, the
 * way Claude Code does for its browser extension:
 *
 * - The host's files are copied to `~/.nova-ai/browser/host/<version>/`, so the registration
 *   never points into a folder that an app update replaces (VS Code extension folders change
 *   with every version).
 * - A generated wrapper, `~/.nova-ai/browser/bin/nova-ai-browser-host`, runs that copy with an
 *   absolute Node path (browsers start hosts without the user's shell PATH).
 * - A manifest pointing at the wrapper goes into every installed browser's NativeMessagingHosts
 *   folder (registry keys on Windows).
 *
 * Nova AI for VS Code and nova-ai-cli run this with `--auto` on startup: it changes nothing when
 * everything is current and never replaces a newer host with an older one.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEV_EXTENSION_ID, ensureHomeDir, homeDir, HOST_NAME } from './paths';
import { VERSION } from './version';

interface BrowserTarget {
    name: string;
    /** Folder whose NativeMessagingHosts subfolder receives the manifest (macOS/Linux). */
    dir?: string;
    /** Registry key prefix (Windows). */
    registry?: string;
}

export function browserTargets(): BrowserTarget[] {
    const home = homedir();
    if (process.platform === 'darwin') {
        const base = join(home, 'Library', 'Application Support');
        return [
            ['Google Chrome', 'Google/Chrome'], ['Google Chrome Beta', 'Google/Chrome Beta'], ['Google Chrome Dev', 'Google/Chrome Dev'],
            ['Google Chrome Canary', 'Google/Chrome Canary'], ['Chromium', 'Chromium'], ['Microsoft Edge', 'Microsoft Edge'],
            ['Microsoft Edge Beta', 'Microsoft Edge Beta'], ['Microsoft Edge Dev', 'Microsoft Edge Dev'],
            ['Brave', 'BraveSoftware/Brave-Browser'], ['Vivaldi', 'Vivaldi'], ['Arc', 'Arc/User Data'],
            ['Opera', 'com.operasoftware.Opera'], ['Opera GX', 'com.operasoftware.OperaGX']
        ].map(([name, dir]) => ({ name, dir: join(base, dir) }));
    }
    if (process.platform === 'win32') {
        return [
            ['Google Chrome', 'Software\\Google\\Chrome'], ['Chromium', 'Software\\Chromium'],
            ['Microsoft Edge', 'Software\\Microsoft\\Edge'], ['Brave', 'Software\\BraveSoftware\\Brave-Browser'],
            ['Vivaldi', 'Software\\Vivaldi']
        ].map(([name, registry]) => ({ name, registry }));
    }
    const base = process.env.XDG_CONFIG_HOME ?? join(home, '.config');
    return [
        ['Google Chrome', 'google-chrome'], ['Google Chrome Beta', 'google-chrome-beta'], ['Google Chrome Dev', 'google-chrome-unstable'],
        ['Chromium', 'chromium'], ['Microsoft Edge', 'microsoft-edge'], ['Microsoft Edge Beta', 'microsoft-edge-beta'],
        ['Brave', 'BraveSoftware/Brave-Browser'], ['Vivaldi', 'vivaldi'], ['Opera', 'opera']
    ].map(([name, dir]) => ({ name, dir: join(base, dir) }));
}

/**
 * An app that runs the host itself, so the browser needs no Node to start it: Nova AI Desktop's
 * sidecar bundles the host and runs it as `<command> <args…> chrome-extension://…/`.
 */
export interface Carrier {
    /** Absolute path of the executable. */
    command: string;
    /** Arguments before the host's own (e.g. a subcommand that selects the host). */
    args: string[];
}

export interface InstallOptions {
    extensionIds: string[];
    /** Extra browser user-data dirs (e.g. a dev profile started with --user-data-dir). */
    userDataDirs: string[];
    /** Quiet startup mode: never downgrade a newer installed host. */
    auto?: boolean;
    /** Register this app as the host instead of copying the runtime and running it with Node. */
    carrier?: Carrier;
}

export interface InstallResult {
    /** Version of the host the registration now points at. */
    version: string;
    /** False when a newer host was already installed (auto mode keeps it). */
    usedThisVersion: boolean;
    /** Whether anything on disk changed. */
    changed: boolean;
    /** Browsers that are registered now. */
    browsers: string[];
    /** Browsers registered for the first time: they pick it up after a restart. */
    newBrowsers: string[];
    /** The Node binary the wrapper runs. */
    node: string;
    /** Whether that binary is Electron run as Node (VS Code without a system Node). */
    nodeIsElectron: boolean;
    /** The app that runs the host, when the registration points at one instead of Node. */
    carrier?: Carrier;
}

// ---------------------------------------------------------------------------------------------
// Versions and runtime copies

/** dist/ of the running host (its bundled files sit next to this one). */
function ownPackageRoot(): string {
    return dirname(dirname(fileURLToPath(import.meta.url)));
}

export function compareVersions(a: string, b: string): number {
    const parse = (v: string) => v.split(/[.+-]/).slice(0, 3).map((part) => Number.parseInt(part, 10) || 0);
    const [x, y] = [parse(a), parse(b)];
    for (let i = 0; i < 3; i++) {
        if (x[i] !== y[i]) return x[i] - y[i];
    }
    return 0;
}

function runtimesDir(): string {
    return join(homeDir(), 'host');
}

export function runtimeDir(version: string): string {
    return join(runtimesDir(), version);
}

const CARRIER_FILE = 'carrier.json';

/** The carrier registered for a version, if its executable is still there (an app can be removed). */
export function readCarrier(version: string): Carrier | undefined {
    try {
        const value = JSON.parse(readFileSync(join(runtimeDir(version), CARRIER_FILE), 'utf8')) as Partial<Carrier>;
        if (typeof value.command !== 'string' || !Array.isArray(value.args) || !value.args.every((arg) => typeof arg === 'string')) return undefined;
        return existsSync(value.command) ? { command: value.command, args: value.args } : undefined;
    } catch {
        return undefined;
    }
}

/** Records a carrier for this version; a Node runtime of the same version stays as the fallback. */
function writeCarrier(version: string, carrier: Carrier): boolean {
    return writeIfChanged(join(runtimeDir(version), CARRIER_FILE), `${JSON.stringify(carrier, null, 2)}\n`);
}

/** Highest installed runtime version (a Node runtime or a carrier that still exists), if any. */
export function installedVersion(): string | undefined {
    try {
        return readdirSync(runtimesDir())
            .filter((name) => existsSync(join(runtimesDir(), name, 'dist', 'cli.js')) || readCarrier(name) !== undefined)
            .sort(compareVersions)
            .at(-1);
    } catch {
        return undefined;
    }
}

function buildId(root: string): string | undefined {
    try {
        return createHash('sha256').update(readFileSync(join(root, 'dist', 'cli.js'))).update(readFileSync(join(root, 'dist', 'mcp.js'))).digest('hex').slice(0, 16);
    } catch {
        return undefined;
    }
}

/** Copies this package's runtime files (dist, skill, package.json) to the shared location. */
function copyRuntime(version: string): boolean {
    const target = runtimeDir(version);
    const source = ownPackageRoot();
    if (source === target) return false;
    // Already there with the same build (dev builds keep their version number, so compare content).
    if (existsSync(join(target, 'skill')) && buildId(target) !== undefined && buildId(target) === buildId(source)) return false;
    rmSync(target, { recursive: true, force: true });
    mkdirSync(target, { recursive: true });
    for (const part of ['dist', 'skill', 'package.json']) {
        if (existsSync(join(source, part))) {
            cpSync(join(source, part), join(target, part), { recursive: true, filter: (file) => !file.endsWith('.map') });
        }
    }
    return true;
}

/** Keeps the current runtime and the one before it (a browser may still run the old host). */
function pruneRuntimes(keep: string): void {
    let versions: string[];
    try {
        versions = readdirSync(runtimesDir()).sort(compareVersions);
    } catch {
        return;
    }
    const older = versions.filter((v) => compareVersions(v, keep) < 0);
    for (const version of older.slice(0, -1)) {
        rmSync(join(runtimesDir(), version), { recursive: true, force: true });
    }
}

// ---------------------------------------------------------------------------------------------
// Node binary for the wrapper

function nodeVersion(binary: string, env?: NodeJS.ProcessEnv): number | undefined {
    try {
        const output = execFileSync(binary, ['-p', 'process.versions.node'], { encoding: 'utf8', env, timeout: 5_000 }).trim();
        return Number.parseInt(output, 10);
    } catch {
        return undefined;
    }
}

/**
 * Homebrew's versioned Cellar path disappears on `brew upgrade`; its opt/ symlink stays.
 * /opt/homebrew/Cellar/node@24/24.21.0/bin/node → /opt/homebrew/opt/node@24/bin/node
 */
export function stableNodePath(path: string): string {
    const match = /^(.*)\/Cellar\/([^/]+)\/[^/]+\/bin\/(node[^/]*)$/.exec(path);
    if (!match) return path;
    const stable = `${match[1]}/opt/${match[2]}/bin/${match[3]}`;
    return existsSync(stable) ? stable : path;
}

export interface NodeRuntime {
    path: string;
    /** Set when the binary is Electron (VS Code) and must run as plain Node. */
    electron: boolean;
}

/**
 * The Node to run the host with. A plain Node 20+ is preferred (on PATH or in the usual
 * install folders); inside VS Code without one, VS Code's own runtime runs as Node.
 */
export function resolveNode(): NodeRuntime {
    if (!process.versions.electron) {
        return { path: stableNodePath(process.execPath), electron: false };
    }
    const exe = process.platform === 'win32' ? 'node.exe' : 'node';
    const candidates = [
        ...(process.env.PATH ?? '').split(delimiter).filter(Boolean).map((dir) => join(dir, exe)),
        '/opt/homebrew/bin/node', '/usr/local/bin/node', '/usr/bin/node',
        join(homedir(), '.volta', 'bin', exe)
    ];
    for (const candidate of [...new Set(candidates)]) {
        if (existsSync(candidate) && (nodeVersion(candidate) ?? 0) >= 20) {
            return { path: stableNodePath(candidate), electron: false };
        }
    }
    return { path: process.execPath, electron: true };
}

function writeIfChanged(file: string, content: string, mode?: number): boolean {
    try {
        if (readFileSync(file, 'utf8') === content) return false;
    } catch {
        // New file.
    }
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
    if (mode !== undefined) chmodSync(file, mode);
    return true;
}

/** Marks a wrapper that runs a carrier, not Node. */
const CARRIER_MARK = 'Runs a carrier app:';

function shellScripts(command: string, args: string[], extraArgs: string, comment: string, electron: boolean): { unix: string; cmd: string } {
    const header = `Generated by Nova AI - do not edit. ${comment}`;
    const line = [command, ...args].map((part) => `"${part}"`).join(' ') + (extraArgs ? ` ${extraArgs}` : '');
    return {
        unix: `#!/bin/sh\n# ${header}\n${electron ? 'ELECTRON_RUN_AS_NODE=1 ' : ''}exec ${line} "$@"\n`,
        cmd: `@echo off\r\nrem ${header}\r\n${electron ? 'set ELECTRON_RUN_AS_NODE=1\r\n' : ''}${line} %*\r\n`
    };
}

/** Shell launcher for a script: absolute Node, Electron run as Node when needed. */
export function launcherScript(node: NodeRuntime, script: string, extraArgs: string, comment: string): { unix: string; cmd: string } {
    return shellScripts(node.path, [script], extraArgs, comment, node.electron);
}

/** Shell launcher that runs a carrier app with its own arguments. */
export function carrierScript(carrier: Carrier, extraArgs: string, comment: string): { unix: string; cmd: string } {
    return shellScripts(carrier.command, carrier.args, extraArgs, `${comment} ${CARRIER_MARK} ${carrier.command}`, false);
}

/**
 * Keeps the Node the existing wrapper uses while it still works: VS Code and the CLI may find
 * different Node binaries, and they should not keep rewriting each other's wrapper.
 */
function preferExistingNode(launcher: string, found: NodeRuntime): NodeRuntime {
    const existingScript = readOrEmpty(launcher);
    // A carrier is not a Node binary: never run it to ask its Node version.
    if (existingScript.includes(CARRIER_MARK)) return found;
    const match = /^(ELECTRON_RUN_AS_NODE=1 )?exec "([^"]+)"/m.exec(existingScript);
    if (!match) return found;
    const existing: NodeRuntime = { path: match[2], electron: Boolean(match[1]) };
    if (existing.path === found.path || !existsSync(existing.path) || stableNodePath(existing.path) !== existing.path) return found;
    const version = nodeVersion(existing.path, existing.electron ? { ...process.env, ELECTRON_RUN_AS_NODE: '1' } : undefined);
    return (version ?? 0) >= 20 ? existing : found;
}

function readOrEmpty(file: string): string {
    try {
        return readFileSync(file, 'utf8');
    } catch {
        return '';
    }
}

function launcherPath(home: string): string {
    return join(home, 'bin', process.platform === 'win32' ? 'nova-ai-browser-host.bat' : 'nova-ai-browser-host');
}

function writeScripts(path: string, scripts: { unix: string; cmd: string }): boolean {
    return process.platform === 'win32' ? writeIfChanged(path, scripts.cmd) : writeIfChanged(path, scripts.unix, 0o755);
}

function writeLauncher(home: string, found: NodeRuntime, cli: string): { path: string; changed: boolean; node: NodeRuntime } {
    const path = launcherPath(home);
    const node = process.platform === 'win32' ? found : preferExistingNode(path, found);
    const changed = writeScripts(path, launcherScript(node, cli, '', 'Nova AI Browser native messaging host.'));
    return { path, changed, node };
}

function writeCarrierLauncher(home: string, carrier: Carrier): { path: string; changed: boolean } {
    const path = launcherPath(home);
    return { path, changed: writeScripts(path, carrierScript(carrier, '', 'Nova AI Browser native messaging host.')) };
}

/** Whether the current registration runs this carrier (so it may remove it). */
export function registeredCarrier(carrier: Carrier): boolean {
    const script = readOrEmpty(launcherPath(homeDir()));
    return script.includes(CARRIER_MARK) && script.includes(`"${carrier.command}"`);
}

function manifest(launcher: string, extensionIds: string[]): string {
    return `${JSON.stringify({
        name: HOST_NAME,
        description: 'Nova AI Browser: lets VS Code, Claude Code and ACP agents use your browser through Nova.',
        path: launcher,
        type: 'stdio',
        allowed_origins: extensionIds.map((id) => `chrome-extension://${id}/`)
    }, null, 2)}\n`;
}

// ---------------------------------------------------------------------------------------------

export function install(options: InstallOptions): InstallResult {
    const home = ensureHomeDir();
    const installed = installedVersion();
    // Auto mode never replaces a newer host (e.g. a newer VS Code extension installed it).
    const useThis = !options.auto || !installed || compareVersions(VERSION, installed) >= 0;
    const version = useThis ? VERSION : installed!;
    let changed = false;
    if (useThis) {
        if (options.carrier) {
            changed = writeCarrier(VERSION, options.carrier);
        } else {
            changed = copyRuntime(VERSION);
            // Of two apps carrying the same version, the one that installed last runs it.
            const carrierFile = join(runtimeDir(VERSION), CARRIER_FILE);
            if (existsSync(carrierFile)) {
                rmSync(carrierFile);
                changed = true;
            }
        }
        pruneRuntimes(VERSION);
    }

    const carrier = readCarrier(version);
    let node: NodeRuntime = { path: '', electron: false };
    let launcher: { path: string; changed: boolean };
    if (carrier) {
        launcher = writeCarrierLauncher(home, carrier);
    } else {
        const written = writeLauncher(home, resolveNode(), join(runtimeDir(version), 'dist', 'cli.js'));
        node = written.node;
        launcher = written;
    }
    changed ||= launcher.changed;

    const ids = options.extensionIds.length ? options.extensionIds : [DEV_EXTENSION_ID];
    const body = manifest(launcher.path, ids);
    const browsers: string[] = [];
    const newBrowsers: string[] = [];

    if (process.platform === 'win32') {
        const manifestPath = join(home, `${HOST_NAME}.json`);
        changed = writeIfChanged(manifestPath, body) || changed;
        for (const target of browserTargets()) {
            const key = `HKCU\\${target.registry}\\NativeMessagingHosts\\${HOST_NAME}`;
            let existing = '';
            try {
                existing = execFileSync('reg', ['query', key, '/ve'], { encoding: 'utf8' });
            } catch {
                // Not registered yet.
            }
            if (!existing.includes(manifestPath)) {
                execFileSync('reg', ['add', key, '/ve', '/t', 'REG_SZ', '/d', manifestPath, '/f'], { stdio: 'ignore' });
                newBrowsers.push(target.name);
                changed = true;
            }
            browsers.push(target.name);
        }
        return { version, usedThisVersion: useThis, changed, browsers, newBrowsers, node: node.path, nodeIsElectron: node.electron, ...(carrier ? { carrier } : {}) };
    }

    const dirs = [
        ...browserTargets().filter((target) => target.dir && existsSync(target.dir)).map((target) => ({ name: target.name, dir: target.dir! })),
        ...options.userDataDirs.map((dir) => ({ name: dir, dir }))
    ];
    for (const { name, dir } of dirs) {
        const file = join(dir, 'NativeMessagingHosts', `${HOST_NAME}.json`);
        const isNew = !existsSync(file);
        if (writeIfChanged(file, body)) {
            changed = true;
            if (isNew) newBrowsers.push(name);
        }
        browsers.push(name);
    }
    return { version, usedThisVersion: useThis, changed, browsers, newBrowsers, node: node.path, nodeIsElectron: node.electron, ...(carrier ? { carrier } : {}) };
}

/**
 * Removes the registration. With a carrier, only when the registration runs that carrier: an app
 * that stops carrying the host must not remove one that Nova AI for VS Code or the CLI installed.
 */
export function uninstall(options: Pick<InstallOptions, 'userDataDirs' | 'carrier'>): string[] {
    if (options.carrier && !registeredCarrier(options.carrier)) return [];
    const removed: string[] = [];
    if (process.platform === 'win32') {
        for (const target of browserTargets()) {
            try {
                execFileSync('reg', ['delete', `HKCU\\${target.registry}\\NativeMessagingHosts\\${HOST_NAME}`, '/f'], { stdio: 'ignore' });
                removed.push(target.name);
            } catch {
                // Not registered for this browser.
            }
        }
        // A running host keeps its runtime files open on Windows, so only a carrier cleans up
        // (its records and wrapper are not in use).
        if (options.carrier) {
            removeCarriers();
            rmSync(launcherPath(homeDir()), { force: true });
        }
        return removed;
    }
    const dirs = [...browserTargets().map((t) => ({ name: t.name, dir: t.dir! })), ...options.userDataDirs.map((dir) => ({ name: dir, dir }))];
    for (const { name, dir } of dirs) {
        const file = join(dir, 'NativeMessagingHosts', `${HOST_NAME}.json`);
        if (existsSync(file)) {
            rmSync(file);
            removed.push(name);
        }
    }
    if (options.carrier) removeCarriers();
    else rmSync(runtimesDir(), { recursive: true, force: true });
    rmSync(join(homeDir(), 'bin'), { recursive: true, force: true });
    return removed;
}

/**
 * A carrier takes away only its own records: Node runtimes that Nova AI for VS Code or the CLI
 * copied stay, so their next start registers them again without copying.
 */
function removeCarriers(): void {
    let versions: string[];
    try {
        versions = readdirSync(runtimesDir());
    } catch {
        return;
    }
    for (const version of versions) {
        rmSync(join(runtimeDir(version), CARRIER_FILE), { force: true });
        try {
            if (!readdirSync(runtimeDir(version)).length) rmSync(runtimeDir(version), { recursive: true, force: true });
        } catch {
            // Not a folder.
        }
    }
}
