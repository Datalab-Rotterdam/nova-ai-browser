/*
 * Presentation grouping of an answer's steps (the model's thinking and tool calls).
 * Ported from nova-ai-vscode `src/panel/steps.ts`; keep the two in sync. Consecutive steps fold
 * into one line that expands; the line says what Nova is doing now, or what it did.
 */
import type { ChatItem } from './chat.svelte';
import { toolDetail, toolTitle } from './components/toolLabels';

/** A step of an answer that is not text: the model's thinking or a tool it called. */
export type StepItem = Extract<ChatItem, { kind: 'thinking' }> | Extract<ChatItem, { kind: 'tool' }>;

/** One entry of the rendered conversation: a single item, or a group of steps. */
export type ConversationEntry =
    | { kind: 'item'; item: ChatItem; index: number }
    | {
        kind: 'group';
        /** Id of the group's first step, used as the list key. */
        id: number;
        /** Position of the first step in the chat's items, for the reply header above it. */
        first: number;
        steps: StepItem[];
        /** Number of failed tools in the group. */
        failed: number;
    };

const isStep = (item: ChatItem): item is StepItem => item.kind === 'thinking' || item.kind === 'tool';
/** An assistant message without text does not end a group (some models send a blank one). */
const isBlankAssistant = (item: ChatItem) => item.kind === 'assistant' && !item.text.trim();
const isFailed = (step: StepItem) => step.kind === 'tool' && Boolean(step.result?.isError);

/**
 * Groups consecutive steps (thinking, tool calls) into one expandable row. Anything else
 * (answer text, a user message, a question, a permission prompt, a notice) ends the group;
 * the steps keep their order. A single step stays on its own.
 */
export function groupItems(items: readonly ChatItem[]): ConversationEntry[] {
    const result: ConversationEntry[] = [];
    let run: { index: number; item: StepItem }[] = [];
    const flush = () => {
        if (run.length === 1) {
            result.push({ kind: 'item', item: run[0].item, index: run[0].index });
        } else if (run.length > 1) {
            const steps = run.map((entry) => entry.item);
            result.push({ kind: 'group', id: steps[0].id, first: run[0].index, steps, failed: steps.filter(isFailed).length });
        }
        run = [];
    };
    items.forEach((item, index) => {
        if (isStep(item)) {
            run.push({ index, item });
        } else if (!isBlankAssistant(item)) {
            flush();
            result.push({ kind: 'item', item, index });
        }
    });
    flush();
    return result;
}

/** A step that is still going: thinking not yet finished, or a tool without a result. */
export const isStepActive = (step: StepItem): boolean =>
    step.kind === 'thinking' ? step.durationMs === undefined : !step.result;

/** "Thought for 8 seconds" and the like, for thinking that took `durationMs`. */
export function thoughtFor(durationMs: number | null): string {
    if (durationMs === null) return 'Thought';
    const seconds = durationMs / 1000;
    if (seconds < 1) return 'Thought for less than a second';
    const rounded = seconds < 10 ? seconds.toFixed(1) : String(Math.round(seconds));
    return `Thought for ${rounded} ${rounded === '1.0' ? 'second' : 'seconds'}`;
}

/** The last line of some thinking, as plain text, for a one-line glimpse of it. */
function lastLine(text: string, max = 90): string {
    const line = text
        .split('\n')
        .map((item) => item.replace(/[#*_`>]+/g, '').trim())
        .filter(Boolean)
        .at(-1) ?? '';
    return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/**
 * The group's summary line. While it runs: what Nova is doing now ("Thinking: …",
 * "Navigate · example.com"). Afterwards, what it did: "Thought for 8 seconds, Navigate, Click and 2 more".
 */
export function stepsLine(steps: readonly StepItem[], running: boolean): string {
    const current = [...steps].reverse().find(isStepActive) ?? steps.at(-1);
    if (running && current) {
        if (current.kind === 'thinking') {
            const glimpse = lastLine(current.text);
            return glimpse ? `Thinking: ${glimpse}` : 'Thinking';
        }
        const title = toolTitle(current.call.name, current.call.args);
        const detail = toolDetail(current.call.name, current.call.args);
        return detail ? `${title} · ${detail}` : title;
    }
    const thinking = steps.filter((step) => step.kind === 'thinking');
    const thought = thinking.length
        ? thoughtFor(thinking.some((step) => step.durationMs === undefined) ? null : thinking.reduce((total, step) => total + (step.durationMs ?? 0), 0))
        : null;
    const titles = [...new Set(steps.flatMap((step) => (step.kind === 'tool' ? [toolTitle(step.call.name, step.call.args)] : [])))];
    const shown = [...(thought ? [thought] : []), ...titles].slice(0, 3);
    const more = (thought ? 1 : 0) + titles.length - shown.length;
    const line = more > 0 ? `${shown.join(', ')} and ${more} more` : shown.join(', ');
    const failed = steps.filter(isFailed).length;
    return failed ? `${line} · ${failed} failed` : line;
}
