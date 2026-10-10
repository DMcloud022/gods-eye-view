# tests/

Cross-cutting tests that don't belong next to a single source file. Per-module
unit tests stay co-located in `src/**/*.test.mjs` and run via `npm test`.

| Command | What it runs | Network |
|---|---|---|
| `npm test` | All `src/**/*.test.mjs` unit tests | none |
| `npm run test:config` | `tests/unit/` — static guards on `vite.config.js` and the built bundle | none |
| `npm run test:integration` | `tests/integration/proxy-guards.test.mjs` — every `/api` route's method guard and input validation against a real preview server | localhost only |
| `npm run test:integration:live` | `tests/integration/proxy-live.test.mjs` — real upstream calls through the proxies | **outbound** |
| `npm run test:all` | unit + config + offline integration | localhost only |

Integration tests need a build (`npm run build`). They start `vite preview` on
a free `127.0.0.1` port and stop it afterwards.

When adding a new `/api` route, add a 405 case to `METHOD_GUARDS` in
`proxy-guards.test.mjs` — `test:config` fails until you do.
