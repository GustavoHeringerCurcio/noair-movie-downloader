import { UpstreamError } from '../types.js';

export const DEFAULT_BOOTSTRAP_INDEXERS = ['YTS', 'LimeTorrents', 'TorrentDownload', '1337x'] as const;

export interface ProwlarrAdminConfig {
  baseUrl: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
}

export interface ProwlarrProvisionResult {
  created: string[];
  enabled: string[];
  skipped: string[];
  failed: Array<{ name: string; reason: string }>;
}

export interface IndexerInfo {
  id: number;
  name: string;
  /** Language tag advertised by the indexer definition (e.g. `pt-BR`); null when unknown. */
  language: string | null;
}

export interface ProwlarrAdminClient {
  /** Idempotently ensures each named indexer exists and is enabled. */
  ensureIndexers(names: readonly string[]): Promise<ProwlarrProvisionResult>;
  /** Lists the configured indexers with their advertised language tag. */
  listIndexers(): Promise<IndexerInfo[]>;
}

interface JsonRecord {
  [key: string]: unknown;
}

const REQUEST_TIMEOUT_MS = 30_000;

export function createProwlarrAdminClient(config: ProwlarrAdminConfig): ProwlarrAdminClient {
  const fetchImpl = config.fetchImpl ?? fetch;
  const base = config.baseUrl.replace(/\/+$/, '');
  const headers = { 'X-Api-Key': config.apiKey, 'Content-Type': 'application/json' };

  async function requestJson(path: string, init: RequestInit = {}): Promise<{ status: number; ok: boolean; body: unknown }> {
    let res: Response;
    try {
      res = await fetchImpl(base + path, {
        ...init,
        headers: { ...headers, ...((init.headers as Record<string, string>) ?? {}) },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new UpstreamError(502, `Prowlarr unreachable: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
    const text = await res.text();
    let body: unknown = text;
    if (text.length > 0) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
    if (res.status === 401) {
      throw new UpstreamError(401, 'Prowlarr API key invalid');
    }
    return { status: res.status, ok: res.ok, body };
  }

  function summarizeError(body: unknown): string {
    if (Array.isArray(body) && body.length > 0) {
      const first = body[0] as JsonRecord;
      if (typeof first.errorMessage === 'string') return first.errorMessage;
      if (typeof first.propertyName === 'string' && typeof first.errorMessage === 'string') {
        return `${String(first.propertyName)}: ${String(first.errorMessage)}`;
      }
    }
    if (body && typeof body === 'object') {
      const record = body as JsonRecord;
      if (typeof record.error === 'string') return record.error;
      if (typeof record.message === 'string') return record.message;
    }
    return typeof body === 'string' && body.length > 0 ? body.slice(0, 200) : 'unknown error';
  }

  function assertOk(result: { status: number; ok: boolean; body: unknown }, context: string): void {
    if (!result.ok) {
      throw new UpstreamError(502, `${context} failed (HTTP ${result.status}): ${summarizeError(result.body)}`);
    }
  }

  async function fetchSchemaList(): Promise<JsonRecord[]> {
    const result = await requestJson('/api/v1/indexer/schema');
    return Array.isArray(result.body) ? (result.body as JsonRecord[]) : [];
  }

  async function fetchAppProfileId(): Promise<number | null> {
    const result = await requestJson('/api/v1/appprofile');
    if (!Array.isArray(result.body)) return null;
    const profiles = result.body as Array<{ id?: number }>;
    return profiles.find((profile) => typeof profile.id === 'number')?.id ?? null;
  }

  async function ensureIndexers(names: readonly string[]): Promise<ProwlarrProvisionResult> {
    const result: ProwlarrProvisionResult = { created: [], enabled: [], skipped: [], failed: [] };

    if (names.length === 0) return result;

    const existingResult = await requestJson('/api/v1/indexer');
    const existing = new Map<string, JsonRecord>();
    if (Array.isArray(existingResult.body)) {
      for (const item of existingResult.body as JsonRecord[]) {
        if (typeof item.name === 'string') existing.set(item.name.toLowerCase(), item);
      }
    }

    let schemaList: JsonRecord[] | null = null;
    let appProfileId: number | null = null;

    for (const name of names) {
      const key = name.toLowerCase();
      const current = existing.get(key);
      if (current) {
        if (current.enable === true) {
          result.skipped.push(name);
          continue;
        }
        const id = typeof current.id === 'number' ? current.id : null;
        if (id === null) {
          result.skipped.push(name);
          continue;
        }
        try {
          const body = JSON.parse(JSON.stringify(current)) as JsonRecord;
          body.enable = true;
          const update = await requestJson(`/api/v1/indexer/${id}`, { method: 'PUT', body: JSON.stringify(body) });
          assertOk(update, `re-enable indexer ${name}`);
          result.enabled.push(name);
        } catch (error) {
          result.failed.push({ name, reason: error instanceof Error ? error.message : String(error) });
        }
        continue;
      }

      if (schemaList === null) schemaList = await fetchSchemaList();
      const schema = schemaList.find((item) => item.name === name) ?? null;
      if (!schema) {
        result.failed.push({ name, reason: `no indexer schema named "${name}"` });
        continue;
      }
      if (appProfileId === null) appProfileId = await fetchAppProfileId();
      if (appProfileId === null) {
        result.failed.push({ name, reason: 'no Prowlarr app profile available' });
        continue;
      }

      try {
        const body = JSON.parse(JSON.stringify(schema)) as JsonRecord;
        delete body.id;
        body.enable = true;
        body.appProfileId = appProfileId;
        const created = await requestJson('/api/v1/indexer', { method: 'POST', body: JSON.stringify(body) });
        assertOk(created, `create indexer ${name}`);
        result.created.push(name);
      } catch (error) {
        result.failed.push({ name, reason: error instanceof Error ? error.message : String(error) });
      }
    }

    return result;
  }

  async function listIndexers(): Promise<IndexerInfo[]> {
    const result = await requestJson('/api/v1/indexer');
    if (!Array.isArray(result.body)) return [];
    const out: IndexerInfo[] = [];
    for (const item of result.body as JsonRecord[]) {
      const id = typeof item.id === 'number' ? item.id : null;
      if (id === null) continue;
      const name = typeof item.name === 'string' ? item.name : '';
      const language =
        typeof item.language === 'string' && item.language.length > 0 ? item.language : null;
      out.push({ id, name, language });
    }
    return out;
  }

  return { ensureIndexers, listIndexers };
}
