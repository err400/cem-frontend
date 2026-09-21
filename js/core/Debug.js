// Runtime switch: globalThis.DEBUG = true, or localStorage.setItem('DEBUG', 'true').
export function isDebugEnabled() {
    if (globalThis.DEBUG !== undefined) {
        return /^(1|true|yes|on)$/i.test(String(globalThis.DEBUG).trim());
    }
    try {
        const value = globalThis.localStorage?.getItem('DEBUG')
            ?? globalThis.localStorage?.getItem('debug') ?? globalThis.CEM_DEBUG;
        return /^(1|true|yes|on)$/i.test(String(value).trim());
    } catch {
        return globalThis.CEM_DEBUG === true;
    }
}

export function debug(event, details = {}) {
    if (isDebugEnabled()) console.debug('[cem.compute.ui]', event, details);
}

export async function debugFetch(input, options) {
    if (!isDebugEnabled()) return globalThis.fetch(input, options);
    const started = performance.now();
    const requestId = globalThis.crypto?.randomUUID?.() ?? String(started);
    let path = '<invalid-url>';
    try {
        path = new URL(typeof input === 'string' || input instanceof URL
            ? input : input.url, globalThis.location?.href).pathname;
    } catch { /* Logging must not change fetch error behavior. */ }
    const method = options?.method || input?.method || 'GET';
    debug('http.start', { requestId, method, path });
    try {
        const response = await globalThis.fetch(input, options);
        debug('http.finish', {
            requestId, method, path, status: response.status,
            elapsedMs: Math.round(performance.now() - started),
        });
        return response;
    } catch (error) {
        debug('http.error', {
            requestId, method, path, error: error.name,
            elapsedMs: Math.round(performance.now() - started),
        });
        throw error;
    }
}
