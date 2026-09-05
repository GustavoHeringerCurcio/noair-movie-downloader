#!/usr/bin/env node
// Aligns the qBittorrent WebUI password with .env's QBITTORRENT_PASS.
//
// linuxserver/qbittorrent starts with a per-session TEMPORARY password (printed
// to its logs) until a permanent one is set. After a volume wipe the backend's
// QBITTORRENT_PASS therefore stops matching and the 2s poll fails with
// "qBittorrent login failed". This script logs in with the temporary password
// and sets a permanent one equal to .env. Run from the host:
//
//   node scripts/qbit-align-password.mjs
//
// Secrets are read from .env and never printed. Uses the host-published Web UI
// (default http://localhost:8080; override with QBIT_WEBUI_URL).
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(root, '.env');

function readEnv() {
  if (!exists(envFile)) throw new Error(`.env not found at ${envFile}`);
  const out = {};
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const value = m[2].replace(/^["']|["']$/g, '');
    out[m[1]] = value;
  }
  return out;
}

function exists(file) {
  try {
    readFileSync(file);
    return true;
  } catch {
    return false;
  }
}

function qbitContainerName() {
  try {
    const names = execFileSync('docker', ['ps', '--filter', 'name=qbittorrent', '--format', '{{.Names}}'], { encoding: 'utf8' })
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (names.length === 0) throw new Error('no running qbittorrent container found');
    return names[0];
  } catch (error) {
    throw new Error(`could not find qbittorrent container: ${error.message}`);
  }
}

function temporaryPassword(container) {
  const logs = execFileSync('docker', ['logs', container], { encoding: 'utf8' });
  const m = logs.match(/temporary password is provided for this session:\s*(\S+)/i);
  return m ? m[1] : null;
}

async function login(base, user, pass) {
  const body = new URLSearchParams({ username: user, password: pass });
  const res = await fetch(`${base}/api/v2/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: base },
    body,
  });
  const ok = res.status === 204 || (res.status === 200 && (await res.text()).trim() === 'Ok.');
  if (!ok) return null;
  const cookies = [];
  if (typeof res.headers.getSetCookie === 'function') cookies.push(...res.headers.getSetCookie());
  const single = res.headers.get('set-cookie');
  if (single) cookies.push(single);
  const parts = cookies.map((c) => c.split(';')[0]).filter(Boolean);
  return parts.length > 0 ? parts.join('; ') : null;
}

async function setPassword(base, cookie, newPass) {
  const payload = encodeURIComponent(JSON.stringify({ web_ui_password: newPass }));
  const res = await fetch(`${base}/api/v2/app/setPreferences`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Referer: base,
      Cookie: cookie,
    },
    body: `json=${payload}`,
  });
  return res.status === 200;
}

async function main() {
  const env = readEnv();
  const user = env.QBITTORRENT_USER || 'admin';
  const desired = env.QBITTORRENT_PASS;
  if (!desired) throw new Error('QBITTORRENT_PASS is not set in .env');
  const base = (process.env.QBIT_WEBUI_URL || 'http://localhost:8080').replace(/\/+$/, '');
  const container = qbitContainerName();

  // Already aligned? Nothing to do.
  const currentCookie = await login(base, user, desired);
  if (currentCookie) {
    console.log('qBittorrent WebUI password already matches .env. Nothing to do.');
    return;
  }

  const temp = temporaryPassword(container);
  if (!temp) {
    throw new Error(
      'No temporary password in qbittorrent logs and the .env password does not work.\n' +
        'The WebUI already has a permanent password you do not know. Reset it by removing the\n' +
        'WebUI\\Password_PBKDF2 lines from qBittorrent.conf (or recreate the qbconfig volume),\n' +
        'then run this script again.',
    );
  }

  const tempCookie = await login(base, user, temp);
  if (!tempCookie) {
    throw new Error('Login with the temporary password failed; it may have already been used. Re-run after restarting qbittorrent.');
  }
  if (!(await setPassword(base, tempCookie, desired))) {
    throw new Error('Failed to set the WebUI password (setPreferences did not return 200).');
  }
  console.log(`qBittorrent WebUI password aligned to .env for user "${user}". Backend polls will now succeed.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
