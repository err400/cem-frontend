import { debug, debugFetch as fetch } from '../core/Debug.js';

import Config from '../core/Config.js';
import * as StorageAdapter from '../data/StorageAdapter.js';
import * as MasterData from '../data/MasterData.js';
import { getProjectFolderName } from '../data/projectUtils.js';
import { authHeaders } from './AuthService.js';

function _base() {
    return (Config.server?.baseUrl || '').replace(/\/+$/, '');
}

function _url(path) {
    return _base() + path;
}

async function _fetch(url, opts = {}, timeoutMs = 30000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let resp;
    try {
        const headers = { 'ngrok-skip-browser-warning': 'true', ...authHeaders(), ...(opts.headers || {}) };
        resp = await fetch(url, { ...opts, headers, signal: ctrl.signal });
    } catch (e) {
        if (e.name === 'AbortError') throw new Error(`Request timed out: ${url}`);
        throw new Error(`Network error reaching server (${e.message}).`);
    } finally {
        clearTimeout(timer);
    }
    if (!resp.ok) {
        let detail = `${resp.status} ${resp.statusText}`;
        try {
            const body = await resp.clone().json();
            const msg = body?.detail || body?.message;
            if (msg) detail += ` — ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`;
        } catch { }
        throw new Error(detail);
    }
    return resp;
}

const _json = (url, opts, t) => _fetch(url, opts, t).then(r => r.json());

function _projectFolder() {
    const project = MasterData.getActiveProject();
    if (!project) throw new Error('No active project.');
    return getProjectFolderName(project);
}

export async function checkFilesForUpload(filesBySpot) {
    const name = _projectFolder();
    const resp = await _json(
        _url('/api/v1/projects/check-files'),
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ project: name, files: filesBySpot }),
        },
        30000,
    );
    return resp.to_upload || {};
}

// Upload only the raw audio the requested run needs: files in the selected
// spots and date range that the server doesn't already have. The server
// computes any downstream dependencies itself, so nothing else is uploaded.
export async function uploadSelectedAudio(
    { spotIds, startDate, endDate, validExts, spots, externalFiles },
    onProgress = () => {},
) {
    const name = _projectFolder();

    const startVal = startDate ? parseInt(startDate.replace(/-/g, ''), 10) : null;
    const endVal   = endDate ? parseInt(endDate.replace(/-/g, ''), 10) : null;
    const extList  = (validExts && validExts.length ? validExts : ['.wav'])
        .map(e => e.replace('.', '')).join('|');
    const extRegex = new RegExp(`\\.(${extList})$`, 'i');
    const spotIdSet = new Set(spotIds);

    const filesBySpot = {};
    const fileMap = {};
    const diagnostics = {
        selected_spots: spotIds.length,
        spot_note_audio_seen: 0,
        spot_note_audio_accepted: 0,
        external_seen: externalFiles.length,
        external_reference: 0,
        external_no_local_path: 0,
        external_bad_extension: 0,
        external_out_of_range: 0,
        external_unlinked: 0,
        external_accepted: 0,
    };
    const add = (spotKey, fname, path) => {
        if (!filesBySpot[spotKey]) { filesBySpot[spotKey] = []; fileMap[spotKey] = []; }
        if (!filesBySpot[spotKey].includes(fname)) {
            filesBySpot[spotKey].push(fname);
            fileMap[spotKey].push({ name: fname, path });
        }
    };
    const inRange = (fname) => {
        const m = fname.match(/_(\d{8})_/);
        if (!m) return true;
        const d = parseInt(m[1], 10);
        if (startVal && d < startVal) return false;
        if (endVal && d > endVal) return false;
        return true;
    };

    for (const spotId of spotIds) {
        const spot = spots.find(s => s.spotId === spotId);
        if (!spot) continue;
        const spotKey = spot.name.replace(/\s+/g, '').toUpperCase();
        if (spot.audio_local_filename) {
            diagnostics.spot_note_audio_seen++;
            const fname = spot.audio_local_filename.split('/').pop();
            if (extRegex.test(fname) && inRange(fname)) {
                add(spotKey, fname, spot.audio_local_filename);
                diagnostics.spot_note_audio_accepted++;
            }
        }
    }

    for (const ef of externalFiles) {
        if (ef.is_reference) {
            diagnostics.external_reference++;
            continue;
        }
        if (!ef.local_path) {
            diagnostics.external_no_local_path++;
            continue;
        }
        if (!extRegex.test(ef.name)) {
            diagnostics.external_bad_extension++;
            continue;
        }
        if (!inRange(ef.name)) {
            diagnostics.external_out_of_range++;
            continue;
        }
        const linked = (ef.linked_spots || []).filter(id => spotIdSet.has(id));
        if (linked.length === 0) {
            diagnostics.external_unlinked++;
            continue;
        }
        for (const spotId of linked) {
            const spot = spots.find(s => s.spotId === spotId);
            if (!spot) continue;
            add(spot.name.replace(/\s+/g, '').toUpperCase(), ef.name, ef.local_path);
            diagnostics.external_accepted++;
        }
    }

    const totalBefore = Object.values(filesBySpot).reduce((s, a) => s + a.length, 0);
    debug('upload.selection', { ...diagnostics, eligible: totalBefore });
    if (totalBefore === 0) {
        const exts = (validExts && validExts.length ? validExts : ['.wav']).join(', ');
        console.warn('[ServerUpload] No uploadable audio diagnostics:', diagnostics);
        throw new Error(
            `No uploadable audio found for the selected spot/date range. ` +
            `Server analysis uploads only non-reference, linked ${exts} files. ` +
            `External media seen: ${diagnostics.external_seen}; ` +
            `accepted: ${diagnostics.external_accepted}; ` +
            `reference: ${diagnostics.external_reference}; ` +
            `wrong extension: ${diagnostics.external_bad_extension}; ` +
            `outside date range: ${diagnostics.external_out_of_range}; ` +
            `not linked to selected spot: ${diagnostics.external_unlinked}.`
        );
    }

    onProgress(`Checking ${totalBefore} file(s) against server…`);
    const toUpload = await checkFilesForUpload(filesBySpot);
    const totalNeeded = Object.values(toUpload).reduce((s, a) => s + a.length, 0);
    const skipped = totalBefore - totalNeeded;
    debug('upload.plan', { total: totalBefore, needed: totalNeeded, skipped });
    if (totalNeeded === 0) return { uploaded: 0, skipped, total: totalBefore };

    let uploaded = 0;
    const BATCH_SIZE = 50;

    for (const [spotKey, neededNames] of Object.entries(toUpload)) {
        const neededSet = new Set(neededNames);
        const filesToSend = (fileMap[spotKey] || []).filter(f => neededSet.has(f.name));

        for (let i = 0; i < filesToSend.length; i += BATCH_SIZE) {
            const batch = filesToSend.slice(i, i + BATCH_SIZE);
            const pct = Math.round((uploaded / totalNeeded) * 100);
            onProgress(`Uploading ${spotKey}: ${Math.min(uploaded + batch.length, totalNeeded)} of ${totalNeeded}…`, pct);

            const fd = new FormData();
            fd.append('project', name);
            fd.append('spot', spotKey);
            let appended = 0;
            for (const f of batch) {
                const blob = await StorageAdapter.getFileBlob(f.path);
                if (!blob) {
                    console.warn('[ServerUpload] Could not read local file blob:', f.path);
                    continue;
                }
                fd.append('files', blob, f.name);
                appended++;
            }
            if (appended === 0) continue;
            debug('upload.batch', { spot: spotKey, files: appended, uploaded });

            await _fetch(
                _url('/api/v1/projects/upload/audio'),
                { method: 'POST', body: fd },
                20 * 60 * 1000,
            );
            uploaded += appended;
        }
    }

    if (totalNeeded > 0 && uploaded === 0) {
        throw new Error(
            `Found ${totalNeeded} audio file(s) to upload, but none could be read from local storage. ` +
            `If these were imported as references or moved on disk, re-import them as normal local files before running server analysis.`
        );
    }

    onProgress(`Uploaded ${uploaded} file(s), ${skipped} already on server.`, 100);
    debug('upload.finish', { uploaded, skipped });
    return { uploaded, skipped, total: totalBefore };
}

export function getActiveProjectFolder() {
    return _projectFolder();
}
