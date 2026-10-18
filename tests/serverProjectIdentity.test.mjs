import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { getProjectFolderName } from '../js/data/projectUtils.js';

// Exercise the actual rename and identity code with storage/server boundaries stubbed.
const context = { state: null, exists: false, keys: [], saves: 0, failSave: false };
globalThis.__identityTest = context;
const prelude = `
const context = globalThis.__identityTest;
const MasterData = {
    getLocalState: () => context.state,
    saveMasterData: async () => {
        context.saves++;
        if (context.failSave) throw new Error('storage unavailable');
    },
};
const getProjectFolderName = globalThis.__identityFolderName;
const touch = value => ({ ...value, updated_at: new Date().toISOString() });
const EventBus = { emit() {} };
const EVENTS = {};
`;
globalThis.__identityFolderName = getProjectFolderName;
async function load(path) {
    let source = await readFile(new URL(path, import.meta.url), 'utf8');
    source = source.replace(/^import .*;\n/gm, '');
    source = source.replace("await import('../services/ServerService.js')", "({ getActiveProjectServerStatus: async () => ({ exists: context.exists }) })");
    source = source.replace("await import('./StorageAdapter.js')", "({ listAllFileKeys: async () => context.keys })");
    return import(`data:text/javascript,${encodeURIComponent(prelude + source)}`);
}
const { renameProject } = await load('../js/data/ProjectManager.js');
const { ensureServerProjectFolder } = await load('../js/services/ServerProjectIdentity.js');

test('initial rename uses the chosen name; server use freezes it across later renames', async () => {
    context.exists = false;
    context.state = { projects: [{ id: 'abcdef-123', name: 'Untitled Project' }] };
    await renameProject('abcdef-123', 'Forest Survey');
    let project = context.state.projects[0];
    assert.equal(project.storage_folder, undefined);
    assert.equal(getProjectFolderName(project), 'Forest_Survey_abcdef');
    assert.equal(await ensureServerProjectFolder(project), 'Forest_Survey_abcdef');
    await renameProject(project.id, 'New Survey');
    project = context.state.projects[0];
    assert.equal(project.name, 'New Survey');
    assert.equal(getProjectFolderName(project), 'Forest_Survey_abcdef');
    assert.equal(await ensureServerProjectFolder(project), 'Forest_Survey_abcdef');
});

test('legacy server projects retain their existing path when renamed', async () => {
    context.exists = true;
    context.state = { projects: [{ id: 'abcdef-123', name: 'Existing Public Project' }] };
    await renameProject('abcdef-123', 'New Name');
    assert.equal(context.state.projects[0].storage_folder, 'Existing_Public_Project_abcdef');
});

test('failed identity persistence rejects before a caller can send server data', async () => {
    context.failSave = true;
    try {
        await assert.rejects(ensureServerProjectFolder({ id: 'abcdef-123', name: 'Forest' }), /storage unavailable/);
    } finally {
        context.failSave = false;
    }
});


test('local-only jobs remain discoverable after rename', async () => {
    context.exists = false;
    context.keys = ['Forest_abcdef/jobs/completed/job_1.json'];
    context.state = { projects: [{ id: 'abcdef-123', name: 'Forest' }] };
    try {
        await renameProject('abcdef-123', 'Renamed Forest');
        assert.equal(getProjectFolderName(context.state.projects[0]), 'Forest_abcdef');
    } finally {
        context.keys = [];
    }
});
