import { changesPage } from '@datalabrotterdam/nova-ai-browser-protocol';
import { ASK_USER } from './ask';
import { TODO_WRITE } from './todos';

/**
 * Why a call is refused in read-only ("Ask") mode, or undefined when it may run. The model gets this
 * text back as the tool result.
 */
export function readOnlyRefusal(name: string, args: Record<string, unknown>): string | undefined {
    if (name === ASK_USER || name === TODO_WRITE || !changesPage(name, args)) return undefined;
    return `Read-only mode is on: ${name === 'computer' ? `computer ${String(args.action)}` : name} would change the page, so it was not run. ` +
        'Read, find and report instead, and tell the user that read-only mode is on if they asked you to change something.';
}
