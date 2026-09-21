# Debug Logging

Set `DEBUG=true` in the sibling `cem-backend2/.env`, then recreate that Compose
stack with `up -d --build`. This repo's frontend is owned by that stack.
A frontend-only `.env` is not loaded by the owning Compose stack.

Docker generates `/runtime-debug.js` at startup with a boolean flag. Refresh the
page after changing it. `DEBUG=false` is the default; use `up -d` after changing
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

