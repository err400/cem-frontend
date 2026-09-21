// The field guide: an in-page user manual for the compute page, written the way
// a naturalist keeps a notebook. Each entry is a thing on the page, what it is,
// and the one thing to do with it. The entries follow the order a first project
// actually happens in: a place, a recording, an analysis, a publication.
//
// Content-first: ENTRIES is the manual, the panel is dumb. Edit the array and
// nothing else needs to move. The master page carries its own copy of this
// module with its own entries; the two are kept similar on purpose so the guide
// feels like one thing across both sites.

import { debug } from '../core/Debug.js';

const STORAGE_KEY = 'cem.compute.fieldGuideSeen';

const ENTRIES = [
    {
        mark: '❧',
        title: 'Project',
        what: 'A notebook. Every spot, recording and analysis below belongs to the project selected at the top.',
        how: 'New starts one, Rename relabels it. Projects are private until you say otherwise.',
    },
    {
        mark: '⌖',
        title: 'Spot',
        what: 'A place where a recorder listened. It is the unit everything else hangs off.',
        how: 'New Spot pins one at your GPS position or typed coordinates, with a time, photos and a voice note. Click a pin on the map to revisit it.',
    },
    {
        mark: '↝',
        title: 'Route',
        what: 'The path you walked between spots.',
        how: 'Start tracking before you set off; stop and name it when you are back.',
    },
    {
        mark: '◱',
        title: 'Site',
        what: 'A boundary drawn around several spots, loaded from a KML file.',
        how: 'Add New Site, pick the file. Stratify asks the server to split the site into clusters for sampling.',
    },
    {
        mark: '♫',
        title: 'Import media',
        what: 'Bring in recordings from a Song Meter or a folder. Each file is assigned to a spot; the filename supplies the date and time.',
        how: 'Tick Import as reference for library recordings you want to keep but never analyse. The form tells you how many days the files cover before you run anything.',
    },
    {
        mark: '⚙',
        title: 'Analysis Hub',
        what: 'Choose a script (BirdNET first), the input data, then its parameters. Local Watcher runs on this machine; Connect to Server runs remotely.',
        how: 'Only server runs can be published. Minimum confidence is decided once: detections below it are never written, so a lower floor cannot be recovered later.',
    },
    {
        mark: '≡',
        title: 'Analysis jobs',
        what: 'Every run you have made, with its status, output files and log.',
        how: 'Open a job to preview its outputs. A share link, where one exists, downloads the result folder.',
    },
    {
        mark: '⇄',
        title: 'Share and Import',
        what: 'Share bundles a project for a colleague; Import opens one they sent you.',
        how: 'A shared project arrives read-only. Copy it into your own if you want to add to it.',
    },
    {
        mark: '☼',
        title: 'Make Public',
        what: 'Puts the project on the CEM Master map for anyone to explore. Needs a completed server BirdNET run first.',
        // Same precision as the master page's entry: species lists, rankings
        // and clips are gated; full recordings and the aggregate share are not.
        how: 'Threatened, endangered and unassessed species are left out of the map’s species lists, rankings and call clips automatically; your private copy keeps everything. Make Private takes the project off the map on the next pass. Links already handed out are not recalled.',
    },
];

function renderEntries(list) {
    list.replaceChildren();
    ENTRIES.forEach((entry, index) => {
        const li = document.createElement('li');
        li.className = 'help-entry';
        li.style.setProperty('--i', String(index));

        const mark = document.createElement('span');
        mark.className = 'help-mark';
        mark.setAttribute('aria-hidden', 'true');
        mark.textContent = entry.mark;

        const body  = document.createElement('div');
        const title = document.createElement('h3');
        title.textContent = entry.title;
        const what  = document.createElement('p');
        what.className = 'help-what';
        what.textContent = entry.what;
        const how   = document.createElement('p');
        how.className = 'help-how';
        how.textContent = entry.how;

        body.append(title, what, how);
        li.append(mark, body);
        list.append(li);
    });
}

function seenBefore() {
    try {
        return window.localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
        return true; // No storage means no way to avoid nagging; default to quiet.
    }
}

function markSeen() {
    try {
        window.localStorage.setItem(STORAGE_KEY, '1');
    } catch { /* Private mode or blocked storage: the guide reopens next visit. */ }
}

function isTypingTarget(target) {
    if (!(target instanceof HTMLElement)) return false;
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

export function initHelpGuide() {
    const guide    = document.getElementById('help-guide');
    const toggle   = document.getElementById('help-toggle');
    const close    = document.getElementById('help-close');
    const backdrop = document.getElementById('help-backdrop');
    const list     = document.getElementById('help-entries');
    if (!guide || !toggle || !close || !backdrop || !list) return;

    renderEntries(list);

    let lastFocus = null;

    const open = () => {
        if (!guide.hidden) return;
        lastFocus = document.activeElement;
        guide.hidden = false;
        backdrop.hidden = false;
        toggle.setAttribute('aria-expanded', 'true');
        requestAnimationFrame(() => guide.classList.add('is-open'));
        close.focus();
        markSeen();
        debug('help.open');
    };

    const shut = () => {
        if (guide.hidden) return;
        guide.classList.remove('is-open');
        toggle.setAttribute('aria-expanded', 'false');
        backdrop.hidden = true;
        const finish = () => {
            guide.hidden = true;
            guide.removeEventListener('transitionend', finish);
        };
        guide.addEventListener('transitionend', finish);
        setTimeout(finish, 320);   // reduced-motion: no transitionend fires
        if (lastFocus instanceof HTMLElement) lastFocus.focus();
        debug('help.close');
    };

    toggle.addEventListener('click', () => (guide.hidden ? open() : shut()));
    close.addEventListener('click', shut);
    backdrop.addEventListener('click', shut);

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !guide.hidden) { shut(); return; }
        if (event.key === '?' && !isTypingTarget(event.target)) {
            event.preventDefault();
            guide.hidden ? open() : shut();
        }
    });

    // A first-time visitor gets the guide once. After that it waits to be asked.
    if (!seenBefore()) setTimeout(open, 600);
}
