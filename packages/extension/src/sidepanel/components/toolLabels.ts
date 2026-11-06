/** What tool calls are called in the panel: a tool card's title, detail and icon, and the step group's line. */

const TITLES: Record<string, string> = {
    tabs_context: 'List tabs',
    tabs_create: 'Open tab',
    tabs_close: 'Close tab',
    navigate: 'Navigate',
    read_page: 'Read page',
    find: 'Find',
    form_input: 'Fill in',
    get_page_text: 'Read text',
    javascript_tool: 'Run JavaScript',
    read_console_messages: 'Read console',
    read_network_requests: 'Read network',
    resize_window: 'Resize window',
    wait_for: 'Wait for',
    extract_table: 'Extract table',
    highlight: 'Highlight',
    upload_file: 'Upload'
};

const ACTIONS: Record<string, string> = {
    screenshot: 'Screenshot', left_click: 'Click', right_click: 'Right-click', middle_click: 'Middle-click',
    double_click: 'Double-click', triple_click: 'Triple-click', hover: 'Hover', left_click_drag: 'Drag',
    type: 'Type', key: 'Press', scroll: 'Scroll', scroll_to: 'Scroll to', zoom: 'Zoom', wait: 'Wait'
};

const ICONS: Record<string, string> = {
    tabs_context: 'browser', tabs_create: 'add', tabs_close: 'close', navigate: 'globe', read_page: 'list-tree',
    find: 'search', form_input: 'edit', get_page_text: 'file-text', javascript_tool: 'terminal',
    read_console_messages: 'output', read_network_requests: 'radio-tower', resize_window: 'screen-full',
    wait_for: 'watch', extract_table: 'table', highlight: 'eye', upload_file: 'cloud-upload'
};

export function toolTitle(name: string, args: Record<string, unknown>): string {
    if (name === 'computer') {
        return args.action === 'screenshot' && args.full_page
            ? 'Full-page screenshot'
            : ACTIONS[String(args.action)] ?? String(args.action ?? 'Computer');
    }
    return TITLES[name] ?? name;
}

export function toolDetail(name: string, args: Record<string, unknown>): string {
    if (name === 'computer') {
        if (args.text) return String(args.text);
        if (args.ref) return String(args.ref);
        if (Array.isArray(args.coordinate)) return args.coordinate.map((n) => Math.round(Number(n))).join(', ');
        if (args.scroll_direction) return String(args.scroll_direction);
        return '';
    }
    if (name === 'navigate' || name === 'tabs_create') return String(args.url ?? '');
    if (name === 'find') return String(args.query ?? '');
    if (name === 'form_input') return `${String(args.ref ?? '')} = ${String(args.value ?? '')}`;
    if (name === 'wait_for') {
        const target = String(args.text ?? args.selector ?? args.ref ?? '');
        const idle = args.network_idle ? 'network idle' : '';
        return [target && (args.gone ? `${target} gone` : target), idle].filter(Boolean).join(' · ');
    }
    if (name === 'highlight') return String(args.label ?? args.text ?? args.ref ?? '');
    if (name === 'extract_table') return [args.index !== undefined ? `#${String(args.index)}` : String(args.ref ?? ''), String(args.format ?? '')].filter(Boolean).join(' ');
    if (name === 'upload_file') {
        const paths = Array.isArray(args.paths) ? args.paths : [args.paths];
        return paths.map((path) => String(path ?? '').split(/[\\/]/).pop()).filter(Boolean).join(', ');
    }
    return '';
}

/** Codicon name for the kind of call. */
export function toolIcon(name: string, args: Record<string, unknown>): string {
    if (name === 'computer') {
        if (args.action === 'screenshot' || args.action === 'zoom') return 'device-camera';
        return args.action === 'type' || args.action === 'key' ? 'keyboard' : 'target';
    }
    return ICONS[name] ?? 'tools';
}
