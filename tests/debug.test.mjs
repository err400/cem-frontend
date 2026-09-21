import assert from 'node:assert/strict';
import { test } from 'node:test';
import { debug, debugFetch, isDebugEnabled } from '../js/core/Debug.js';

test('runtime environment and browser overrides toggle logging', () => {
    const original = console.debug;
    const calls = [];
    console.debug = (...args) => calls.push(args);
    try {
        globalThis.CEM_DEBUG = false;
        debug('quiet');
        assert.equal(calls.length, 0);
        globalThis.CEM_DEBUG = true;
        debug('enabled');
        assert.equal(calls.length, 1);
        globalThis.DEBUG = false;
        debug('disabled');
        assert.equal(calls.length, 1);
        globalThis.DEBUG = 'true';
        assert.equal(isDebugEnabled(), true);
        delete globalThis.DEBUG;
        globalThis.localStorage = { getItem: key => key === 'DEBUG' ? 'false' : null };
        assert.equal(isDebugEnabled(), false);
        globalThis.localStorage = { getItem: () => { throw new Error('blocked'); } };
        assert.equal(isDebugEnabled(), true);
    } finally {
        console.debug = original;
        delete globalThis.DEBUG;
        delete globalThis.CEM_DEBUG;
        delete globalThis.localStorage;
    }
});

test('fetch preserves response, errors and options without logging secrets', async () => {
    const originalFetch = globalThis.fetch;
    const originalDebug = console.debug;
    const calls = [];
    const options = { method: 'POST', headers: { Authorization: 'secret' }, body: 'secret-body' };
    const response = new Response('audio', { status: 206 });
    console.debug = (...args) => calls.push(args);
    globalThis.DEBUG = true;
    try {
        globalThis.fetch = async (input, actualOptions) => {
            assert.equal(actualOptions, options);
            return response;
        };
        assert.equal(await debugFetch('https://user:password@example.com/clip?token=secret', options), response);
        assert.equal(response.bodyUsed, false);
        assert.equal(calls.length, 2);
        assert.equal(calls[1][2].status, 206);
        assert.equal(calls[0][2].path, '/clip');
        assert.doesNotMatch(JSON.stringify(calls), /secret|password|Authorization/);
        const error = new TypeError('secret failure');
        globalThis.fetch = async () => { throw error; };
        await assert.rejects(debugFetch('/clip'), err => err === error);
        assert.doesNotMatch(JSON.stringify(calls), /secret failure/);
        globalThis.DEBUG = false;
        calls.length = 0;
        await assert.rejects(debugFetch('/clip'), err => err === error);
        assert.equal(calls.length, 0);
    } finally {
        globalThis.fetch = originalFetch;
        console.debug = originalDebug;
        delete globalThis.DEBUG;
    }
});

