import { describe, expect, it } from 'vitest';
import { createProwlarrAdminClient } from './prowlarrAdmin.js';
import { createResponse, makeFetch, type FetchHandler } from '../../test/helpers.js';

const CONFIG = { baseUrl: 'http://prowlarr:9696', apiKey: 'pk' };

interface LoggedRequest {
  method: string;
  url: string;
  body?: unknown;
}

function schemaFor(name: string) {
  return { name, implementation: 'Cardigann', configContract: 'CardigannSettings', enable: false, fields: [{ name: 'definitionFile', value: 'x' }] };
}

function profileList() {
  return createResponse(200, [{ name: 'Standard', enableRss: true, id: 1 }]);
}

const methodOf = (init?: RequestInit) => init?.method ?? 'GET';
const bodyOf = (init?: RequestInit) => {
  const raw = init?.body;
  if (typeof raw !== 'string' || raw.length === 0) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
};

/** Serves GET /api/v1/indexer (existing list) and POST /api/v1/indexer (create). */
function indexerRootHandler(log: LoggedRequest[], existing: unknown[]): FetchHandler {
  return {
    match: (url) => url.endsWith('/api/v1/indexer'),
    respond: (url, init) => {
      log.push({ method: methodOf(init), url, body: bodyOf(init) });
      if (methodOf(init) === 'POST') return createResponse(201, {});
      return createResponse(200, existing);
    },
  };
}

function logged(method: string, log: LoggedRequest[], match: (url: string) => boolean, respond: () => Response): FetchHandler {
  return {
    match,
    respond: (url, init) => {
      log.push({ method: methodOf(init), url, body: bodyOf(init) });
      return respond();
    },
  };
}

describe('ProwlarrAdminClient.ensureIndexers', () => {
  it('creates missing indexers enabled with the first app profile', async () => {
    const log: LoggedRequest[] = [];
    const fetchImpl = makeFetch([
      indexerRootHandler(log, []),
      logged('GET', log, (url) => url.endsWith('/api/v1/indexer/schema'), () => createResponse(200, [schemaFor('YTS'), schemaFor('1337x')])),
      logged('GET', log, (url) => url.endsWith('/api/v1/appprofile'), () => profileList()),
    ]);
    const client = createProwlarrAdminClient({ ...CONFIG, fetchImpl });
    const result = await client.ensureIndexers(['YTS', '1337x']);
    expect(result.created).toEqual(['YTS', '1337x']);
    expect(result.failed).toEqual([]);

    const posts = log.filter((r) => r.method === 'POST');
    expect(posts).toHaveLength(2);
    expect(posts.map((p) => (p.body as { name?: string })?.name)).toEqual(['YTS', '1337x']);
    for (const post of posts) {
      expect((post.body as { enable?: boolean })?.enable).toBe(true);
      expect((post.body as { appProfileId?: number })?.appProfileId).toBe(1);
    }
  });

  it('is idempotent: skips indexers that already exist and are enabled', async () => {
    const log: LoggedRequest[] = [];
    const fetchImpl = makeFetch([
      indexerRootHandler(log, [
        { id: 3, name: 'YTS', enable: true },
        { id: 4, name: 'LimeTorrents', enable: true },
      ]),
    ]);
    const client = createProwlarrAdminClient({ ...CONFIG, fetchImpl });
    const result = await client.ensureIndexers(['YTS', 'LimeTorrents']);
    expect(result.created).toEqual([]);
    expect(result.skipped).toEqual(['YTS', 'LimeTorrents']);
    expect(log.filter((r) => r.method !== 'GET')).toHaveLength(0);
  });

  it('re-enables indexers that exist but are disabled', async () => {
    const log: LoggedRequest[] = [];
    const fetchImpl = makeFetch([
      indexerRootHandler(log, [{ id: 7, name: 'YTS', enable: false }]),
      logged('PUT', log, (url) => url.endsWith('/api/v1/indexer/7'), () => createResponse(200, {})),
    ]);
    const client = createProwlarrAdminClient({ ...CONFIG, fetchImpl });
    const result = await client.ensureIndexers(['YTS']);
    expect(result.enabled).toEqual(['YTS']);
    const put = log.find((r) => r.method === 'PUT');
    expect(put).toBeDefined();
    expect((put?.body as { enable?: boolean })?.enable).toBe(true);
  });

  it('reports unknown indexer names as failed without posting', async () => {
    const log: LoggedRequest[] = [];
    const fetchImpl = makeFetch([
      indexerRootHandler(log, []),
      logged('GET', log, (url) => url.endsWith('/api/v1/indexer/schema'), () => createResponse(200, [schemaFor('YTS')])),
    ]);
    const client = createProwlarrAdminClient({ ...CONFIG, fetchImpl });
    const result = await client.ensureIndexers(['DoesNotExist']);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]?.name).toBe('DoesNotExist');
    expect(result.failed[0]?.reason).toContain('no indexer schema');
    expect(log.filter((r) => r.method === 'POST')).toHaveLength(0);
  });

  it('reports upstream rejection when creation fails', async () => {
    const log: LoggedRequest[] = [];
    const failingCreate: FetchHandler = {
      match: (url) => url.endsWith('/api/v1/indexer'),
      respond: (url, init) => {
        log.push({ method: methodOf(init), url, body: bodyOf(init) });
        if (methodOf(init) === 'POST') {
          return createResponse(400, [{ propertyName: 'AppProfileId', errorMessage: "'App Profile Id' must be greater than '0'." }]);
        }
        return createResponse(200, []);
      },
    };
    const fetchImpl = makeFetch([
      failingCreate,
      logged('GET', log, (url) => url.endsWith('/api/v1/indexer/schema'), () => createResponse(200, [schemaFor('YTS')])),
      logged('GET', log, (url) => url.endsWith('/api/v1/appprofile'), () => profileList()),
    ]);
    const client = createProwlarrAdminClient({ ...CONFIG, fetchImpl });
    const result = await client.ensureIndexers(['YTS']);
    expect(result.created).toEqual([]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]?.reason).toContain('must be greater');
  });

  it('throws UpstreamError(401) when the API key is rejected', async () => {
    const fetchImpl = makeFetch([{ match: () => true, respond: () => createResponse(401, {}) }]);
    const client = createProwlarrAdminClient({ ...CONFIG, fetchImpl });
    await expect(client.ensureIndexers(['YTS'])).rejects.toMatchObject({ status: 401 });
  });
});
