import EventBus, { EVENTS }         from '../core/EventBus.js';
import {
    createProject,
    switchProject,
    renameProject,
}                                    from '../data/ProjectManager.js';
import { getActiveProject, getSpots, getLocalState, saveMasterData } from '../data/MasterData.js';
import { saveExternalFile, saveExternalFileByReference, saveExternalFilesByReferenceBatch, saveExternalFilesBatch } from '../data/Repository.js';
import {
    getActiveProjectServerStatus,
    publishActiveProject,
    unpublishActiveProject,
} from '../services/ServerService.js';
import { showToast }                 from './Toast.js';
import { openModal, closeModal }     from './ModalManager.js';
import { showAckDialog, showConfirmDialog } from './Dialog.js';

export function initProjectUI() {
    _initProjectDropdown();
    _initImportMediaForm();

    EventBus.on(EVENTS.STORAGE_READY,  _renderProjectList);
    EventBus.on(EVENTS.PROJECT_CHANGED, _renderProjectList);

}

function _askProjectName(title, defaultValue = '') {
    return new Promise(resolve => {
        const dialog = document.getElementById('project-name-dialog');
        const form   = document.getElementById('project-name-form');
        const input  = document.getElementById('project-name-input');
        const heading = document.getElementById('project-name-dialog-title');
        const cancelBtn = document.getElementById('cancel-project-name');

        if (!dialog || !form || !input) {
            resolve(null);
            return;
        }

        if (heading) heading.textContent = title;
        input.value = defaultValue;

        const cleanup = () => {
            form.removeEventListener('submit', onSubmit);
            cancelBtn?.removeEventListener('click', onCancel);
            dialog.removeEventListener('cancel', onCancel);
        };

        const onSubmit = (e) => {
            e.preventDefault();
            const val = input.value.trim();
            cleanup();
            closeModal('project-name-dialog');
            resolve(val || null);
        };

        const onCancel = () => {
            cleanup();
            closeModal('project-name-dialog');
            resolve(null);
        };

        form.addEventListener('submit', onSubmit);
        cancelBtn?.addEventListener('click', onCancel);
        dialog.addEventListener('cancel', onCancel);

        openModal('project-name-dialog');
        input.focus();
        input.select();
    });
}

function _renderProjectList() {
    const projectSelect = document.getElementById('project-select');
    if (!projectSelect) return;

    const state = getLocalState();
    if (!state.projects) return;

    projectSelect.innerHTML = '';
    for (const p of state.projects) {
        const opt       = document.createElement('option');
        opt.value       = p.id;
        opt.textContent = p.name;
        if (p.id === state.currentProjectId) opt.selected = true;
        projectSelect.appendChild(opt);
    }
    _syncPublicCheckbox();
    _refreshPublicationFromServer();
}

function _initProjectDropdown() {
    const projectSelect    = document.getElementById('project-select');
    const btnNewProject    = document.getElementById('btn-new-project');
    const btnRenameProject = document.getElementById('btn-rename-project');
    const btnMakePublic    = document.getElementById('btn-make-public');
    const publicCheckbox   = document.getElementById('project-public-checkbox');

    if (!projectSelect) return;

    projectSelect.addEventListener('change', async (e) => {
        try {
            await switchProject(e.target.value);
        } catch (err) {
            showToast(err.message, 'failed');
        }
    });

    btnNewProject?.addEventListener('click', async () => {
        const name = await _askProjectName('New Project', 'New Project');
        if (!name) return;
        try {
            await createProject(name);
            _renderProjectList();
        } catch (err) {
            showToast(err.message, 'failed');
        }
    });

    btnRenameProject?.addEventListener('click', async () => {
        const state       = getLocalState();
        const currentName = projectSelect.options[projectSelect.selectedIndex]?.text || '';
        const newName     = await _askProjectName('Rename Project', currentName);

        if (!newName || newName === currentName) return;

        try {
            await renameProject(state.currentProjectId, newName);
            _renderProjectList();
        } catch (err) {
            showToast(err.message, 'failed');
        }
    });

    btnMakePublic?.addEventListener('click', () => {
        if (_isProjectPublic(getActiveProject())) _handleMakePrivate();
        else _handleMakePublic();
    });
    publicCheckbox?.addEventListener('change', async (e) => {
        const project = getActiveProject();
        if (e.target.checked) {
            await _handleMakePublic();
        } else if (_isProjectPublic(project)) {
            await _handleMakePrivate();
        } else {
            e.target.checked = false;
        }
    });
}

function _isProjectPublic(project) {
    return Boolean(project?.publication?.server_verified && project.publication.is_public);
}

function _syncPublicCheckbox() {
    const cb = document.getElementById('project-public-checkbox');
    const btn = document.getElementById('btn-make-public');
    const isPublic = _isProjectPublic(getActiveProject());
    if (cb) cb.checked = isPublic;
    if (btn) btn.textContent = isPublic ? 'Make Private' : 'Make Public';
}

async function _refreshPublicationFromServer() {
    const project = getActiveProject();
    if (!project) return;
    const projectId = project.id;

    try {
        const status = await getActiveProjectServerStatus();
        const current = getActiveProject();
        if (!current || current.id !== projectId) return;

        current.publication = {
            ...(current.publication || {}),
            server_verified: true,
            is_public: Boolean(status.is_public),
            last_status: status.visibility || (status.is_public ? 'public' : 'private'),
            published_at: status.published_at || current.publication?.published_at || null,
            unpublished_at: status.unpublished_at || current.publication?.unpublished_at || null,
        };
        await saveMasterData();
        _syncPublicCheckbox();
    } catch (err) {
        console.warn('[ProjectUI] publication status refresh failed:', err);
    }
}

async function _handleMakePrivate() {
    const btn = document.getElementById('btn-make-public');
    const cb  = document.getElementById('project-public-checkbox');
    const original = btn?.textContent || 'Make Private';
    if (btn) { btn.disabled = true; btn.textContent = 'Updating...'; }
    if (cb) cb.disabled = true;

    try {
        const ok = await showConfirmDialog({
            title: 'Make project private?',
            message: 'This marks the project private in DATA_DIR. The CEM Master indexer will remove its public catalog rows on the next polling pass.',
            confirmText: 'Make Private',
            cancelText: 'Cancel',
        });
        if (!ok) {
            _syncPublicCheckbox();
            return;
        }

        const result = await unpublishActiveProject();
        const project = getActiveProject();
        if (project) {
            project.publication = {
                ...(project.publication || {}),
                server_verified: true,
                is_public: false,
                unpublished_at: new Date().toISOString(),
                last_status: result.status,
                indexer_mode: result.indexer?.mode || 'polling',
            };
            await saveMasterData();
        }
        if (cb) cb.checked = false;
        showToast('Project marked private. CEM Master indexer will prune it.', 'success');
    } catch (err) {
        _syncPublicCheckbox();
        showToast(`Privacy update failed: ${err.message}`, 'failed');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = original; }
        if (cb) cb.disabled = false;
        _syncPublicCheckbox();
    }
}

async function _handleMakePublic() {
    const btn = document.getElementById('btn-make-public');
    const cb  = document.getElementById('project-public-checkbox');
    const original = btn?.textContent || 'Make Public';
    if (btn) { btn.disabled = true; btn.textContent = 'Checking...'; }
    if (cb) cb.disabled = true;

    try {
        const ok = await showConfirmDialog({
            title: 'Make project public?',
            message: 'This marks the whole project public in DATA_DIR. Only projects with completed server-compute outputs are publishable; local watcher and browser-only results stay private.',
            confirmText: 'Make Public',
            cancelText: 'Cancel',
        });
        if (!ok) {
            _syncPublicCheckbox();
            return;
        }

        if (btn) btn.textContent = 'Publishing...';
        const result = await publishActiveProject();

        const project = getActiveProject();
        if (project) {
            project.publication = {
                is_public: true,
                server_verified: true,
                published_at: new Date().toISOString(),
                last_status: result.status,
                indexer_mode: result.indexer?.mode || 'polling',
            };
            await saveMasterData();
        }
        if (cb) cb.checked = true;

        showToast('Project marked public. CEM Master indexer will pick it up.', 'success');
    } catch (err) {
        _syncPublicCheckbox();
        showToast(`Publish failed: ${err.message}`, 'failed');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = original; }
        if (cb) cb.disabled = false;
        _syncPublicCheckbox();
    }
}

// The reference-import note is advice, not a decision: it is the same sentence
// every time and nothing depends on the user acknowledging it. Firing it on
// every tick of the checkbox turned a one-line hint into a modal the user has
// to dismiss repeatedly while making up their mind. Once per page load is
// enough to inform; the storageKey below still suppresses it across reloads for
// anyone who ticks "Don't show again".
let _referenceNoteShownThisSession = false;

function _initImportMediaForm() {
    const importBtn       = document.getElementById('import-media-btn');
    const spotContainer   = document.getElementById('spot-selection-container');
    const importForm      = document.getElementById('import-media-form');
    const cancelImportBtn = document.getElementById('cancel-import-btn');

    if (!importBtn) return;

    const refCheckbox    = document.getElementById('import-as-reference');
    const baseDirContainer = document.getElementById('reference-base-dir-container');
    if (refCheckbox && baseDirContainer) {
        refCheckbox.addEventListener('change', () => {
            baseDirContainer.style.display = refCheckbox.checked ? 'block' : 'none';
            if (refCheckbox.checked && !_referenceNoteShownThisSession) {
                // Set before showing, not after: showAckDialog is async, and a
                // fast double-tick would otherwise open two overlays.
                _referenceNoteShownThisSession = true;
                showAckDialog({
                    title: 'Reference import',
                    message: "Files imported as reference can't be analysed on the server. They can only be analysed locally with the watcher.",
                    storageKey: 'cem-hide-reference-import-note',
                });
            }
        });
    }

    importBtn.addEventListener('click', () => {
        const spots = getSpots();
        if (!spotContainer) return;

        spotContainer.innerHTML = '';
        if (!spots || spots.length === 0) {
            spotContainer.innerHTML = '<p>No spots found. Create a spot first.</p>';
        } else {
            const seen = new Set();
            for (const spot of spots) {
                if (seen.has(spot.name)) continue;
                seen.add(spot.name);
                const div     = document.createElement('div');
                const label   = document.createElement('label');
                const cb      = document.createElement('input');
                cb.type       = 'radio';
                cb.name       = 'selected_spot';
                cb.value      = spot.spotId;
                label.append(cb, ` ${spot.name}`);
                div.append(label);
                spotContainer.appendChild(div);
            }
        }

        openModal('import-media-popup');
    });

    cancelImportBtn?.addEventListener('click', () => closeModal('import-media-popup'));

    importForm?.addEventListener('submit', async (e) => {
        e.preventDefault();

        const submitBtn    = importForm.querySelector('button[type="submit"]');
        const originalText = submitBtn?.textContent ?? '';
        if (submitBtn) {
            submitBtn.textContent = 'Importing...';
            submitBtn.disabled    = true;
        }

        try {
            const checkedBoxes    = spotContainer
                ? spotContainer.querySelectorAll('input[name="selected_spot"]:checked')
                : [];
            const selectedSpotIds = Array.from(checkedBoxes).map(cb => cb.value);

            const fileInput = document.getElementById('external-file-input');
            const files     = fileInput ? Array.from(fileInput.files) : [];
            const importAsRef = document.getElementById('import-as-reference')?.checked || false;

            if (selectedSpotIds.length === 0) throw new Error('Please select at least one spot.');
            if (files.length === 0)           throw new Error('Please select files.');

            let importDate       = new Date();
            const useCurrentCb   = document.getElementById('import-use-current-time');
            if (useCurrentCb && !useCurrentCb.checked) {
                const cDate = document.getElementById('import-custom-date')?.value;
                const cTime = document.getElementById('import-custom-time')?.value || '00:00:00';
                if (cDate) importDate = new Date(`${cDate}T${cTime}`);
            }

            let baseDir = '';
            if (importAsRef) {
                baseDir = (document.getElementById('reference-base-dir')?.value || '').trim();
                if (!baseDir) throw new Error('Please enter the base directory path for reference imports.');
                baseDir = baseDir.replace(/[\\/]+$/, '');
            }

            const progressCb = (done, total) => {
                if (submitBtn) submitBtn.textContent = `Importing ${done}/${total}...`;
            };

            if (importAsRef) {
                const normBase = baseDir.replace(/\\/g, '/');
                const descriptors = files.map(file => {
                    const relPart = (file.webkitRelativePath || file.name).replace(/\\/g, '/');
                    return { name: file.name, path: normBase + '/' + relPart, type: file.type };
                });
                await saveExternalFilesByReferenceBatch(
                    descriptors, selectedSpotIds, importDate, progressCb
                );
            } else {
                await saveExternalFilesBatch(
                    files, selectedSpotIds, importDate, progressCb
                );
            }

            showToast(`${importAsRef ? 'Referenced' : 'Imported'} ${files.length} file(s) successfully.`, 'success');
            closeModal('import-media-popup');
            importForm.reset();

            const refBaseDirEl = document.getElementById('reference-base-dir-container');
            if (refBaseDirEl) refBaseDirEl.style.display = 'none';

            const importUseCurrentCb = document.getElementById('import-use-current-time');
            if (importUseCurrentCb) importUseCurrentCb.checked = true;
            const customTimeFields = document.getElementById('import-custom-time-fields');
            if (customTimeFields) customTimeFields.style.display = 'none';

        } catch (err) {
            console.error('[ProjectUI] Import failed:', err);
            showToast(`Import Failed: ${err.message}`, 'failed');
        } finally {
            if (submitBtn) {
                submitBtn.textContent = originalText;
                submitBtn.disabled    = false;
            }
        }
    });
}
