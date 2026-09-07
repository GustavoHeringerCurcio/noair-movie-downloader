import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import type { AppDeps } from '../deps.js';

/**
 * Remote access status (D28, beta). The cloudflared entrypoint writes the live
 * public URL to a file on the shared `remoteaccess` volume (`<remoteDataDir>/url`);
 * this route reads it back so Settings can show the user the URL to open on
 * their TV/other device. No auth: the URL itself is the secret for the beta.
 */
export function createRemoteRouter(deps: AppDeps): Router {
  const router = Router();

  function readUrl(): string | null {
    try {
      const value = fs.readFileSync(path.join(deps.config.remoteDataDir, 'url'), 'utf8').trim();
      return value && /^https?:\/\//.test(value) ? value : null;
    } catch {
      return null;
    }
  }

  router.get('/remote/status', (_req, res) => {
    const url = readUrl();
    const hostname = deps.config.cloudflareTunnelHostname;
    let mode: 'off' | 'starting' | 'quick' | 'named';
    if (!deps.config.remoteAccessEnabled) mode = 'off';
    else if (hostname) mode = 'named';
    else if (url) mode = 'quick';
    else mode = 'starting';
    res.json({
      enabled: deps.config.remoteAccessEnabled,
      mode,
      url: url ?? hostname,
    });
  });

  return router;
}
