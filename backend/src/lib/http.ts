export interface RetryOptions {
  retries: number;
  baseBackoffMs: number;
  timeoutMs: number;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchWithRetry(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  options: RetryOptions,
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= options.retries; attempt++) {
    try {
      const res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(options.timeoutMs) });
      if (res.status >= 500 && attempt < options.retries) {
        await sleep(options.baseBackoffMs * 2 ** attempt);
        continue;
      }
      return res;
    } catch (error) {
      lastError = error;
      if (attempt >= options.retries) throw error;
      await sleep(options.baseBackoffMs * 2 ** attempt);
    }
  }
  throw lastError;
}
