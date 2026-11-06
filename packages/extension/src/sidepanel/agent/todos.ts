/**
 * The `todo_write` tool: a task list Nova keeps for multi-step work, shown above the composer.
 * Ported from nova-ai-vscode `src/agent/tools/interactionTools.ts`; keep the two in sync.
 * Only the side panel's own agent has it.
 */
import type { ToolDefinition } from '@datalabrotterdam/nova-ai-browser-protocol';

export const TODO_WRITE = 'todo_write';

export interface TodoItem {
    content: string;
    status: 'pending' | 'in_progress' | 'completed';
}

const MAX_TODOS = 30;

export const TODO_WRITE_TOOL: ToolDefinition = {
    name: TODO_WRITE,
    readOnly: true,
    description:
        'Show and update a task list for multi-step work (3 or more steps, e.g. comparing several shops or filling a long form). ' +
        'Send the complete list every time. Statuses: pending, in_progress (exactly one at a time), completed. ' +
        'Mark items completed as soon as they are done. Skip it for simple one-step requests.',
    inputSchema: {
        type: 'object',
        properties: {
            todos: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        content: { type: 'string', description: 'Short, imperative task description.' },
                        status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] }
                    },
                    required: ['content', 'status']
                }
            }
        },
        required: ['todos']
    }
};

/** Validates and cleans the model's list; throws with a message for the model when unusable. */
export function parseTodos(args: Record<string, unknown>): TodoItem[] {
    if (!Array.isArray(args.todos)) {
        throw new Error('"todos" must be an array of { content, status }.');
    }
    return args.todos.slice(0, MAX_TODOS).map((todo: unknown, index) => {
        const item = (todo ?? {}) as { content?: unknown; status?: unknown };
        const content = typeof item.content === 'string' ? item.content.trim() : '';
        if (!content) {
            throw new Error(`Todo ${index + 1} needs a "content".`);
        }
        const status = item.status === 'in_progress' || item.status === 'completed' ? item.status : 'pending';
        return { content, status };
    });
}

/** What the model reads back. */
export function todosText(todos: readonly TodoItem[]): string {
    const done = todos.filter((todo) => todo.status === 'completed').length;
    const current = todos.find((todo) => todo.status === 'in_progress');
    return `Task list updated: ${done}/${todos.length} done${current ? `; in progress: ${current.content}` : ''}.`;
}
