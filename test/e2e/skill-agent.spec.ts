/**
 * Does a Nova model find and follow the nova-browser skill? This harness mirrors the
 * nova-ai-vscode panel agent: the same skills section in the system prompt
 * (src/skills/skillTools.ts), a load_skill tool and a run_command tool, and nothing that
 * mentions the browser tools directly. Opt-in: NOVA_E2E_AGENT=1 and a Nova API key.
 */
import { chromium, expect, test } from '@playwright/test';
import { NovaAI, type ChatMessage } from '@datalabrotterdam/nova-sdk';
import { ChatStreamParser, createToolPayload, type ToolDefinition } from '@datalabrotterdam/nova-ai-browser-protocol';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hostInfoIn, removeTree } from './cleanup';
// @ts-expect-error plain ESM helper without types
import { serveFixtures } from '../serve-fixtures.mjs';

const EXTENSION = fileURLToPath(new URL('../../packages/extension/dist', import.meta.url));
const HOST_DIST = fileURLToPath(new URL('../../packages/host/dist', import.meta.url));
const CREDENTIALS = `${homedir()}/.nova-ai/credentials.json`;
const apiKey = process.env.NOVA_API_KEY ?? (existsSync(CREDENTIALS) ? JSON.parse(readFileSync(CREDENTIALS, 'utf8')).apiKey : undefined);

test.skip(!process.env.NOVA_E2E_AGENT || !apiKey, 'Set NOVA_E2E_AGENT=1 and a Nova API key to run the skill agent test.');
test.setTimeout(300_000);

const TOOLS: ToolDefinition[] = [
    {
        name: 'load_skill',
        readOnly: true,
        description: 'Load a skill\'s instructions (SKILL.md) or a file it refers to.',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Skill name from the list of available skills.' },
                resource: { type: 'string', description: 'Relative file inside the skill; defaults to SKILL.md.' }
            },
            required: ['name']
        }
    },
    {
        name: 'run_command',
        readOnly: false,
        description: 'Run a shell command and return its output.',
        inputSchema: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] }
    }
];

test('a Nova model uses the nova-browser skill to complete a browser task', async () => {
    const root = mkdtempSync(join(tmpdir(), 'nova-'));
    const home = join(root, 'home');
    const novaHome = join(root, 'nova');
    const profile = join(root, 'profile');
    // The harness plays nova-ai-vscode, so the skill script reports Visual Studio Code.
    const env = { ...process.env, HOME: root, NOVA_AI_BROWSER_HOME: home, NOVA_AI_HOME: novaHome, NOVA_BROWSER_CLIENT: 'Visual Studio Code' };
    execFileSync(process.execPath, [join(HOST_DIST, 'cli.js'), 'install', '--user-data-dir', profile], { env });

    const server = await serveFixtures(0);
    const base = `http://127.0.0.1:${server.address().port}`;
    const context = await chromium.launchPersistentContext(profile, {
        channel: process.env.NOVA_E2E_CHANNEL || 'chromium',
        headless: !process.env.NOVA_E2E_HEADED,
        viewport: null,
        env,
        args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`, '--window-size=1280,900']
    });

    try {
        const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
        // Approval prompts are covered in mcp.spec.ts; here the user already allowed VS Code and the site.
        const panel = await context.newPage();
        await panel.goto(`chrome-extension://${new URL(worker.url()).host}/src/sidepanel/index.html`);
        await panel.evaluate((origin) => chrome.storage.local.set({
            sitePermissions: { [origin]: 'always' },
            agentApprovals: { vscode: { name: 'Visual Studio Code', decision: 'always', decidedAt: new Date().toISOString() } }
        }), base);
        for (let i = 0; i < 50 && !hostInfoIn(home); i++) await new Promise((r) => setTimeout(r, 200));

        const page = await context.newPage();
        await page.goto(`${base}/index.html`);
        await page.bringToFront();

        const skillRoot = join(novaHome, 'skills', 'nova-browser');
        const skillMd = readFileSync(join(skillRoot, 'SKILL.md'), 'utf8');
        const description = /^description:\s*"(.+)"$/m.exec(skillMd)![1];

        // Same wording as nova-ai-vscode's buildSkillsPrompt.
        const system = [
            'You are Nova, a coding assistant. You can run shell commands with run_command.',
            '',
            'Skills provide specialized workflows through progressive disclosure.',
            'When the user explicitly names a skill or the task clearly matches one, call load_skill before acting and follow the returned instructions.',
            'Use load_skill again with a relative resource path when the SKILL.md references another file. Do not claim a skill was loaded until the tool succeeds.',
            'Available skills:',
            `- nova-browser: ${description.slice(0, 160)}`
        ].join('\n');

        const transcript: string[] = [];
        const runTool = (name: string, input: Record<string, unknown>): string => {
            if (name === 'load_skill') {
                const target = resolve(skillRoot, String(input.resource ?? 'SKILL.md'));
                if (relative(skillRoot, target).startsWith('..')) return 'Error: outside the skill.';
                return `Skill: nova-browser\nSkill root: ${skillRoot}\n\n${readFileSync(target, 'utf8')}`;
            }
            const result = spawnSync('/bin/sh', ['-c', String(input.command)], { env, encoding: 'utf8', timeout: 120_000 });
            return `exit ${result.status}\n${result.stdout}${result.stderr}`.slice(0, 12_000);
        };

        const client = new NovaAI({ apiKey });
        const tools = createToolPayload(TOOLS);
        const messages: ChatMessage[] = [
            { role: 'system', content: system },
            { role: 'user', content: 'In my browser, on the open "Nova fixture" page, click the Increment button twice and type "Grace" into the "Your name" field. Then tell me the count shown on the page.' }
        ];

        let answer = '';
        for (let round = 0; round < 25; round++) {
            let text = '';
            const calls: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];
            const parser = new ChatStreamParser({ callIdPrefix: `r${round}`, toolNames: tools.names }, {
                text: (value) => { text += value; },
                thinking: () => undefined,
                toolCall: (id, name, input) => calls.push({ id, name, input })
            });
            for await (const event of client.chat.completions.stream({ model: process.env.NOVA_E2E_MODEL ?? 'gemma4:26b', messages, ...tools.payload })) {
                if (event.type === 'chunk') parser.pushChunk(event.data);
            }
            parser.end();
            messages.push({
                role: 'assistant',
                content: text || null,
                ...(calls.length ? { tool_calls: calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.input) } })) } : {})
            });
            if (!calls.length) {
                answer = text;
                break;
            }
            for (const call of calls) {
                console.log(`[step ${round}] ${call.name} ${JSON.stringify(call.input).slice(0, 160)}`);
                const output = runTool(call.name, call.input);
                transcript.push(`> ${call.name} ${JSON.stringify(call.input)}\n${output.slice(0, 400)}`);
                messages.push({ role: 'tool', tool_call_id: call.id, content: output });
            }
        }

        console.log(`${transcript.join('\n\n')}\n\nANSWER: ${answer}`);
        expect(transcript[0]).toMatch(/^> load_skill/);
        expect(transcript.some((entry) => /scripts\/nova-browser/.test(entry))).toBe(true);
        await expect(page.locator('#count')).toHaveText('2');
        await expect(page.locator('#name')).toHaveValue('Grace');
        expect(answer).toMatch(/2/);
    } finally {
        await context.close();
        server.close();
        removeTree(root);
    }
});
