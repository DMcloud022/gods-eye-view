/**
 * Static guards on vite.config.js and the built bundle. No server, no network.
 *
 * - Every plugin with a dev-server hook also has a preview-server hook (a
 *   missing configurePreviewServer silently serves index.html for the API).
 * - Every registered /api route has a 405 method-guard case in the offline
 *   integration suite, so new endpoints can't ship untested.
 * - Only browser-scoped keys are injected into the client bundle.
 * - The dev server defaults to localhost.
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
