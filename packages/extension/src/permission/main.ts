import type { PermissionDecision } from '@datalabrotterdam/nova-ai-browser-protocol';
import '../lib/theme.scss';
import markUrl from '../assets/nova-mark.svg?url';
import './permission.scss';

const params = new URLSearchParams(location.search);
const id = params.get('id') ?? '';
const kind = params.get('kind') === 'agent' ? 'agent' : params.get('kind') === 'upload' ? 'upload' : params.get('kind') === 'action' ? 'action' : 'site';
const agent = params.get('agent') || '';
const origin = params.get('origin') ?? '';

const title = document.getElementById('title')!;
const strong = document.createElement('strong');
if (kind === 'agent') {
    strong.textContent = agent || 'An agent';
    title.append(strong, ' wants to use your browser');
    document.getElementById('explain')!.textContent = 'It can then open tabs in the Nova group and read and use pages there. Each new site still needs your OK, and Stop on the page always works.';
    document.getElementById('summary')!.textContent = `First request: ${params.get('summary') ?? ''}`;
    document.getElementById('duration')!.textContent = '"Allow" lasts until the browser closes.';
    document.title = `${agent || 'An agent'} wants to use your browser`;
} else if (kind === 'upload') {
    const files = (params.get('files') ?? '').split('\n').filter(Boolean);
    strong.textContent = origin;
    title.append(agent ? `${agent}: upload ` : 'Upload ', files.length === 1 ? 'this file' : `${files.length} files`, ' to ', strong, '?');
    document.getElementById('explain')!.textContent = 'The site gets a copy. Only allow files you meant to send.';
    document.getElementById('summary')!.textContent = files.join('\n');
    document.getElementById('duration')!.textContent = 'Nova asks again for every upload.';
    document.querySelector<HTMLElement>('button[data-decision="always"]')?.remove();
    document.title = `Upload to ${origin}?`;
} else if (kind === 'action') {
    strong.textContent = origin;
    title.append(agent ? `${agent}: allow this on ` : 'Allow this on ', strong, '?');
    document.getElementById('explain')!.textContent = 'This may not be possible to undo, such as paying, sending or deleting.';
    document.getElementById('summary')!.textContent = params.get('element') ?? '';
    document.getElementById('duration')!.textContent = 'Nova asks again every time.';
    document.querySelector<HTMLElement>('button[data-decision="always"]')?.remove();
    document.title = `Confirm action on ${origin}`;
} else {
    strong.textContent = origin;
    title.append(agent ? `${agent}: let Nova use ` : 'Let Nova use ', strong, '?');
    document.getElementById('explain')!.textContent = agent ? `${agent} wants Nova to:` : 'Nova wants to:';
    document.getElementById('summary')!.textContent = params.get('summary') ?? '';
    document.getElementById('duration')!.textContent = '"Allow" lasts until the agent is done.';
    document.title = `Allow Nova on ${origin}?`;
}
document.querySelector<HTMLElement>('.mark')!.style.setProperty('--mark-url', `url("${markUrl}")`);

for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>('button[data-decision]'))) {
    button.addEventListener('click', async () => {
        const decision = button.dataset.decision as PermissionDecision;
        await chrome.runtime.sendMessage({ type: 'permission/answer', id, decision });
        window.close();
    });
}
