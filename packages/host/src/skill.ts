/**
 * Installs the nova-browser skill (skill/nova-browser in this package) into agents' skill
 * folders. Nova AI (VS Code and CLI) reads ~/.nova-ai/skills and also the shared .agents,
 * .claude and .codex folders, so one copy in Nova's folder is enough for Nova.
 *
 * It is a *bundled* skill (docs/NOVA_HOME.md, "Bundled skills" in nova-ai-vscode): the folder
 * holds a `.nova-bundled.json` marker, its files are read-only, and every install (each start
 * of a Nova app) restores it when its content was changed and replaces it on updates. Users can
 * only switch it off, by name in Nova's settings, which updates keep.
 */
import { createHash } from 'node:crypto';
import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toolsReference } from './call';
import { launcherScript, type NodeRuntime } from './install';
import { novaHome } from './paths';
import { VERSION } from './version';

export const SKILL_NAME = 'nova-browser';
/** Marks a skill as bundled: shipped and kept up to date by a Nova app, read-only for users. */
export const BUNDLE_FILE = '.nova-bundled.json';
export const BUNDLED_BY = 'Nova AI Browser';

export interface BundleInfo {
    bundledBy: string;
    version: string;
    /** SHA-256 over the skill's files (paths and contents), to notice edits. */
    hash: string;
}

export const SKILL_TARGETS = ['nova', 'agents', 'claude', 'codex'] as const;
export type SkillTarget = typeof SKILL_TARGETS[number];

export function skillsFolder(target: SkillTarget): string {
    const home = homedir();
    switch (target) {
        case 'nova': return join(novaHome(), 'skills');
        case 'agents': return join(home, '.agents', 'skills');
        case 'claude': return join(home, '.claude', 'skills');
        case 'codex': return join(process.env.CODEX_HOME?.trim() || join(home, '.codex'), 'skills');
    }
}

function packageRoot(): string {
    // dist/cli.js → package root
    return dirname(dirname(fileURLToPath(import.meta.url)));
}

export interface SkillRuntime {
    /** Root of the host runtime whose skill/ is copied and whose dist/cli.js the launcher runs. */
    root: string;
    node: NodeRuntime;
}

function readOrEmpty(file: string): string {
    try {
        return readFileSync(file, 'utf8');
    } catch {
        return '';
    }
}

export function parseSkillTargets(value: string | undefined): SkillTarget[] {
    if (!value) return ['nova'];
    if (value === 'none') return [];
    if (value === 'all') return [...SKILL_TARGETS];
    const targets = value.split(',').map((part) => part.trim()).filter(Boolean);
    for (const target of targets) {
        if (!(SKILL_TARGETS as readonly string[]).includes(target)) {
            throw new Error(`Unknown skill target "${target}". Use ${SKILL_TARGETS.join(', ')}, all or none.`);
        }
    }
    return targets as SkillTarget[];
}

function readBundle(dir: string): BundleInfo | undefined {
    try {
        const info = JSON.parse(readFileSync(join(dir, BUNDLE_FILE), 'utf8')) as BundleInfo;
        return info.bundledBy === BUNDLED_BY ? info : undefined;
    } catch {
        return undefined;
    }
}

/** Whether the folder holds a copy this package installed (never touch anyone else's skill). */
function isOurs(dir: string): boolean {
    return readBundle(dir) !== undefined;
}

function listFiles(dir: string): string[] {
    const files: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) files.push(...listFiles(full));
        else if (entry.isFile()) files.push(full);
    }
    return files;
}

/** Hash of every file except the marker, so any edit, addition or removal shows. */
export function skillHash(dir: string): string {
    const hash = createHash('sha256');
    for (const file of listFiles(dir).sort()) {
        const name = relative(dir, file).split('\\').join('/');
        if (name === BUNDLE_FILE) continue;
        hash.update(name).update('\0').update(readFileSync(file)).update('\0');
    }
    return hash.digest('hex');
}

/** Read-only for everyone: files 0444 (scripts 0555), folders 0555. */
function lock(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) lock(full);
        else if (entry.isFile()) chmodSync(full, (statSync(full).mode & 0o111) ? 0o555 : 0o444);
    }
    chmodSync(dir, 0o555);
}

/** Makes a locked copy writable again so it can be replaced or removed. */
function unlock(dir: string): void {
    if (!existsSync(dir)) return;
    chmodSync(dir, 0o755);
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) unlock(full);
        else if (entry.isFile()) chmodSync(full, 0o644);
    }
}

/**
 * Installs the skill where it is missing, outdated or changed; returns the folders it wrote.
 * Leaves a current, unchanged copy alone, and never touches another skill with the same name.
 */
export function installSkill(targets: readonly SkillTarget[], runtime: SkillRuntime = { root: packageRoot(), node: { path: process.execPath, electron: false } }): string[] {
    const source = join(runtime.root, 'skill', SKILL_NAME);
    if (!existsSync(join(source, 'SKILL.md'))) {
        throw new Error(`Skill files missing at ${source}.`);
    }
    // Agents run this from any shell: absolute paths, no reliance on PATH (nvm, volta, …).
    const scripts = launcherScript(runtime.node, join(runtime.root, 'dist', 'cli.js'), 'call', 'Nova AI Browser: run a browser tool. Usage: nova-browser <tool> [key=value ...]');
    const installed: string[] = [];
    for (const target of targets) {
        const dir = join(skillsFolder(target), SKILL_NAME);
        if (existsSync(dir) && !isOurs(dir)) {
            console.warn(`Skipped ${dir}: a different skill named ${SKILL_NAME} is already there.`);
            continue;
        }
        const bundle = readBundle(dir);
        const current = bundle?.version === VERSION
            && bundle.hash === skillHash(dir)
            && readOrEmpty(join(dir, 'scripts', 'nova-browser')) === scripts.unix
            && readOrEmpty(join(dir, 'SKILL.md')) === readOrEmpty(join(source, 'SKILL.md'))
            && readOrEmpty(join(dir, 'references', 'tools.md')) === toolsReference();
        if (current) continue;

        unlock(dir);
        rmSync(dir, { recursive: true, force: true });
        mkdirSync(dirname(dir), { recursive: true });
        cpSync(source, dir, { recursive: true });
        mkdirSync(join(dir, 'scripts'), { recursive: true });
        writeFileSync(join(dir, 'scripts', 'nova-browser'), scripts.unix);
        chmodSync(join(dir, 'scripts', 'nova-browser'), 0o755);
        writeFileSync(join(dir, 'scripts', 'nova-browser.cmd'), scripts.cmd);
        mkdirSync(join(dir, 'references'), { recursive: true });
        writeFileSync(join(dir, 'references', 'tools.md'), toolsReference());
        const info: BundleInfo = { bundledBy: BUNDLED_BY, version: VERSION, hash: skillHash(dir) };
        writeFileSync(join(dir, BUNDLE_FILE), `${JSON.stringify(info, null, 2)}\n`);
        lock(dir);
        installed.push(dir);
    }
    return installed;
}

/** Removes skill copies this package installed (never another skill with the same name). */
export function uninstallSkill(): string[] {
    const removed: string[] = [];
    for (const target of SKILL_TARGETS) {
        const dir = join(skillsFolder(target), SKILL_NAME);
        if (existsSync(dir) && isOurs(dir)) {
            unlock(dir);
            rmSync(dir, { recursive: true, force: true });
            removed.push(dir);
        }
    }
    return removed;
}

export function installedSkillVersion(target: SkillTarget): string | undefined {
    return readBundle(join(skillsFolder(target), SKILL_NAME))?.version;
}
