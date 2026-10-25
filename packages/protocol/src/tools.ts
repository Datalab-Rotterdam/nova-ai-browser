import type { ToolDefinition } from './types';

const tabId = {
    type: 'number',
    description: 'ID of a tab in the Nova tab group. Get IDs from tabs_context.'
};

const coordinate = {
    type: 'array',
    items: { type: 'number' },
    minItems: 2,
    maxItems: 2,
    description: '(x, y) in pixels of the most recent screenshot of this tab.'
};

export const COMPUTER_ACTIONS = [
    'screenshot',
    'left_click',
    'right_click',
    'middle_click',
    'double_click',
    'triple_click',
    'hover',
    'left_click_drag',
    'type',
    'key',
    'scroll',
    'scroll_to',
    'zoom',
    'wait'
] as const;

export type ComputerAction = typeof COMPUTER_ACTIONS[number];

/** Computer actions that only look at the page. */
export const READ_ONLY_COMPUTER_ACTIONS: ReadonlySet<string> = new Set(['screenshot', 'zoom', 'wait', 'scroll', 'scroll_to', 'hover']);

export const TOOL_DEFINITIONS: readonly ToolDefinition[] = [
    {
        name: 'tabs_context',
        readOnly: true,
        description: 'List the tabs in the Nova tab group (id, url, title, active). Call this first: when the group does not exist yet it is created around the current tab. Only tabs in this group can be controlled.',
        inputSchema: { type: 'object', properties: {} }
    },
    {
        name: 'tabs_create',
        readOnly: false,
        description: 'Open a new tab in the Nova tab group and return its id.',
        inputSchema: {
            type: 'object',
            properties: { url: { type: 'string', description: 'URL to open. Defaults to a blank tab.' } }
        }
    },
    {
        name: 'tabs_close',
        readOnly: false,
        description: 'Close a tab in the Nova tab group.',
        inputSchema: { type: 'object', properties: { tabId }, required: ['tabId'] }
    },
    {
        name: 'navigate',
        readOnly: false,
        description: 'Go to a URL in a tab and wait for it to load. Use "back" or "forward" to move through history.',
        inputSchema: {
            type: 'object',
            properties: {
                tabId,
                url: { type: 'string', description: 'Absolute URL, a bare domain (https:// is added), "back" or "forward".' }
            },
            required: ['tabId', 'url']
        }
    },
    {
        name: 'computer',
        readOnly: false,
        description: [
            'Use a mouse and keyboard in a tab, and take screenshots. A visible cursor shows the user what you do.',
            '* Coordinates are pixels of the latest screenshot of that tab; take a screenshot before clicking by coordinate.',
            '* Prefer `ref` from read_page or find over coordinates: it is exact and survives scrolling.',
            '* Click in the center of elements. After a click that navigates, take a new screenshot or read_page.',
            '* `key` takes space-separated combos like "Enter", "ctrl+a", "cmd+shift+k" (cmd is mapped to ctrl off macOS).',
            '* `zoom` returns a close-up of `region` [x0, y0, x1, y1] for reading small text.',
            '* `screenshot` with `full_page: true` captures the whole scrollable page in one image (for looking, not for click coordinates).'
        ].join('\n'),
        inputSchema: {
            type: 'object',
            properties: {
                tabId,
                action: { type: 'string', enum: [...COMPUTER_ACTIONS] },
                coordinate,
                ref: { type: 'string', description: 'Element reference like "ref_12" from read_page or find. Use instead of coordinate.' },
                start_coordinate: { ...coordinate, description: 'Start of a left_click_drag.' },
                text: { type: 'string', description: 'Text for `type`, key combos for `key`.' },
                modifiers: { type: 'string', description: 'Modifier keys held during a click, e.g. "shift" or "ctrl+shift".' },
                scroll_direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] },
                scroll_amount: { type: 'number', description: 'Scroll steps (default 3). One step is about 100px.' },
                full_page: { type: 'boolean', description: 'With screenshot: capture the whole scrollable page instead of the visible part.' },
                region: { type: 'array', items: { type: 'number' }, minItems: 4, maxItems: 4, description: '[x0, y0, x1, y1] for zoom.' },
                duration: { type: 'number', description: 'Seconds for `wait` (max 10).' },
                repeat: { type: 'number', description: 'How many times to press the key combos (default 1).' }
            },
            required: ['tabId', 'action']
        }
    },
    {
        name: 'read_page',
        readOnly: true,
        description: 'Read the page as an accessibility tree with element refs (e.g. `button "Sign in" [ref_12]`). Use refs with computer, form_input and scroll_to. Password and payment fields are redacted.',
        inputSchema: {
            type: 'object',
            properties: {
                tabId,
                filter: { type: 'string', enum: ['interactive', 'all'], description: '"interactive" (default) lists controls only; "all" includes headings and text.' },
                ref: { type: 'string', description: 'Only read the subtree of this element.' },
                max_chars: { type: 'number', description: 'Output budget (default 20000).' }
            },
            required: ['tabId']
        }
    },
    {
        name: 'find',
        readOnly: true,
        description: 'Find elements matching a description (e.g. "search box", "add to cart button") and return them with refs.',
        inputSchema: {
            type: 'object',
            properties: { tabId, query: { type: 'string' } },
            required: ['tabId', 'query']
        }
    },
    {
        name: 'form_input',
        readOnly: false,
        description: 'Set the value of a form element by ref: text inputs, textareas, selects (option text or value), checkboxes and radios (true/false).',
        inputSchema: {
            type: 'object',
            properties: {
                tabId,
                ref: { type: 'string' },
                value: { type: ['string', 'boolean', 'number'] }
            },
            required: ['tabId', 'ref', 'value']
        }
    },
    {
        name: 'get_page_text',
        readOnly: true,
        description: 'Get the readable text of the page (main content first). Good for articles and search results.',
        inputSchema: {
            type: 'object',
            properties: { tabId, max_chars: { type: 'number', description: 'Output budget (default 30000).' } },
            required: ['tabId']
        }
    },
    {
        name: 'javascript_tool',
        readOnly: false,
        description: 'Run JavaScript in the page and return the result of the last expression (JSON). Disabled unless the user enabled it in settings.',
        inputSchema: {
            type: 'object',
            properties: { tabId, code: { type: 'string' } },
            required: ['tabId', 'code']
        }
    },
    {
        name: 'read_console_messages',
        readOnly: true,
        description: 'Read console messages and uncaught errors of a tab since Nova attached to it.',
        inputSchema: {
            type: 'object',
            properties: {
                tabId,
                pattern: { type: 'string', description: 'Regex to filter messages.' },
                only_errors: { type: 'boolean' },
                clear: { type: 'boolean', description: 'Clear the buffer after reading.' }
            },
            required: ['tabId']
        }
    },
    {
        name: 'read_network_requests',
        readOnly: true,
        description: 'List network requests of a tab (method, url, status, type) since Nova attached to it.',
        inputSchema: {
            type: 'object',
            properties: {
                tabId,
                url_pattern: { type: 'string', description: 'Substring or regex the URL must match.' },
                clear: { type: 'boolean' }
            },
            required: ['tabId']
        }
    },
    {
        name: 'resize_window',
        readOnly: false,
        description: 'Resize the browser window of a tab.',
        inputSchema: {
            type: 'object',
            properties: { tabId, width: { type: 'number' }, height: { type: 'number' } },
            required: ['tabId', 'width', 'height']
        }
    }
];

export const TOOL_NAMES = TOOL_DEFINITIONS.map((tool) => tool.name);

export function getToolDefinition(name: string): ToolDefinition | undefined {
    return TOOL_DEFINITIONS.find((tool) => tool.name === name);
}

/** Whether this particular call only reads, taking `computer` actions into account. */
export function isReadOnlyCall(name: string, args: Record<string, unknown>): boolean {
    if (name === 'computer') {
        return READ_ONLY_COMPUTER_ACTIONS.has(String(args.action));
    }
    return getToolDefinition(name)?.readOnly ?? false;
}
