/**
 * LIVE integration tests: these make real outbound calls through the proxies
 * to public upstream APIs (CelesTrak, OpenSky, adsb.lol, adsbdb, OSRM,
 * Open Topo Data, CCTV sources). Skipped unless explicitly opted in:
 *
 *   GEV_LIVE_TESTS=1 npm run test:integration:live
 *
 * Assertions are tolerant of upstream outages (502/429 are acceptable); what
 * they pin is that the route is served by the proxy, never the SPA fallback.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startPreviewServer } from '../helpers/server.mjs';

const LIVE = process.env.GEV_LIVE_TESTS === '1';
const skip = LIVE ? false : 'set GEV_LIVE_TESTS=1 to run live upstream tests';

let baseUrl;
let stop;

before(async () => {
  if (!LIVE) return;
  ({ baseUrl, stop } = await startPreviewServer());
}, { timeout: 35_000 });

after(async () => {
  await stop?.();
});

async function get(path, timeoutMs = 10_000) {
  const res = await fetch(`${baseUrl}${path}`, { signal: AbortSignal.timeout(timeoutMs) });
  return { status: res.status, text: await res.text() };
}

const isSpaHtml = (text) => text.trimStart().startsWith('<!DOCTYPE html');

test('GET /api/celestrak/stations returns TLE text', { skip, timeout: 20_000 }, async () => {
  const res = await get('/api/celestrak/stations', 15_000);
  assert.ok(!isSpaHtml(res.text));
  assert.ok([200, 502].includes(res.status), `status ${res.status}`);
  if (res.status === 200) assert.match(res.text, /^1 \d{5}/m, 'no TLE line 1 found');
});

test('GET /api/terrain/heights returns elevation results', { skip, timeout: 20_000 }, async () => {
  const res = await get('/api/terrain/heights?points=0,0;1,1', 15_000);
  assert.ok(!isSpaHtml(res.text));
  assert.ok([200, 206, 502].includes(res.status), `status ${res.status}`);
  if (res.status === 200) assert.equal(JSON.parse(res.text).results.length, 2);
});

test('GET /api/adsbdb/route/UAL123 returns a found flag', { skip, timeout: 20_000 }, async () => {
  const res = await get('/api/adsbdb/route/UAL123', 15_000);
  assert.ok(!isSpaHtml(res.text));
  if (res.status === 200) assert.equal(typeof JSON.parse(res.text).found, 'boolean');
});

test('GET /api/opensky returns state vectors', { skip, timeout: 35_000 }, async () => {
  const res = await get('/api/opensky', 30_000);
  assert.ok(!isSpaHtml(res.text));
});

test('GET /api/adsblol/mil returns aircraft JSON', { skip, timeout: 20_000 }, async () => {
  const res = await get('/api/adsblol/mil', 15_000);
  assert.ok(!isSpaHtml(res.text));
  assert.ok([200, 502].includes(res.status), `status ${res.status}`);
});

test('GET /api/route returns a routing result', { skip, timeout: 20_000 }, async () => {
  const res = await get('/api/route?profile=foot&coords=0,0;0.001,0.001', 15_000);
  assert.ok(!isSpaHtml(res.text));
  assert.equal(typeof JSON.parse(res.text).ok, 'boolean');
});

test('GET /api/cctv/sources returns the camera list', { skip, timeout: 25_000 }, async () => {
  const res = await get('/api/cctv/sources', 20_000);
  assert.ok(!isSpaHtml(res.text));
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(JSON.parse(res.text).sources));
});
