import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('transcode4kStore (4K → 1080p web copy toggle)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.resetModules();
  });

  it('defaults to off (4K stays external-player)', async () => {
    const { useTranscode4kStore, DEFAULT_TRANSCODE_4K } = await import('./transcode4kStore');
    expect(DEFAULT_TRANSCODE_4K).toBe(false);
    expect(useTranscode4kStore.getState().enabled).toBe(false);
  });

  it('persists enabling across a reload', async () => {
    const first = await import('./transcode4kStore');
    first.useTranscode4kStore.getState().setEnabled(true);
    expect(first.useTranscode4kStore.getState().enabled).toBe(true);

    vi.resetModules();
    const reloaded = await import('./transcode4kStore');
    expect(reloaded.useTranscode4kStore.getState().enabled).toBe(true);
  });

  it('re-disables after being turned on', async () => {
    const { useTranscode4kStore } = await import('./transcode4kStore');
    useTranscode4kStore.getState().setEnabled(true);
    useTranscode4kStore.getState().setEnabled(false);
    expect(useTranscode4kStore.getState().enabled).toBe(false);
  });
});
