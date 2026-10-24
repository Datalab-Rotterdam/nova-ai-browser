/** Replaced at build time with the package version. */
declare const __NOVA_HOST_VERSION__: string | undefined;

export const VERSION: string = typeof __NOVA_HOST_VERSION__ === 'string' ? __NOVA_HOST_VERSION__ : '0.0.0-dev';
