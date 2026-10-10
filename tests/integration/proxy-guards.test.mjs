/**
 * Offline integration tests for every Vite API middleware.
 *
 * Each request here is rejected (method guard, input validation, or a purely
 * local status route) BEFORE the handler reaches any upstream fetch, so this
 * suite makes no outbound network calls and is safe to run anytime.
 *
 * Covers: method guards (405), input validation (400/403/404/413), status
 * code correctness, and that local status routes expose no secret material.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startPreviewServer } from '../helpers/server.mjs';

let baseUrl;
let stop;

before(async () => {
  ({ baseUrl, stop } = await startPreviewServer());
}, { timeout: 35_000 });

after(async () => {
  await stop?.();
});

/** Issue a request and return status, raw text, and parsed JSON (or null). */
async function call(verb, path, { body, headers } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: verb,
    body,
    headers,
    signal: AbortSignal.timeout(10_000),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, headers: res.headers, text, json };
}

const isSpaHtml = (text) => text.trimStart().startsWith('<!DOCTYPE html');

// ─── Method guards: every endpoint rejects the wrong verb with 405 ─────────

const METHOD_GUARDS = [
  // [verb that must be rejected, path]
  ['POST', '/api/celestrak/stations'],
  ['POST', '/api/launches'],
  ['POST', '/api/tomtom/status'],
  ['POST', '/api/firms/status'],
  ['DELETE', '/api/terrain/heights?points=0,0'],
  ['POST', '/api/adsbdb/route/UAL123'],
  ['GET', '/api/overpass'],
  ['POST', '/api/route?profile=foot&coords=0,0;0.001,0.001'],
  ['POST', '/api/opensky'],
  ['POST', `/api/gbfs/${encodeURIComponent('https://example.com/station_status.json')}`],
  ['POST', '/api/cctv/sources'],
  ['POST', '/api/adsblol/mil'],
  ['POST', '/api/ais-live'],
  ['POST', '/api/opensky-track?icao24=abc123'],
  ['POST', '/api/adsblol/trace?hex=abc123'],
  ['GET', '/api/openai/hud-summary'],
  ['GET', '/api/realtime/debug-log'],
  ['PUT', '/api/realtime/token'],
  ['POST', '/api/voice/mode'],
  ['GET', '/api/gev-voice/chat'],
  ['GET', '/api/voice/transcribe'],
  ['POST', '/api/google/nearby-places?lat=0&lon=0'],
  ['POST', '/api/google/text-search?q=x&lat=0&lon=0'],
  ['POST', '/api/geocode?q=x'],
  ['POST', '/api/military-installations'],
  ['POST', '/api/regional-brief?lat=0&lon=0'],
  ['POST', '/api/weather-effects?lat=0&lon=0'],
  ['POST', '/api/noaa-alerts'],
  ['POST', '/api/sigmet'],
  ['POST', '/api/autocomplete?q=manila'],
  ['POST', '/api/radio/stations'],
  ['GET', '/api/radio/click/00000000-0000-0000-0000-000000000000'],
];

for (const [verb, path] of METHOD_GUARDS) {
  test(`${verb} ${path.split('?')[0]} → 405`, async () => {
    const res = await call(verb, path);
    assert.equal(res.status, 405, `expected 405, got ${res.status}: ${res.text.slice(0, 120)}`);
    assert.ok(!isSpaHtml(res.text), 'route fell through to the SPA fallback');
  });
}

// ─── Local status routes: correct shape, no secret material ────────────────

test('GET /api/tomtom/status exposes only the documented fields', async () => {
  const res = await call('GET', '/api/tomtom/status');
  assert.equal(res.status, 200);
  assert.deepEqual(Object.keys(res.json).sort(), ['budget', 'dailyCount', 'date', 'hasKey']);
  assert.equal(typeof res.json.hasKey, 'boolean');
});

test('GET /api/voice/mode exposes only the documented fields', async () => {
  const res = await call('GET', '/api/voice/mode');
  assert.equal(res.status, 200);
  assert.deepEqual(Object.keys(res.json).sort(), ['mode', 'webVoiceAvailable']);
  assert.ok(['realtime', 'web'].includes(res.json.mode));
  assert.equal(res.headers.get('cache-control'), 'no-store');
});

test('GET /api/autocomplete with a 1-char query returns empty suggestions locally', async () => {
  const res = await call('GET', '/api/autocomplete?q=a');
  assert.equal(res.status, 200);
  assert.deepEqual(res.json, { suggestions: [] });
});

// ─── Input validation ──────────────────────────────────────────────────────

test('celestrak rejects a malformed group name', async () => {
  const res = await call('GET', '/api/celestrak/bad!group');
  assert.equal(res.status, 400);
});

test('tomtom rejects an out-of-range tile and unknown sub-paths', async () => {
  assert.equal((await call('GET', '/api/tomtom/flow/99/0/0.pbf')).status, 400);
  assert.equal((await call('GET', '/api/tomtom/elsewhere')).status, 404);
});

test('terrain heights: unparseable points → 400', async () => {
  const res = await call('GET', '/api/terrain/heights?points=abc');
  assert.equal(res.status, 400);
});

test('terrain heights: more than 2000 points → 400 (client error, not 500)', async () => {
  const points = Array.from({ length: 2001 }, (_, i) => `0,${i % 90}`).join(';');
  const res = await call('GET', `/api/terrain/heights?points=${points}`);
  assert.equal(res.status, 400);
  assert.match(res.json.error, /too many points \(2001\)/);
});

test('adsbdb rejects bad callsign, bad hex, and unknown kinds', async () => {
  assert.equal((await call('GET', '/api/adsbdb/route/!!')).status, 400);
  assert.equal((await call('GET', '/api/adsbdb/type/zz')).status, 400);
  assert.equal((await call('GET', '/api/adsbdb/other/x')).status, 404);
});

test('gbfs SSRF guard: missing, malformed, non-https, disallowed host, disallowed path', async () => {
  const gbfs = (target) => call('GET', `/api/gbfs/${target}`);
  assert.equal((await call('GET', '/api/gbfs/')).status, 400, 'missing target');
  assert.equal((await gbfs('%E0%A4%A')).status, 400, 'bad percent-encoding');
  assert.equal((await gbfs(encodeURIComponent('http://toronto.publicbikesystem.net/station_status.json'))).status, 400, 'plain http');
  assert.equal((await gbfs(encodeURIComponent('https://169.254.169.254/station_status.json'))).status, 403, 'metadata IP');
  assert.equal((await gbfs(encodeURIComponent('https://evil.example.com/station_status.json'))).status, 403, 'unlisted host');
  assert.equal((await gbfs(encodeURIComponent('https://toronto.publicbikesystem.net/gbfs/secret.json'))).status, 400, 'non-station path');
});

test('overpass rejects an empty body (400) and an oversized body (413)', async () => {
  assert.equal((await call('POST', '/api/overpass', { body: '' })).status, 400);
  const huge = 'x'.repeat(25 * 1024);
  assert.equal((await call('POST', '/api/overpass', { body: huge })).status, 413);
});

test('route rejects bad profile, too few coordinates, and over-long legs', async () => {
  const route = async (qs) => (await call('GET', `/api/route?${qs}`)).json;
  assert.deepEqual(await route('profile=boat&coords=0,0;0.01,0.01'), { ok: false, error: 'invalid profile' });
  assert.deepEqual(await route('profile=foot&coords=0,0'), { ok: false, error: 'need 2-12 coordinates' });
  assert.deepEqual(await route('profile=foot&coords=0,0;0,91'), { ok: false, error: 'invalid coordinate' });
  assert.deepEqual(await route('profile=car&coords=0,0;20,0'), { ok: false, error: 'route leg too long' });
});

test('track backfill rejects malformed aircraft identifiers', async () => {
  assert.equal((await call('GET', '/api/opensky-track?icao24=xyz')).status, 400);
  assert.equal((await call('GET', '/api/adsblol/trace?hex=not-hex')).status, 400);
});

test('voice chat requires a transcript', async () => {
  const res = await call('POST', '/api/gev-voice/chat', {
    body: JSON.stringify({}),
    headers: { 'Content-Type': 'application/json' },
  });
  assert.equal(res.status, 400);
});

test('google places routes validate coordinates and query', async () => {
  assert.equal((await call('GET', '/api/google/nearby-places?lat=999&lon=0')).status, 400);
  assert.equal((await call('GET', '/api/google/text-search?lat=0&lon=0')).status, 400);
});

test('bbox / point routes reject missing coordinates', async () => {
  assert.equal((await call('GET', '/api/military-installations')).status, 400);
  assert.equal((await call('GET', '/api/regional-brief')).status, 400);
  assert.equal((await call('GET', '/api/weather-effects')).status, 400);
});

test('radio: unknown station click → 404, unknown route → 404', async () => {
  assert.equal((await call('POST', '/api/radio/click/00000000-0000-0000-0000-000000000000')).status, 404);
  assert.equal((await call('GET', '/api/radio/nope')).status, 404);
});

// ─── Same-origin guard: other sites in the browser can't drive the API ─────

test('cross-origin browser requests to /api are rejected with 403', async () => {
  const evil = { Origin: 'https://evil.example' };
  for (const [verb, path] of [['POST', '/api/gev-voice/chat'], ['GET', '/api/realtime/token'], ['GET', '/api/voice/mode']]) {
    const res = await call(verb, path, { headers: evil, body: verb === 'POST' ? '{}' : undefined });
    assert.equal(res.status, 403, `${verb} ${path}: expected 403, got ${res.status}`);
  }
  // A different local port is a different origin too.
  const port = new URL(baseUrl).port === '1' ? '2' : '1';
  assert.equal((await call('GET', '/api/voice/mode', { headers: { Origin: `http://127.0.0.1:${port}` } })).status, 403);
  // No Origin (e.g. <img>/<form> GET) but the browser flags it cross-site.
  assert.equal((await call('GET', '/api/voice/mode', { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  assert.equal((await call('GET', '/api/voice/mode', { headers: { Origin: 'null' } })).status, 403);
});

test('same-origin and header-less requests still reach the handlers', async () => {
  const self = { Origin: new URL(baseUrl).origin, 'Sec-Fetch-Site': 'same-origin' };
  assert.equal((await call('GET', '/api/voice/mode', { headers: self })).status, 200);
  assert.equal((await call('POST', '/api/gev-voice/chat', { headers: { ...self, 'Content-Type': 'application/json' }, body: '{}' })).status, 400);
  assert.equal((await call('GET', '/api/voice/mode', { headers: { 'Sec-Fetch-Site': 'none' } })).status, 200);
  assert.equal((await call('GET', '/api/voice/mode')).status, 200);
});
