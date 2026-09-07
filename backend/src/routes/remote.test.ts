import { describe, expect, it } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../app.js';
import { makeTestDeps } from '../../test/helpers.js';

describe('GET /api/remote/status', () => {
  it('reports starting when no URL has been published yet', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-'));
    const app = createApp(
      makeTestDeps({ config: { ...makeTestDeps().config, remoteDataDir: dir } }),
    );
    const res = await request(app).get('/api/remote/status');
    expect(res.body).toEqual({ mode: 'starting', url: null });
  });

  it('reports the quick-tunnel URL written to the shared volume', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-'));
    fs.writeFileSync(path.join(dir, 'url'), 'https://abc-123.trycloudflare.com\n');
    const app = createApp(
      makeTestDeps({ config: { ...makeTestDeps().config, remoteDataDir: dir } }),
    );
    const res = await request(app).get('/api/remote/status');
    expect(res.body).toEqual({
      mode: 'quick',
      url: 'https://abc-123.trycloudflare.com',
    });
  });

  it('reports a named-tunnel hostname when configured', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-'));
    const app = createApp(
      makeTestDeps({
        config: {
          ...makeTestDeps().config,
          remoteDataDir: dir,
          cloudflareTunnelHostname: 'watch.example.com',
        },
      }),
    );
    const res = await request(app).get('/api/remote/status');
    expect(res.body).toEqual({ mode: 'named', url: 'watch.example.com' });
  });

  it('ignores a non-http value in the url file', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-'));
    fs.writeFileSync(path.join(dir, 'url'), 'garbage\n');
    const app = createApp(
      makeTestDeps({ config: { ...makeTestDeps().config, remoteDataDir: dir } }),
    );
    const res = await request(app).get('/api/remote/status');
    expect(res.body.mode).toBe('starting');
    expect(res.body.url).toBeNull();
  });
});
