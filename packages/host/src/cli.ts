/**
 * `nova-ai-browser-host`: installer and tools for Nova AI Browser (see HELP below).
 *
 * Browsers start it as `nova-ai-browser-host chrome-extension://<id>/` to run the host itself.
 */
import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCall } from './call';
import { runHost } from './host';
import { installSkill, parseSkillTargets, uninstallSkill } from './skill';
import { type Carrier, install, runtimeDir, uninstall } from './install';
import { liveHosts } from './hosts';
import { RpcClient } from './rpc';
import { VERSION } from './version';

const HELP = `nova-ai-browser-host ${VERSION}

  install [options]          register the host with installed browsers and install the
                             nova-browser skill
      --auto                 startup mode for Nova apps: quiet, never downgrades a newer host
      --json                 print the result as JSON
      --skills LIST          also install the skill for agents outside Nova: agents, claude,
                             codex, nova, all or none (comma-separated; default none, since
                             Nova apps install it from @datalabrotterdam/nova-ai-skills)
      --extension-id ID      allow another extension ID (repeatable; default: dev build)
      --user-data-dir DIR    also register for a custom browser profile folder (repeatable)
      --carrier PATH         an app that runs the host itself (no Node needed); browsers
                             start PATH with the --carrier-arg values (repeatable) first
  uninstall                  remove the registration and installed skills
      --carrier PATH         only when the registration runs this app
  status                     is a browser connected?
  call <tool> [key=value…]   run a browser tool (what the skill's nova-browser script does)
  config                     MCP config for VS Code and Claude Code`;

function values(args: string[], flag: string): string[] {
    const result: string[] = [];
    for (let i = 0; i < args.length; i++) {
        if (args[i] === flag && args[i + 1]) result.push(args[++i]);
        else if (args[i].startsWith(`${flag}=`)) result.push(args[i].slice(flag.length + 1));
    }
    return result;
}

/** `--carrier PATH [--carrier-arg ARG]…`: an app that runs the host itself (see install.ts). */
function carrierOption(args: string[]): Carrier | undefined {
    const command = values(args, '--carrier')[0];
    if (!command) return undefined;
    if (!isAbsolute(command)) throw new Error('--carrier needs an absolute path.');
    return { command, args: values(args, '--carrier-arg') };
}

function mcpCommand(): string {
    const local = join(fileURLToPath(new URL('.', import.meta.url)), 'mcp.js');
    return existsSync(local) ? `node ${JSON.stringify(local)}` : 'npx -y @datalabrotterdam/nova-ai-browser-host nova-ai-browser-mcp';
}

async function status(): Promise<number> {
    const hosts = liveHosts();
    if (!hosts.length) {
        console.log('No browser is connected. Open your browser with the Nova AI extension.');
        return 1;
    }
    let answering = 0;
    for (const info of hosts) {
        try {
            const rpc = await RpcClient.connect(info.socket);
            await rpc.request({ method: 'ping' }, 2_000);
            rpc.close();
            answering++;
            console.log(`Connected: ${info.browser ?? 'browser'} (host ${info.version}, pid ${info.pid}) for ${info.extensionOrigin}\nMCP over HTTP: ${info.mcpUrl}`);
        } catch {
            console.log(`Not answering: host pid ${info.pid}${info.browser ? ` (${info.browser})` : ''}; the browser may be quitting.`);
        }
    }
    if (hosts.length > 1) {
        console.log(`Agents use the browser that connected last (${hosts[0].browser ?? `pid ${hosts[0].pid}`}); set NOVA_AI_BROWSER_PID to pick another.`);
    }
    return answering ? 0 : 1;
}

async function main(argv: string[]): Promise<number> {
    const [command, ...rest] = argv;

    if (command?.startsWith('chrome-extension://')) {
        await runHost(command);
        return -1;
    }

    switch (command) {
        case 'install': {
            const auto = rest.includes('--auto');
            const json = rest.includes('--json');
            const targets = parseSkillTargets(values(rest, '--skills')[0]);
            const carrier = carrierOption(rest);
            const result = install({ extensionIds: values(rest, '--extension-id'), userDataDirs: values(rest, '--user-data-dir'), auto, carrier });
            // A carrier has the skill's files inside its own executable, not on disk: no skill yet.
            const skills = result.carrier ? [] : installSkill(targets, { root: runtimeDir(result.version), node: { path: result.node, electron: result.nodeIsElectron } });
            const summary = { ...result, changed: result.changed || skills.length > 0, skills };
            if (json) {
                console.log(JSON.stringify(summary));
                return 0;
            }
            if (!result.browsers.length) {
                console.log('No supported browser found. Pass --user-data-dir for a custom browser profile folder.');
                return 1;
            }
            if (!auto || summary.changed) {
                console.log(`Nova AI Browser host ${result.version} registered for: ${result.browsers.join(', ')}.`);
                for (const dir of skills) console.log(`Skill nova-browser installed in ${dir}`);
                if (result.newBrowsers.length) {
                    console.log(`Restart ${result.newBrowsers.join(', ')} once so it picks up the host (browsers read it at startup).`);
                }
            }
            return 0;
        }
        case 'uninstall': {
            const carrier = carrierOption(rest);
            const browsers = uninstall({ userDataDirs: values(rest, '--user-data-dir'), carrier });
            // The skill belongs to a Node install; an app carrying the host never installed it.
            const skills = carrier ? [] : uninstallSkill();
            console.log(browsers.length || skills.length
                ? [...browsers.map((b) => `Removed from ${b}.`), ...skills.map((d) => `Removed skill ${d}.`)].join('\n')
                : 'Nothing to remove.');
            return 0;
        }
        case 'call':
            return runCall(rest);
        case 'status':
            return status();
        case 'config': {
            const [cmd, ...cmdArgs] = mcpCommand().match(/"[^"]+"|\S+/g)!.map((part) => part.replace(/^"|"$/g, ''));
            console.log(JSON.stringify({
                vscode: { servers: { 'nova-browser': { type: 'stdio', command: cmd, args: cmdArgs } } },
                claudeCode: `claude mcp add nova-browser -- ${mcpCommand()}`
            }, null, 2));
            return 0;
        }
        case '--version':
        case 'version':
            console.log(VERSION);
            return 0;
        default:
            console.log(HELP);
            return command ? 1 : 0;
    }
}

const code = await main(process.argv.slice(2));
if (code >= 0) process.exit(code);
