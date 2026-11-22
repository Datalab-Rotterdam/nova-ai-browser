/**
 * Developer tools (the side panel's tool tester and its `debug` caller, which skips the site
 * prompt) exist in every build except the Chrome Web Store one (`vite build --mode store`).
 * Vite inlines the mode, so the store bundle drops them entirely.
 */
export const DEV_TOOLS = import.meta.env.MODE !== 'store';

/**
 * `javascript_tool` (and its "Let Nova run scripts on pages" setting) runs model-supplied code in a
 * page, which the Chrome Web Store counts as remote code. The store build leaves it out entirely.
 */
export const PAGE_SCRIPTS = import.meta.env.MODE !== 'store';
