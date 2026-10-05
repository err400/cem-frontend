# Debug Logging

Set `LOG_LEVEL=debug` (or legacy `DEBUG=true`) in `cem-backend/.env`,
then recreate the owning stack with `docker compose up -d api frontend`. This repo's frontend is owned by that stack.
A frontend-only `.env` is not loaded by the owning Compose stack.

Docker generates `/runtime-debug.js` at startup with a boolean flag. Refresh the
page after changing it. `LOG_LEVEL=info` and `DEBUG=false` are the defaults; use `up -d` after changing
the env value, because `restart` does not replace a container's environment.
Static hosting defaults to false in the checked-in runtime config.

Logs appear in browser DevTools Console (enable the Verbose level).
For a temporary per-tab override, use `globalThis.DEBUG = true` or `false`.
For a persistent override, use `localStorage.setItem('DEBUG', 'true')`.
To follow the Docker env again:

```js
delete globalThis.DEBUG;
localStorage.removeItem('DEBUG');
localStorage.removeItem('debug');
```

Precedence: per-tab DEBUG, localStorage DEBUG (or legacy debug), Docker env.
Network diagnostics include request ID, path, method, status, timing, and error
type. They exclude query strings, headers, payloads, credentials, and audio data.
Workflow diagnostics cover application events, upload selection/batches, local job queuing, server dispatch, and downloaded results.
Normal warnings/errors are unchanged. New diagnostics use the small `debug()`
helper, with `debugFetch` wrapping only the app's existing request boundaries.


## Server log levels

The backend supports `LOG_LEVEL=debug|info|error`. At `info`, each completed API
request records its route, status, elapsed time and server request ID; `error`
keeps failed requests and job errors. Browser request traces are debug-only.
Server logs persist by default at `data/logs/cem-backend/app.log` in the compute
backend checkout. See the
[compute logging guide](https://github.com/err400/cem-backend/blob/master/DEBUGGING.md)
for the descriptive level table and troubleshooting commands.
