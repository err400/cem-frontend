// The recording filename convention, checked in the browser at import time.
//
// The analysis pipeline reads a recording's date and time ONLY from its name.
// A file that does not follow the convention is still analysed, but its
// detections carry no date or hour, so every date filter and time-based
// analysis drops them later without telling anyone. Warning here, before the
// upload, is the only point at which the user can still rename the files.
//
// MUST stay identical to _FILENAME_RE + the range checks in
// cem-backend/pipeline/file_metadata.py (parse_filename). If the two drift,
// this check passes names the pipeline then treats as undated.

export const CONVENTION = 'SPOT_YYYYMMDD_HHMMSS.<ext>';
export const CONVENTION_EXAMPLE = '04213SPOT1_20260131_082409.wav';

const FILENAME_RE = new RegExp(
    '^([A-Za-z0-9][A-Za-z0-9_-]*)_' +
    '(\\d{4})(\\d{2})(\\d{2})_' +
    '(\\d{2})(\\d{2})(\\d{2})' +
    '\\.[A-Za-z0-9]+$',
    'i',
);

// What the pipeline can decode (soundfile/libsndfile in the server image).
// M4A/AAC is not readable by libsndfile and fails at analysis time.
const AUDIO_EXT     = /\.(wav|flac|mp3|ogg|m4a|aac|aif|aiff|wma)$/i;
const SUPPORTED_EXT = /\.(wav|flac|mp3|ogg)$/i;

export function isAudioName(name) {
    return AUDIO_EXT.test(name);
}

/** Same result as parse_filename() returning non-None. */
export function followsConvention(name) {
    const base = String(name).split(/[\\/]/).pop();
    const m = FILENAME_RE.exec(base);
    if (!m) return false;
    const [, , y, mo, d, h, mi, s] = m.map(Number);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
    if (h > 23 || mi > 59 || s > 59) return false;
    // Reject impossible calendar dates (e.g. 20260231), as Python's date() does.
    const dt = new Date(Date.UTC(y, mo - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/**
 * Check a batch of files before import. Non-audio files (photos, notes) are
 * ignored -- the convention only matters for recordings.
 * Returns { badNames: [...], unsupported: [...], audioCount }.
 */
export function checkRecordingNames(names) {
    const badNames = [];
    const unsupported = [];
    let audioCount = 0;
    for (const raw of names) {
        const name = String(raw).split(/[\\/]/).pop();
        if (!isAudioName(name)) continue;
        audioCount++;
        if (!SUPPORTED_EXT.test(name)) unsupported.push(name);
        if (!followsConvention(name)) badNames.push(name);
    }
    return { badNames, unsupported, audioCount };
}

/** "a.wav, b.wav, c.wav and 9 more" */
export function summariseNames(names, max = 4) {
    if (names.length <= max) return names.join(', ');
    return `${names.slice(0, max).join(', ')} and ${names.length - max} more`;
}
