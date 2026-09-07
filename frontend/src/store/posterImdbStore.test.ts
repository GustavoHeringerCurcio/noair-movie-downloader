import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('posterImdbStore (IMDb badge on posters toggle)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.resetModules();
  });

  it('defaults to showing the IMDb badge on posters', async () => {
    const { usePosterImdbStore, DEFAULT_POSTER_IMDB } = await import('./posterImdbStore');
    expect(DEFAULT_POSTER_IMDB).toBe(true);
    expect(usePosterImdbStore.getState().show).toBe(true);
  });

  it('persists turning the badge off across a reload (localStorage pattern)', async () => {
    const first = await import('./posterImdbStore');
    first.usePosterImdbStore.getState().setShow(false);
    expect(first.usePosterImdbStore.getState().show).toBe(false);

    vi.resetModules();
    const reloaded = await import('./posterImdbStore');
    expect(reloaded.usePosterImdbStore.getState().show).toBe(false);
  });

  it('re-enables the badge after it was turned off', async () => {
    const { usePosterImdbStore } = await import('./posterImdbStore');
    usePosterImdbStore.getState().setShow(false);
    usePosterImdbStore.getState().setShow(true);
    expect(usePosterImdbStore.getState().show).toBe(true);
  });
});
