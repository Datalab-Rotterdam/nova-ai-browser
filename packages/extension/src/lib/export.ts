import type { ChatItem } from '../sidepanel/chat.svelte';

/** A saved chat as Markdown: what the user and Nova said, and which tools Nova used. */
export function chatToMarkdown(title: string, items: readonly ChatItem[], updatedAt: number): string {
    const lines = [`# ${title || 'Nova chat'}`, '', `_${new Date(updatedAt).toISOString()}_`, ''];
    for (const item of items) {
        if (item.kind === 'user') lines.push(`**You:** ${item.text}`, '');
        else if (item.kind === 'assistant') lines.push(`**Nova:** ${item.text}`, '');
        else if (item.kind === 'tool') lines.push(`- Nova used \`${item.call.name}\``);
    }
    return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}
