/**
 * The `ask_user` tool: Nova asks the user a question in the side panel and waits for the answer.
 * Ported from nova-ai-vscode `src/agent/tools/interactionTools.ts`; keep the two in sync.
 *
 * Only the side panel's own agent has it. External agents (MCP, ACP) ask their user themselves.
 */
import type { ToolDefinition } from '@datalabrotterdam/nova-ai-browser-protocol';

export const ASK_USER = 'ask_user';

export interface QuestionOption {
    label: string;
    /** What choosing this option means. */
    description?: string;
    /** Nova's suggestion; shown with a badge and pre-selected. */
    recommended?: boolean;
}

export interface Question {
    question: string;
    options: QuestionOption[];
    /** Several options may be picked. */
    multiSelect: boolean;
    /** A free-text answer is allowed besides the options. */
    allowOther: boolean;
}

const MAX_OPTIONS = 8;

export const ASK_USER_TOOL: ToolDefinition = {
    name: ASK_USER,
    readOnly: true,
    description:
        'Ask the user a question in the side panel and wait for the answer. Use it when a decision really needs the user ' +
        '(ambiguous request, a choice between options you found, missing information, confirming something hard to undo) ' +
        'or when the user has to act in the page first (log in, solve a CAPTCHA, enter payment details): ask them to tell you when they are done. ' +
        'Do not use it for things you can find out yourself. Prefer 2-5 concrete options, each with a one-line description, ' +
        'and mark the option you recommend with recommended: true (at most one, unless multiSelect). ' +
        'Set multiSelect for "pick all that apply". The user can always type their own answer unless allowOther is false.',
    inputSchema: {
        type: 'object',
        properties: {
            question: { type: 'string', description: 'The question, ending with a question mark.' },
            options: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        label: { type: 'string', description: 'Short option text.' },
                        description: { type: 'string', description: 'One line on what choosing this option means.' },
                        recommended: { type: 'boolean', description: 'True for the option you recommend.' }
                    },
                    required: ['label']
                }
            },
            multiSelect: { type: 'boolean', description: 'Allow picking several options.' },
            allowOther: { type: 'boolean', description: 'Allow a free-text answer. Defaults to true.' }
        },
        required: ['question']
    }
};

/** Validates and cleans the model's arguments; throws with a message for the model when unusable. */
export function parseQuestion(args: Record<string, unknown>): Question {
    const question = typeof args.question === 'string' ? args.question.trim() : '';
    if (!question) {
        throw new Error('A "question" is required.');
    }
    const options = (Array.isArray(args.options) ? args.options : [])
        .map((option: unknown) => (typeof option === 'string' ? { label: option } : option) as Partial<QuestionOption> | null)
        .filter((option): option is QuestionOption => Boolean(option && typeof option.label === 'string' && option.label.trim()))
        .slice(0, MAX_OPTIONS)
        .map((option) => ({
            label: option.label.trim(),
            ...(typeof option.description === 'string' && option.description.trim() ? { description: option.description.trim() } : {}),
            ...(option.recommended === true ? { recommended: true } : {})
        }));
    // Labels identify the options in the panel: drop duplicates.
    const unique = options.filter((option, index) => options.findIndex((other) => other.label === option.label) === index);
    const multiSelect = args.multiSelect === true && unique.length > 1;
    // A single-choice question has at most one recommendation.
    if (!multiSelect) {
        let seen = false;
        for (const option of unique) {
            if (option.recommended && seen) delete option.recommended;
            seen ||= Boolean(option.recommended);
        }
    }
    return {
        question,
        options: unique,
        multiSelect,
        // Without options the only way to answer is free text.
        allowOther: args.allowOther !== false || unique.length === 0
    };
}

/** What the model reads back. */
export function answerText(answer: string | undefined): string {
    return answer === undefined
        ? 'The user skipped the question. Make a reasonable choice yourself and say which one you made; do not do anything hard to undo without asking again.'
        : `The user answered: ${answer}`;
}
