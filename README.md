# CEM compute frontend

Researcher workspace for projects, monitoring spots, audio imports, local/server
analysis, and publication to CEM Master. Built with HTML, JavaScript, CSS and
Leaflet; browser storage is initialized separately from optional Google Drive sync.

## Local setup links

- [Local setup in the sibling checkout](../cem-master-backend/docs/local-setup.md)
- [Local setup on GitHub](https://github.com/err400/cem-master-backend/blob/HEAD/docs/local-setup.md)
- [Full setup/environment guide in the sibling checkout](../cem-master-backend/CEM_SETUP_GUIDE.md)

The local guide includes all four clone commands and the database/Alembic startup
sequence. Keep the four repositories side by side so the local links work.

## Setup

The [compute backend](https://github.com/err400/cem-backend) owns the Compose stack
that builds and serves this UI. Keep the repositories side by side or set
`COMPUTE_FRONTEND_CONTEXT` in the compute backend's `.env`.

Follow the [complete setup guide](https://github.com/err400/cem-master-backend/blob/HEAD/CEM_SETUP_GUIDE.md)
for all four repositories and the environment reference. The local UI is
http://localhost:8080; the local compute API is http://localhost:8002.

Deployed UI: https://www.cse.iitd.ernet.in/act4dws5/bio/

Configure `SERVER_BASE_URL` in the compute backend's private `.env` to the actual
public compute API base. Confirm its proxy route; the UI URL does not establish
the API base. Set `ALLOWED_ORIGINS=https://www.cse.iitd.ernet.in` for the deployed
browser origin. The frontend container generates `js/core/Config.js` at startup;
recreate it after environment changes. Do not put backend secrets in browser JS.

## Usage

1. Initialize Storage and choose a local folder (or browser IndexedDB fallback).
2. Create/select a project and add a spot with coordinates.
3. Import WAV recordings named `SPOTNAME_YYYYMMDD_HHMMSS.wav`.
4. Choose server analysis for publication, select BirdNET and the correct dates,
   then wait for successful completion.
5. Make Public; the master indexer reads the shared server data folder.

Google login is optional for Drive synchronization, not required for local
storage initialization. Files imported as references are for the local watcher;
server analysis requires uploadable original files. Browser microphone attachments
are not automatically a substitute for correctly named field WAVs.

For the full verification workflow, see
[HOW_TO_TEST.md](https://github.com/err400/cem-master-backend/blob/HEAD/HOW_TO_TEST.md).

## Development and diagnostics

Main modules live in `js/core/`, `js/ui/`, `js/services/`, and `js/data/`.
The local watcher is `watcher.py`; use it only for local analysis.

```bash
node --test tests/*.test.mjs
```

See [DEBUGGING.md](DEBUGGING.md) for browser logging and the compute backend's
README for pipeline, FileBrowser, Airflow and Earth Engine configuration.
