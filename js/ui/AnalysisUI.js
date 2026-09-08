import Config                       from '../core/Config.js';
import EventBus, { EVENTS }        from '../core/EventBus.js';
import {
    getWatcherOnlineStatus,
    loadInstalledScripts,
    buildJobData,
    queueJob,
}                                   from '../services/AnalysisService.js';
import {
    isConfigured       as serverConfigured,
    getServerConfig,
    checkServerHealth,
    getServerSteps,
    runJobOnServer,
}                                   from '../services/ServerService.js';
import { getSpots, getExternalFiles, getActiveProject } from '../data/MasterData.js';
import { getProjectFolderName } from '../data/projectUtils.js';
import * as StorageAdapter from '../data/StorageAdapter.js';
import { getWatcherStatus } from '../data/Repository.js';
import { showToast }                from './Toast.js';
import { openModal, closeModal }    from './ModalManager.js';
import { showConfirmDialog }        from './Dialog.js';

const els = {
    popup          : null,
    statusIndicator: null,
    statusText     : null,
    runBtn         : null,
    closeBtn       : null,
    scriptSelect   : null,
    fileSelector   : null,
    dynamicForm    : null,
    paramsContainer: null,
    jobNameInput   : null,
};

let _elsCached = false;

let _currentScript = null;

let _heartbeatInterval = null;

let _fileSelectorListenerAttached = false;

let _serverMode = false;

let _runningServerJob = false;

function _cacheElements() {
    if (_elsCached) return;

    els.popup           = document.getElementById('analysis-popup');
    els.statusIndicator = document.getElementById('watcher-indicator');
    els.statusText      = document.getElementById('watcher-status-text');
    els.runBtn          = document.getElementById('btn-run-analysis');
    els.closeBtn        = document.getElementById('close-analysis-btn');
    els.scriptSelect    = document.getElementById('analysis-script-select');
    els.fileSelector    = document.getElementById('analysis-file-selector');
    els.dynamicForm     = document.getElementById('analysis-dynamic-form');
    els.paramsContainer = document.getElementById('dynamic-params-container');
    els.jobNameInput    = document.getElementById('analysis-job-name');

    _elsCached = true;
}

export function initAnalysis() {
    const openBtn = document.getElementById('analysis-btn');

    if (openBtn) {
        openBtn.addEventListener('click', () => {
            _cacheElements();

            openModal('analysis-popup');

            if (els.jobNameInput)    els.jobNameInput.value = '';
            if (els.fileSelector)    els.fileSelector.innerHTML =
                '<p style="padding:10px; color:var(--text-muted);">Select a script first...</p>';
            if (els.dynamicForm)     els.dynamicForm.innerHTML = '';
            if (els.paramsContainer) els.paramsContainer.style.display = 'none';

            _currentScript = null;

            _initFileSelectorListener();

            _applyModeStyles();
            _checkStatus();
            _loadScripts();
            _startHeartbeat();
        });
    }

    document.addEventListener('click', (e) => {
        const btn = e.target && e.target.closest && e.target.closest('.analysis-mode-btn');
        if (btn) _setMode(btn.dataset.mode);
    });

    document.addEventListener('click', (e) => {
        if (e.target && e.target.id === 'close-analysis-btn') {
            _cacheElements();
            closeModal('analysis-popup');
            _stopHeartbeat();
        }
    });

    document.addEventListener('click', (e) => {
        if (e.target && e.target.id === 'btn-run-analysis') {
            _handleRunClick();
        }
    });

    document.addEventListener('change', (e) => {
        if (e.target && e.target.id === 'analysis-script-select') {
            _loadScriptParams(e.target.value);
        }
    });

}

function _startHeartbeat() {
    _stopHeartbeat();
    const interval = _serverMode ? 10000 : 5000;
    _heartbeatInterval = setInterval(_checkStatus, interval);
}

function _stopHeartbeat() {
    if (_heartbeatInterval) {
        clearInterval(_heartbeatInterval);
        _heartbeatInterval = null;
    }
}

function _setMode(mode) {
    const next = mode === 'server';
    if (next === _serverMode) return;
    _serverMode = next;
    _applyModeStyles();
    if (els.scriptSelect) els.scriptSelect.innerHTML = '<option value="">Loading scripts...</option>';
    _currentScript = null;
    if (els.fileSelector) els.fileSelector.innerHTML =
        '<p style="padding:10px; color:var(--text-muted);">Select a script first...</p>';
    if (els.paramsContainer) els.paramsContainer.style.display = 'none';
    if (els.runBtn) { els.runBtn.dataset.formReady = 'false'; els.runBtn.disabled = true; }
    _checkStatus();
    _loadScripts();
    _startHeartbeat();
}

function _applyModeStyles() {
    document.querySelectorAll('.analysis-mode-btn').forEach(btn => {
        const active = (btn.dataset.mode === 'server') === _serverMode;
        btn.style.background = active ? 'var(--accent-blue)' : 'var(--bg-surface-alt)';
        btn.style.color      = active ? '#fff' : 'var(--text-dark)';
    });

    const serverHelp  = document.getElementById('server-help');
    const watcherHelp = document.getElementById('watcher-offline-help');
    if (serverHelp)  serverHelp.style.display  = _serverMode ? 'block' : 'none';
    if (watcherHelp && _serverMode) watcherHelp.style.display = 'none';
}

async function _checkStatus() {
    if (_runningServerJob) return;

    if (_serverMode) return _checkServerStatus();

    try {
        const rawStatus  = await getWatcherStatus();
        const descriptor = getWatcherOnlineStatus(rawStatus);

        if (els.statusIndicator) els.statusIndicator.style.color = descriptor.color;
        if (els.statusText)      els.statusText.textContent       = descriptor.text;

        if (els.runBtn) {
            const isFormReady = els.runBtn.dataset.formReady === 'true';
            els.runBtn.disabled   = !isFormReady;
            els.runBtn.textContent = descriptor.isBusy ? 'Watcher Busy...' : 'Queue Job';
        }

        if (els.scriptSelect && els.scriptSelect.options.length <= 1) {
            _loadScripts();
        }
    } catch (e) {
        console.error('[AnalysisUI] Status check failed:', e);
    }
}

async function _checkServerStatus() {
    if (!serverConfigured()) {
        if (els.statusIndicator) els.statusIndicator.style.color = '#dc3545';
        if (els.statusText)      els.statusText.textContent =
            'Server not configured (Config.server)';
        if (els.runBtn) { els.runBtn.disabled = true; els.runBtn.textContent = 'Run on Server'; }
        const d = document.getElementById('server-help-detail');
        if (d) d.innerHTML = '<br><strong>Set Config.server.baseUrl.</strong>';
        return;
    }

    const { online, error } = await checkServerHealth();
    if (els.statusIndicator) els.statusIndicator.style.color = online ? '#28A745' : '#dc3545';
    if (els.statusText) {
        const { baseUrl } = getServerConfig();
        els.statusText.textContent = online ? `Server Online (${baseUrl})` : 'Server Offline';
    }
    const d = document.getElementById('server-help-detail');
    if (d) d.innerHTML = online ? '' : `<br><strong>Cannot reach server.</strong> ${error || ''}`;

    if (els.runBtn) {
        const isFormReady = els.runBtn.dataset.formReady === 'true';
        els.runBtn.disabled    = !online || !isFormReady;
        els.runBtn.textContent = 'Run on Server';
    }

    if (els.scriptSelect && els.scriptSelect.options.length <= 1 && online) {
        _loadScripts();
    }
}

async function _loadScripts() {
    if (!els.scriptSelect) return;

    const currentSelection  = els.scriptSelect.value;

    let installedScripts;
    if (_serverMode) {
        try {
            installedScripts = serverConfigured() ? await getServerSteps() : [];
        } catch (e) {
            console.error('[AnalysisUI] Failed to load server steps:', e);
            installedScripts = [];
        }
    } else {
        installedScripts = await loadInstalledScripts();
    }

    els.scriptSelect.innerHTML = '<option value="">-- Select Script --</option>';

    if (installedScripts.length === 0) {
        const opt     = document.createElement('option');
        opt.disabled  = true;
        opt.textContent = _serverMode
            ? 'Connect to a reachable server to load scripts'
            : 'Connect Watcher to load scripts';
        els.scriptSelect.appendChild(opt);
        return;
    }

    installedScripts.forEach(script => {
        const opt       = document.createElement('option');
        opt.value       = script.id;
        opt.textContent = script.name;
        opt.dataset.json = JSON.stringify(script);
        els.scriptSelect.appendChild(opt);
    });

    if (
        currentSelection &&
        Array.from(els.scriptSelect.options).some(o => o.value === currentSelection)
    ) {
        els.scriptSelect.value = currentSelection;
        _loadScriptParams(currentSelection);
    }
}

function _loadScriptParams(scriptId) {
    if (els.runBtn) {
        els.runBtn.dataset.formReady = 'false';
        els.runBtn.disabled          = true;
    }

    if (!scriptId) {
        if (els.paramsContainer) els.paramsContainer.style.display = 'none';
        if (els.fileSelector)    els.fileSelector.innerHTML =
            '<p style="padding:10px; color:var(--text-muted);">Select a script first...</p>';
        return;
    }

    const opt = els.scriptSelect.querySelector(`option[value="${scriptId}"]`);
    if (!opt) return;
    _currentScript = JSON.parse(opt.dataset.json);

    if (els.fileSelector) els.fileSelector.innerHTML = '';
    if (els.dynamicForm)  els.dynamicForm.innerHTML  = '';

    let hasSpotDateInput = false;

    if (_currentScript.inputs) {
        _currentScript.inputs.forEach(input => {
            if (input.type === 'spot_date_range') {
                _renderSpotDateSelector(input.label);
                hasSpotDateInput = true;
            }
        });
    }

    if (_currentScript.parameters) {
        _currentScript.parameters.forEach(param => {
            const row = document.createElement('div');
            row.className        = 'param-row';
            row.style.marginBottom = '10px';

            const label        = document.createElement('label');
            label.style.display    = 'block';
            label.style.fontWeight = 'bold';
            label.textContent      = param.label;
            row.appendChild(label);

            let inputEl;
            if (param.type === 'select') {
                inputEl = document.createElement('select');
                param.options.forEach(opt => {
                    const o       = document.createElement('option');
                    o.value       = opt;
                    o.textContent = opt;
                    inputEl.appendChild(o);
                });
                inputEl.value = param.default;
            } else {
                inputEl       = document.createElement('input');
                inputEl.type  = 'text';
                inputEl.value = param.default || '';
            }

            inputEl.style.width      = '100%';
            inputEl.style.padding    = '8px';
            inputEl.dataset.paramId  = param.id;
            row.appendChild(inputEl);
            els.dynamicForm.appendChild(row);
        });
    }

    if (!hasSpotDateInput && els.runBtn) {
        els.runBtn.dataset.formReady = 'true';
        _checkStatus();
    }

    if (els.paramsContainer) els.paramsContainer.style.display = 'block';
}

let _availableDates = new Set();

let _calendarState = { start: null, end: null };

// Must stay identical to Project._parse_date_from_filename in
// server/app/projects.py, which is r'_(\d{8})_\d{6}'. The date part alone is not
// enough: a name like SPOT_20260131_notes.wav satisfies /_(\d{8})_/ here but not
// the server's pattern, so the page would count a day the server then treats as
// undated. Whatever this page promises about a date range, the server is the one
// that has to deliver it.
const FILENAME_DATE = /_(\d{8})_\d{6}/;
const AUDIO_EXTENSIONS = /\.(wav|mp3|m4a|flac)$/i;

function _getAvailableDates(spotIds) {
    const idSet = new Set(spotIds);
    const dates = new Set();

    getExternalFiles().forEach(f => {
        if (!AUDIO_EXTENSIONS.test(f.name)) return;
        if (!f.linked_spots || !f.linked_spots.some(id => idSet.has(id))) return;
        const m = f.name.match(FILENAME_DATE);
        if (m) dates.add(m[1]);
    });
    return dates;
}

// Audio attached to the selected spots whose filename carries no parseable date.
//
// These matter to the summary because the server does NOT filter them out:
// populate_job and in_range_audio both fall through to including a file when
// _parse_date_from_filename returns None. So a range with no matching dates can
// still analyse something, and saying "no recordings in this range" would be a
// lie. Counted separately and reported separately.
function _countUndatedAudio(spotIds) {
    const idSet = new Set(spotIds);
    let undated = 0;

    getExternalFiles().forEach(f => {
        if (!AUDIO_EXTENSIONS.test(f.name)) return;
        if (!f.linked_spots || !f.linked_spots.some(id => idSet.has(id))) return;
        if (!FILENAME_DATE.test(f.name)) undated += 1;
    });
    return undated;
}

function _refreshAvailableDates() {
    const checked = document.querySelectorAll('.analysis-spot-checkbox:checked');
    const spotIds = Array.from(checked).map(cb => cb.value);
    _availableDates = _getAvailableDates(spotIds);
    _renderCalendar('start');
    _renderCalendar('end');
}

function _renderCalendar(which) {
    const container = document.getElementById(`cal-${which}`);
    if (!container) return;

    const st = _calendarState[which];
    if (!st) return;

    const { year, month } = st;
    const today     = new Date();
    const firstDay  = new Date(year, month, 1);
    const daysInMon = new Date(year, month + 1, 0).getDate();
    const startDow  = firstDay.getDay();

    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

    const inputEl   = document.getElementById(`analysis-${which}-date`);
    const selVal    = inputEl ? inputEl.value : '';
    const selParts  = selVal ? selVal.split('-') : null;
    const selDay    = selParts ? parseInt(selParts[2], 10) : -1;
    const selMonth  = selParts ? parseInt(selParts[1], 10) - 1 : -1;
    const selYear   = selParts ? parseInt(selParts[0], 10) : -1;

    let html = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
            <button type="button" class="cal-nav" data-which="${which}" data-dir="-1" style="background:none; border:none; cursor:pointer; font-size:1rem; color:var(--text-dark); padding:2px 6px;">◀</button>
            <span style="font-weight:bold; font-size:0.85rem; color:var(--text-dark);">${monthNames[month]} ${year}</span>
            <button type="button" class="cal-nav" data-which="${which}" data-dir="1" style="background:none; border:none; cursor:pointer; font-size:1rem; color:var(--text-dark); padding:2px 6px;">▶</button>
        </div>
        <div style="display:grid; grid-template-columns:repeat(7,1fr); text-align:center; font-size:0.75rem; gap:1px;">
    `;

    ['Su','Mo','Tu','We','Th','Fr','Sa'].forEach(d => {
        html += `<div style="font-weight:bold; color:var(--text-muted); padding:2px;">${d}</div>`;
    });

    for (let i = 0; i < startDow; i++) {
        html += `<div></div>`;
    }

    for (let d = 1; d <= daysInMon; d++) {
        const yyyymmdd = `${year}${String(month + 1).padStart(2, '0')}${String(d).padStart(2, '0')}`;
        const isoDate  = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const hasAudio = _availableDates.has(yyyymmdd);
        const isSelected = (d === selDay && month === selMonth && year === selYear);
        const isToday  = (d === today.getDate() && month === today.getMonth() && year === today.getFullYear());

        let bg = 'transparent';
        let color = 'var(--text-dark)';
        let border = '1px solid transparent';
        let fontWeight = 'normal';

        if (hasAudio) {
            bg = 'rgba(220, 53, 69, 0.15)';
            color = '#dc3545';
            fontWeight = 'bold';
        }
        if (isSelected) {
            bg = 'var(--accent-blue)';
            color = '#fff';
            fontWeight = 'bold';
        }
        if (isToday && !isSelected) {
            border = '1px solid var(--accent-blue)';
        }

        html += `<div class="cal-day" data-which="${which}" data-date="${isoDate}"
                      style="padding:3px 1px; cursor:pointer; border-radius:4px;
                             background:${bg}; color:${color}; font-weight:${fontWeight};
                             border:${border}; line-height:1.6;"
                      title="${hasAudio ? 'Audio available' : ''}">${d}</div>`;
    }

    html += `</div>`;

    html += `<div style="display:flex; align-items:center; gap:6px; margin-top:6px; font-size:0.7rem; color:var(--text-muted);">
        <span style="display:inline-block; width:10px; height:10px; background:rgba(220,53,69,0.3); border-radius:2px;"></span> Has audio
    </div>`;

    container.innerHTML = html;
}

function _renderSpotDateSelector(label) {
    const spots = getSpots();

    const uniqueSpots = [];
    const seenNames = new Set();
    spots.forEach(s => {
        if (seenNames.has(s.name)) return;
        seenNames.add(s.name);
        uniqueSpots.push(s);
    });

    let spotsHtml = `
        <label class="analysis-selectall">
            <input type="checkbox" id="analysis-select-all-spots"> Select all spots (${uniqueSpots.length})
        </label>
        <div class="analysis-spot-grid">`;
    uniqueSpots.forEach(s => {
        spotsHtml += `
            <label class="analysis-spot-card">
                <input type="checkbox" class="analysis-spot-checkbox" value="${s.spotId}">
                <span>${s.name}</span>
            </label>
        `;
    });
    spotsHtml += '</div>';

    _availableDates = new Set();

    els.fileSelector.innerHTML += `
        <div style="margin-bottom:14px;">
            <label style="display:block; margin-bottom:6px; font-weight:700;">${label}</label>
            ${spotsHtml}
        </div>
        <div style="display:flex; gap:12px; margin-bottom:6px;">
            <div style="flex:1;">
                <label style="display:block; margin-bottom:4px; font-size:0.82rem; font-weight:700; color:var(--text-muted);">Start date</label>
                <input type="date" id="analysis-start-date" value="">
            </div>
            <div style="flex:1;">
                <label style="display:block; margin-bottom:4px; font-size:0.82rem; font-weight:700; color:var(--text-muted);">End date</label>
                <input type="date" id="analysis-end-date" value="">
            </div>
        </div>
        <div id="analysis-file-acknowledgement" style="padding:10px; background:var(--bg-surface-alt); border-radius:var(--radius-md); font-size:0.85rem; color:var(--text-muted);">
            Select spots and a date range, then queue your job.
        </div>
    `;
}

function _initFileSelectorListener() {
    if (_fileSelectorListenerAttached || !els.fileSelector) return;

    els.fileSelector.addEventListener('change', (e) => {
        if (e.target.id === 'analysis-select-all-spots') {
            els.fileSelector
                .querySelectorAll('.analysis-spot-checkbox')
                .forEach(cb => { cb.checked = e.target.checked; });
            _refreshAvailableDates();
            _updateFormReadiness();
            return;
        }
        if (e.target.classList.contains('analysis-spot-checkbox')) {
            _refreshAvailableDates();
            _updateFormReadiness();
            return;
        }
        if (e.target.id === 'analysis-start-date' || e.target.id === 'analysis-end-date') {
            _updateFormReadiness();
        }
    });

    els.fileSelector.addEventListener('click', (e) => {
        const dayEl = e.target.closest('.cal-day');
        const navEl = e.target.closest('.cal-nav');

        if (dayEl) {
            const which = dayEl.dataset.which;
            const date  = dayEl.dataset.date;
            const input = document.getElementById(`analysis-${which}-date`);
            if (input) {
                input.value = date;
                input.dispatchEvent(new Event('change', { bubbles: true }));
            }
            _renderCalendar(which);
            _updateFormReadiness();
            return;
        }

        if (navEl) {
            const which = navEl.dataset.which;
            const dir   = parseInt(navEl.dataset.dir, 10);
            const st    = _calendarState[which];
            if (!st) return;

            st.month += dir;
            if (st.month > 11) { st.month = 0;  st.year++; }
            if (st.month < 0)  { st.month = 11; st.year--; }
            _renderCalendar(which);
        }
    });

    _fileSelectorListenerAttached = true;
}

// "2026-01-31" -> "20260131", the compact form the filenames and the server use.
// The server compares these as STRINGS, not dates, so the comparison below has to
// use the same form: "20260131" > "2026-01-31" is true, because '0' sorts after
// '-'. Zero-padded YYYYMMDD is the one representation where lexical order and
// chronological order agree.
function _compactDate(isoDate) {
    return isoDate ? isoDate.replace(/-/g, '') : '';
}

function _daysBetweenInclusive(isoStart, isoEnd) {
    const start = Date.parse(isoStart);
    const end   = Date.parse(isoEnd);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
    // Date.parse on a bare YYYY-MM-DD is UTC by spec, so both ends shift by the
    // same offset and the difference is exact -- no DST or timezone drift.
    return Math.round((end - start) / 86400000) + 1;
}

// Tell the user, before they queue anything, how much of the range they picked
// actually has audio behind it. The information already existed -- the calendar
// that was meant to show it never renders -- but the form gave no hint, so a
// range chosen off a wrong guess failed later at the server with a 409 and no
// explanation of which days were empty.
//
// Reporting only. It never disables Run: a partly-empty range is a perfectly
// normal thing to want, and a zero-coverage range can still be legitimate when
// undated files are attached.
function _updateDateCoverage() {
    const ackEl = document.getElementById('analysis-file-acknowledgement');
    if (!ackEl) return;

    const checked = Array.from(document.querySelectorAll('.analysis-spot-checkbox:checked'));
    const start   = document.getElementById('analysis-start-date')?.value || '';
    const end     = document.getElementById('analysis-end-date')?.value   || '';

    if (checked.length === 0) {
        ackEl.textContent = 'Select spots and a date range, then queue your job.';
        return;
    }

    const spotIds = checked.map(cb => cb.value);
    const undated = _countUndatedAudio(spotIds);
    const undatedNote = undated > 0
        ? ` ${undated} file(s) have no date in their name; the server analyses those whatever range you pick.`
        : '';

    if (!start || !end) {
        const available = _availableDates.size;
        ackEl.textContent = available > 0
            ? `${available} day(s) with recordings for the selected spot(s). Pick a date range.${undatedNote}`
            : `No dated recordings for the selected spot(s).${undatedNote}`;
        return;
    }

    if (_compactDate(start) > _compactDate(end)) {
        ackEl.textContent = 'End date is before start date.';
        return;
    }

    const startKey = _compactDate(start);
    const endKey   = _compactDate(end);

    // Walk the available dates, not the range. A user can type 0001-01-01 into a
    // date input, and iterating day by day over that would hang the page; the
    // number of days with recordings is always small.
    let withAudio = 0;
    _availableDates.forEach(day => {
        if (day >= startKey && day <= endKey) withAudio += 1;
    });

    const totalDays = _daysBetweenInclusive(start, end);
    const empty     = Math.max(totalDays - withAudio, 0);

    if (withAudio === 0) {
        ackEl.textContent = undated > 0
            ? `None of the ${totalDays} day(s) in this range have dated recordings.${undatedNote}`
            : `None of the ${totalDays} day(s) in this range have recordings — the server will reject this job.`;
        return;
    }

    ackEl.textContent =
        `${withAudio} of ${totalDays} day(s) in this range have recordings` +
        (empty > 0 ? ` (${empty} with none).` : '.') +
        undatedNote;
}

function _updateFormReadiness() {
    const checkedSpots = document.querySelectorAll('.analysis-spot-checkbox:checked');
    const start        = document.getElementById('analysis-start-date')?.value;
    const end          = document.getElementById('analysis-end-date')?.value;

    _updateDateCoverage();

    if (checkedSpots.length > 0 && start && end) {
        _setFormReady(true);
    } else {
        _setFormReady(false);
    }
}

function _setFormReady(ready) {
    if (!els.runBtn) return;
    els.runBtn.dataset.formReady = ready ? 'true' : 'false';
    _checkStatus();
}

async function _handleRunClick() {
    if (!_currentScript) return;

    let jobName = els.jobNameInput ? els.jobNameInput.value.trim() : '';
    if (!jobName) {
        const d  = new Date();
        const ts = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
        jobName  = `Job_${ts}`;
        if (els.jobNameInput) els.jobNameInput.value = jobName;
    }
    jobName = jobName.replace(/[^a-zA-Z0-9_\-\s]/g, '_').trim();

    const hasSpotDateInput = _currentScript.inputs &&
        _currentScript.inputs.some(i => i.type === 'spot_date_range');

    let spotIds   = [];
    let startDate = '';
    let endDate   = '';

    if (hasSpotDateInput) {
        const checkedSpots = document.querySelectorAll('.analysis-spot-checkbox:checked');
        startDate          = document.getElementById('analysis-start-date')?.value || '';
        endDate            = document.getElementById('analysis-end-date')?.value   || '';

        if (checkedSpots.length === 0 || !startDate || !endDate) {
            showToast('Please select at least one Spot and a full Date Range.', 'failed');
            return;
        }
        spotIds = Array.from(checkedSpots).map(cb => cb.value);
    }

    const dynamicParams = {};
    els.dynamicForm.querySelectorAll('[data-param-id]').forEach(input => {
        dynamicParams[input.dataset.paramId] = input.value;
    });

    const spots         = getSpots();
    const externalFiles = getExternalFiles();

    if (_serverMode) {
        const refFiles = externalFiles.filter(f =>
            f.is_reference && (f.linked_spots || []).some(id => spotIds.includes(id)));
        if (refFiles.length) {
            closeModal('analysis-popup');
            const ok = await showConfirmDialog({
                title: 'Reference files not analysed on server',
                message: `You have ${refFiles.length} file(s) imported as reference. The server will not analyse them (reference files run locally only). Continue?`,
                confirmText: 'Run on server',
                cancelText: 'Cancel',
            });
            if (!ok) {
                openModal('analysis-popup');
                return;
            }
        }
        await _runOnServer({ jobName, spotIds, startDate, endDate, dynamicParams, spots, externalFiles });
        return;
    }

    const jobData = buildJobData(
        jobName,
        _currentScript,
        spotIds,
        startDate,
        endDate,
        dynamicParams,
        spots,
        externalFiles
    );

    try {
        if (els.runBtn) {
            els.runBtn.textContent = 'Queuing...';
            els.runBtn.disabled    = true;
        }

        await queueJob(jobData);

        showToast('Job queued successfully!', 'success');
        closeModal('analysis-popup');
        if (els.jobNameInput) els.jobNameInput.value  = '';
        _stopHeartbeat();

    } catch (e) {
        showToast(`Error: ${e.message}`, 'failed');
    } finally {
        if (els.runBtn) {
            els.runBtn.textContent = 'Queue Job';
            els.runBtn.disabled    = false;
        }
    }
}

async function _runOnServer({ jobName, spotIds, startDate, endDate, dynamicParams, spots, externalFiles }) {
    _runningServerJob = true;
    const setStatus = (msg) => { if (els.statusText) els.statusText.textContent = msg; };
    if (els.statusIndicator) els.statusIndicator.style.color = '#FFC107';

    if (els.runBtn) { els.runBtn.textContent = 'Running…'; els.runBtn.disabled = true; }

    try {
        const res = await runJobOnServer({
            jobName,
            currentScript: _currentScript,
            spotIds, startDate, endDate, dynamicParams,
            spots, externalFiles,
            onProgress: setStatus,
        });

        showToast(`Server job complete — ${res.files} file(s) downloaded.`, 'success');
        closeModal('analysis-popup');
        if (els.jobNameInput) els.jobNameInput.value = '';
        _stopHeartbeat();
    } catch (e) {
        showToast(`Server job failed: ${e.message}`, 'failed');
        setStatus(`Failed: ${e.message}`);
        if (els.statusIndicator) els.statusIndicator.style.color = '#dc3545';

        const ackEl = document.getElementById('analysis-file-acknowledgement');
        if (ackEl) {
            try {
                const project = getActiveProject();
                const pf = project ? getProjectFolderName(project) : '';
                if (pf) {
                    const files = await StorageAdapter.listDirectoryFiles([pf, 'jobs', 'failed']);
                    const latest = files.filter(f => f.endsWith('.json')).sort().pop();
                    if (latest) {
                        const blob = await StorageAdapter.getFileBlob(`${pf}/jobs/failed/${latest}`);
                        if (blob) {
                            const rec = JSON.parse(await blob.text());
                            if (rec.run_log) {
                                const tail = rec.run_log.split('\n').slice(-30).join('\n');
                                ackEl.innerHTML = `<details open style="margin-top:6px;">
                                    <summary style="font-weight:700; color:#dc3545; cursor:pointer;">Run Log (last 30 lines)</summary>
                                    <pre style="max-height:200px; overflow:auto; font-size:0.75rem; white-space:pre-wrap; background:#1a1a1a; color:#e0e0e0; padding:8px; border-radius:4px; margin-top:4px;">${tail.replace(/</g, '&lt;')}</pre>
                                </details>`;
                            }
                        }
                    }
                }
            } catch { }
        }
    } finally {
        _runningServerJob = false;
        if (els.runBtn) { els.runBtn.textContent = 'Run on Server'; els.runBtn.disabled = false; }
    }
}
