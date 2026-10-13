import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const ui = read('src/ui.js');

/** Source of one #location-search listener, from its addEventListener to the next one. */
function searchListener(event) {
  const start = ui.indexOf(`this._locationSearch.addEventListener('${event}'`);
  assert.ok(start > 0, `location search '${event}' listener is missing`);
  const end = ui.indexOf('this._locationSearch.addEventListener(', start + 1);
  return ui.slice(start, end > start ? end : start + 2000);
}

test('typing always replaces the suggestion list and resets the keyboard highlight', () => {
  const input = searchListener('input');
  assert.ok(!/if \(local\.length\)/.test(input), 'stale list kept when there are no local hits');
  assert.match(input, /this\._acSuggestions = local;\s*this\._acActiveIndex = -1;\s*this\._acRender\(\);/);
});

test('IME composition Enter does not submit the search', () => {
  const keydown = searchListener('keydown');
  const guard = keydown.indexOf('e.isComposing');
  assert.ok(guard > 0, 'no isComposing guard');
  assert.ok(guard < keydown.indexOf("e.key === 'Enter'"), 'guard must run before Enter handling');
});

test('the blur hide timer is cancelled on refocus and on typing', () => {
  assert.match(searchListener('blur'), /this\._acBlurTimer = setTimeout/);
  assert.match(searchListener('focus'), /clearTimeout\(this\._acBlurTimer\)/);
  assert.match(searchListener('input'), /clearTimeout\(this\._acBlurTimer\)/);
});

test('autocomplete proxy does not cache upstream errors as empty results', () => {
  const config = read('vite.config.js');
  const start = config.indexOf("name: 'autocomplete-proxy'");
  const body = config.slice(config.lastIndexOf('photonUrl.searchParams.set', start), start);
  const okCheck = body.indexOf('if (!upstream.ok) throw');
  assert.ok(okCheck > 0, 'upstream.ok is not checked');
  assert.ok(okCheck < body.indexOf('CACHE.set('), 'ok check must precede caching');
});

test('Space Missions hover pick is throttled and only clears a cursor it set', () => {
  const src = read('src/data/rocketLaunches.js');
  const fn = src.slice(src.indexOf('function hoverMissionAt('), src.indexOf('function clearMissionHoverPick('));
  assert.match(fn, /MISSION_HOVER_PICK_MS - \(now - _hoverPickAt\)/);
  assert.match(fn, /if \(hovered === _hoverCursorOwned\) return;/);
  const move = src.indexOf('Cesium.ScreenSpaceEventType.MOUSE_MOVE');
  assert.ok(!/drillPick/.test(src.slice(src.lastIndexOf('_moveHandler.setInputAction', move), move)),
    'MOUSE_MOVE handler must go through the throttled hoverMissionAt');
});

test('CCTV hover throttle schedules a trailing pass and clears it with the card', () => {
  const src = read('src/data/cctv.js');
  const fn = src.slice(src.indexOf('function handleHoverMove('), src.indexOf('function cancelHoverRelease('));
  assert.match(fn, /_hoverTrailingTimer = setTimeout\(\(\) => handleHoverMove\(pending\), wait\)/);
  const clear = src.slice(src.indexOf('function clearHoverCard('), src.indexOf('function clearHoverCard(') + 300);
  assert.match(clear, /clearTimeout\(_hoverTrailingTimer\)/);
});

test('autocomplete proxy only uses a User-Agent defined in its own scope', () => {
  const config = read('vite.config.js');
  const start = config.indexOf('function autocompleteProxy()');
  const fn = config.slice(start, config.indexOf("name: 'autocomplete-proxy'", start));
  assert.ok(!fn.includes('NOMINATIM_UA'), 'NOMINATIM_UA is out of scope here and throws a ReferenceError');
  assert.match(fn, /const PHOTON_UA = /);
  assert.match(fn, /'User-Agent': PHOTON_UA/);
});
