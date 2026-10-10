/**
 * Integration test helper: starts a Vite preview server on a free localhost
 * port and returns a base URL + teardown function. API middleware comes from
 * vite.config.js; static assets come from the already-built dist/ folder.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';

const HOST = '127.0.0.1';

/** Find a free TCP port on localhost. */
export function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, HOST, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

/** Probe a URL repeatedly until it responds. Resolves once the server is up. */
async function waitForUrl(url, child, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Preview server exited early (code ${child.exitCode})`);
    try {
      await fetch(url, { signal: AbortSignal.timeout(2000) });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  throw new Error(`Preview server at ${url} did not start within ${timeoutMs}ms`);
}

/**
 * Start `vite preview` on a free localhost port.
 *
 * @returns {Promise<{ baseUrl: string, logs: () => string, stop: () => Promise<void> }>}
 */
export async function startPreviewServer() {
  const root = process.cwd();
  if (!existsSync(path.join(root, 'dist', 'index.html'))) {
    throw new Error('dist/ is missing — run `npm run build` before the integration tests');
  }
  const port = await findFreePort();
  const viteBin = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');

  // Spawn node directly (not npx) so SIGTERM reaches the real server process.
  const child = spawn(
    process.execPath,
    [viteBin, 'preview', '--port', String(port), '--strictPort', '--host', HOST],
    { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env } },
  );

  // Drain output so a full pipe can never stall the server; keep a short tail
  // for diagnosing failures.
  let tail = '';
  const keep = (chunk) => { tail = (tail + chunk).slice(-8000); };
  child.stdout.setEncoding('utf8').on('data', keep);
  child.stderr.setEncoding('utf8').on('data', keep);

  const baseUrl = `http://${HOST}:${port}`;
  try {
    await waitForUrl(baseUrl, child, 30_000);
  } catch (err) {
    child.kill('SIGKILL');
    throw new Error(`${err.message}\n--- server output ---\n${tail}`);
  }

  const stop = () => new Promise((resolve) => {
    if (child.exitCode !== null) { resolve(); return; }
    const force = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 5000);
    child.once('exit', () => { clearTimeout(force); resolve(); });
    child.kill('SIGTERM');
  });

  return { baseUrl, logs: () => tail, stop };
}
