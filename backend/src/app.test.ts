import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { makeTestDeps } from '../test/helpers.js';
import request from 'supertest';

const app = createApp(makeTestDeps());

describe('GET /api/health', () => {
  it('returns { ok: true }', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
