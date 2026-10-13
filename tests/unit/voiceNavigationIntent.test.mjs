/**
 * Voice/typed navigation shortcut: clear "go to X" commands skip the LLM and
 * become a fly_to_location call; app-feature commands are left to the LLM.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveNavigationIntent } from '../../vite.config.js';

const args = (transcript) => {
  const call = resolveNavigationIntent(transcript);
  return call ? JSON.parse(call.arguments) : null;
};

test('pre-indexed places use their preset', () => {
  assert.deepEqual(args('go to Tokyo'), { locationId: 'tokyo' });
  assert.deepEqual(args('Take me to Manila.'), { query: 'Manila, Philippines' });
  assert.deepEqual(args('fly to tokyo please'), { locationId: 'tokyo' });
});

test('any place after a navigation verb is geocoded without the LLM', () => {
  assert.deepEqual(args('go to the Eiffel Tower'), { query: 'the Eiffel Tower' });
  assert.deepEqual(args('fly to Mount Fuji!'), { query: 'Mount Fuji' });
  assert.deepEqual(args('where is Machu Picchu?'), { query: 'Machu Picchu' });
  assert.deepEqual(args('search for Sydney Opera House'), { query: 'Sydney Opera House' });
  assert.deepEqual(args('search Reykjavik'), { query: 'Reykjavik' });
  assert.equal(resolveNavigationIntent('jump to Rome').name, 'fly_to_location');
});

test('app-feature commands and ambiguous phrases are left to the LLM', () => {
  for (const t of [
    'go to the next shot', 'go to globe view', 'show me flights', 'show me something cool',
    'fly to the ISS', 'search for satellites', 'turn on traffic', 'Tokyo', 'go to', '',
  ]) {
    assert.equal(resolveNavigationIntent(t), null, t);
  }
});
