/**
 * Static guards on vite.config.js and the built bundle. No server, no network.
 *
 * - Every plugin with a dev-server hook also has a preview-server hook (a
 *   missing configurePreviewServer silently serves index.html for the API).
 * - Every registered /api route has a 405 method-guard case in the offline
 *   integration suite, so new endpoints can't ship untested.
 * - Only browser-scoped keys are injected into the client bundle.
 * - The dev server and every launcher script default to localhost.
 * - The same-origin /api guard runs before every other plugin.
 * - The built bundle contains no server-side secret patterns.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const CONFIG = readFileSync(path.join(ROOT, 'vite.config.js'), 'utf8');
const GUARDS = readFileSync(path.join(ROOT, 'tests/integration/proxy-guards.test.mjs'), 'utf8');

test('every plugin with configureServer also has configurePreviewServer', () => {
  const lines = CONFIG.split('\n');
  const missing = [];
  lines.forEach((line, i) => {
    if (!/^\s+configureServer[(:]/.test(line)) return;
    const window = lines.slice(i, i + 15).join('\n');
    if (!/configurePreviewServer[(:]/.test(window)) {
      const name = lines.slice(Math.max(0, i - 3), i).join(' ').match(/name: '([^']+)'/)?.[1];
      missing.push(name || `line ${i + 1}`);
    }
  });
  assert.deepEqual(missing, [], `plugins missing configurePreviewServer: ${missing.join(', ')}`);
});

test('every /api route registered in vite.config.js has a 405 guard test', () => {
  const routes = [...CONFIG.matchAll(/\.use\('(\/api\/[^']+)'/g)].map((m) => m[1]);
  assert.ok(routes.length >= 30, `expected ≥30 routes, found ${routes.length}`);
  const untested = [...new Set(routes)].filter((route) => !GUARDS.includes(`'${route}`)
    && !GUARDS.includes(`\`${route}`));
  assert.deepEqual(untested, [], `routes without a guard test: ${untested.join(', ')}`);
});

test('client bundle only receives browser-scoped keys via define', () => {
  const defineBlock = CONFIG.match(/define:\s*\{([\s\S]*?)\n\s{4}\}/)?.[1] || '';
  const exposed = [...defineBlock.matchAll(/'import\.meta\.env\.([A-Z0-9_]+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(exposed, ['CESIUM_ION_TOKEN', 'FIRMS_AVAILABLE', 'GOOGLE_MAPS_API_KEY', 'MAPTILER_API_KEY']);
});

test('no custom envPrefix widens what Vite exposes to the browser', () => {
  assert.ok(!/envPrefix\s*:/.test(CONFIG), 'envPrefix set — review which env vars reach the client');
});

test('dev server defaults to localhost, not all interfaces', () => {
  assert.match(CONFIG, /host:\s*env\.HOST\s*\|\|\s*'localhost'/);
});

test('built bundle contains no server-side secret patterns', (t) => {
  const assets = path.join(ROOT, 'dist', 'assets');
  if (!existsSync(assets)) { t.skip('dist/ not built'); return; }
  const SECRET_PATTERNS = [
    ['OpenAI key', /sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}/],
    ['Anthropic key', /sk-ant-[A-Za-z0-9_-]{20,}/],
    ['Private key block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
    // Env var NAMES appear legitimately in UI hints ("AISSTREAM_API_KEY not
    // set"); only value-shaped patterns are leaks. The define allowlist test
    // above guards the actual exposure path.
    ['Bearer token literal', /Bearer [A-Za-z0-9._-]{32,}/],
  ];
  const hits = [];
  for (const file of readdirSync(assets).filter((f) => f.endsWith('.js'))) {
    const text = readFileSync(path.join(assets, file), 'utf8');
    for (const [label, re] of SECRET_PATTERNS) {
      const m = text.match(re);
      // Report the location and a redacted prefix only — never the value.
      if (m) hits.push(`${file}: ${label} (${m[0].slice(0, 6)}…)`);
    }
  }
  assert.deepEqual(hits, [], `possible secrets in bundle:\n${hits.join('\n')}`);
});

test('same-origin API guard is registered before every other plugin', () => {
  const plugins = CONFIG.match(/plugins:\s*\[\s*([a-zA-Z]+)\(/)?.[1];
  assert.equal(plugins, 'sameOriginApiGuard');
});

test('every setting documented in .env.example is read somewhere', () => {
  const example = readFileSync(path.join(ROOT, '.env.example'), 'utf8');
  const names = [...new Set([...example.matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]))];
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory()
    ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  const sources = [...walk(path.join(ROOT, 'src')), ...walk(path.join(ROOT, 'scripts'))]
    .filter((f) => /\.(m?js|sh)$/.test(f) && !f.endsWith('.test.mjs'))
    .map((f) => readFileSync(f, 'utf8'));
  sources.push(CONFIG);
  const unread = names.filter((name) => !sources.some((text) => text.includes(name)));
  assert.deepEqual(unread, [], `documented but never read (dead config): ${unread.join(', ')}`);
});

test('keyless FIRMS fallback never answers no_key (the client would show KEY REQUIRED)', () => {
  const start = CONFIG.indexOf('// No FIRMS key — use NASA EONET as a free, keyless wildfire fallback.');
  assert.ok(start > 0, 'EONET fallback block not found');
  const block = CONFIG.slice(start, CONFIG.indexOf('\n          }\n', start))
    .split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');
  assert.ok(!/sendJson\(\s*503,\s*\{\s*error:\s*'no_key'/.test(block), 'keyless EONET path sends 503 no_key');
});

test('every dev launcher script defaults to localhost, not all interfaces', () => {
  const dir = path.join(ROOT, 'scripts');
  const launchers = readdirSync(dir).filter((f) => f.endsWith('.sh'))
    .filter((f) => /--host/.test(readFileSync(path.join(dir, f), 'utf8')));
  assert.ok(launchers.length >= 3, `expected ≥3 launchers, found ${launchers.length}`);
  const exposed = launchers.filter((f) => !/^HOST="\$\{HOST:-localhost\}"$/m
    .test(readFileSync(path.join(dir, f), 'utf8')));
  assert.deepEqual(exposed, [], `launchers not defaulting to localhost: ${exposed.join(', ')}`);
});

test('SIGMET proxy requests one hazard per call (the upstream rejects lists)', () => {
  assert.ok(!/sigmet\?[^'`]*hazard=[A-Za-z]+,/.test(CONFIG), 'comma-separated hazard list is rejected upstream');
  assert.match(CONFIG, /\['turb', 'ice', 'ts'\]\.map\(/);
});

test('Overpass proxy only caches 2xx and skips refusing mirrors', () => {
  assert.match(CONFIG, /if \(payload\.status >= 200 && payload\.status < 300\s*&& !payload\.rateLimited/);
  assert.ok(!/if \(payload\.status < 500 && !payload\.rateLimited/.test(CONFIG), '4xx responses would be cached');
  assert.match(CONFIG, /status >= 500 \|\| status === 403 \|\| status === 406/);
});

test('keyless EONET fires are not clamped to the FIRMS trailing 24 h', () => {
  assert.match(CONFIG, /category=wildfires&days=14&status=open/);
  assert.match(CONFIG, /const fires = eonet \? entry\.fires : filterTrailing24h\(/);
});

test('radio broad query stays under the per-mirror timeout (limit 500 took ~25 s)', () => {
  assert.match(CONFIG, /limit: index === 0 \? '300' : '220'/);
});

test('OpenSky proxy never makes a poll wait on the ~25 s world-snapshot download', () => {
  const refresh = CONFIG.slice(CONFIG.indexOf('async function refreshOpenSkySnapshot('), CONFIG.indexOf('function startOpenSkyRefresh('));
  assert.equal((refresh.match(/states\/all\?extended=1', \{ headers(?:: retryHeaders)?, signal \}/g) || []).length, 2, 'upstream fetches need a timeout');
  assert.match(refresh, /if \(upstream\.ok\) \{\s*_openskyCacheBody = body;/, 'the shared refresh must fill the cache itself');
  const handler = CONFIG.slice(CONFIG.indexOf("middlewares.use('/api/opensky', async"), CONFIG.indexOf("middlewares.use('/api/opensky-track'"));
  assert.ok(!handler.includes("fetch('https://opensky-network.org"), 'handler must go through startOpenSkyRefresh');
  assert.match(handler, /inCooldown \|\| _openskyRefreshInFlight\)\)/, 'expired cache is served while a refresh runs');
  assert.match(handler, /OPENSKY_COLD_WAIT_MS[\s\S]{0,200}opensky_slow_regional_fallback/, 'cold start falls back after a short wait');
});

test('CelesTrak proxy serves stale TLEs while it revalidates (bulk groups took ~18 s)', () => {
  const proxy = CONFIG.slice(CONFIG.indexOf('function celestrakProxy()'), CONFIG.indexOf("name: 'celestrak-proxy'"));
  assert.match(proxy, /if \(entry\) \{\s*send\(200, entry\.body, 'STALE-REVALIDATING'\);\s*return;\s*\}\s*const fresh = await inflight\.get\(group\);/);
});

test('adsbdb proxy rate-limits only upstream lookups, never cached answers', () => {
  const proxy = CONFIG.slice(CONFIG.indexOf('function adsbdbProxy()'), CONFIG.indexOf("name: 'adsbdb-proxy'"));
  assert.match(proxy, /if \(fresh\(store\[key\]\) \|\| _enrichmentRateLimiter\(clientKey\(req\)\)\) return false;/);
  assert.match(proxy, /if \(limited\(cache\.routes, cs\)\) return;\s*const data = await lookup\('route', cs\);/);
  assert.match(proxy, /if \(limited\(cache\.aircraft, hex\)\) return;\s*const data = await lookup\('aircraft', hex\);/);
});

test('a Caltrans download landing mid-refresh is not masked by the catalog timestamp', () => {
  const refresh = CONFIG.slice(CONFIG.indexOf('async function refreshCctvSources('), CONFIG.indexOf('function buildSyntheticCctvSvg('));
  assert.match(refresh, /const caltransLandedBefore = _caltransLandedCount;/);
  assert.match(refresh, /_cctvSourceCacheAt = _caltransLandedCount === caltransLandedBefore \? Date\.now\(\) : 0;/);
  assert.match(CONFIG, /_caltransLandedCount \+= 1;\s*_cctvSourceCacheAt = 0;/);
});

test('dev server does not watch the proxy cache directory', () => {
  assert.match(CONFIG, /watch: \{ ignored: \['\*\*\/\.gev-cache\/\*\*'\] \}/);
});

test('launches proxy serves the expired cache while it revalidates (upstream takes ~8 s)', () => {
  const handler = CONFIG.slice(CONFIG.indexOf("middlewares.use('/api/launches'"), CONFIG.indexOf("middlewares.use('/api/launches'") + 2000);
  assert.match(handler, /if \(stale\) \{[\s\S]*?request\.promise\.catch\([\s\S]*?send\(res, 200, stale\.body, 'STALE-REVALIDATING'\);\s*return;\s*\}/);
});
