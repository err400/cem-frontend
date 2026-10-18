import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getProjectFolderName } from '../js/data/projectUtils.js';

test('legacy projects keep their existing folder naming convention', () => {
    assert.equal(getProjectFolderName({ id: 'abcdef-123', name: 'Forest Survey' }), 'Forest_Survey_abcdef');
    assert.equal(getProjectFolderName({ id: 'abcdef-123', name: '!!!' }), 'Project_abcdef');
    assert.equal(getProjectFolderName(null), 'Unassigned');
});

test('renaming preserves the storage identity used for publish and unpublish', () => {
    const project = { id: 'abcdef-123', name: 'Forest Survey' };
    const originalFolder = getProjectFolderName(project);
    const renamed = { ...project, storage_folder: originalFolder, name: 'New Survey' };
    assert.equal(getProjectFolderName(renamed), originalFolder);
    assert.equal(getProjectFolderName({ ...renamed, name: 'Third Survey' }), originalFolder);
    assert.equal(getProjectFolderName(JSON.parse(JSON.stringify(renamed))), originalFolder);
});
