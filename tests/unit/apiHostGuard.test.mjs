/**
 * /api host rule (DNS-rebinding defence): only local names and IP literals,
 * unless the LAN opt-in (HOST=0.0.0.0) allows any host.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedApiHost } from '../../vite.config.js';

test('local names and IP literals are allowed', () => {
  for (const h of ['localhost:4173', 'LOCALHOST', '127.0.0.1:4173', '[::1]:4173', '192.168.1.20:4173', 'mac.local:4173', undefined]) {
    assert.equal(isAllowedApiHost(h), true, String(h));
  }
});

test('foreign domains are rejected (rebinding)', () => {
  for (const h of ['evil.example:4173', 'localhost.evil.example', '127.0.0.1.nip.io:4173', 'local.evil.example']) {
    assert.equal(isAllowedApiHost(h), false, h);
  }
});

test('LAN opt-in allows any host', () => {
  assert.equal(isAllowedApiHost('evil.example:4173', true), true);
});
