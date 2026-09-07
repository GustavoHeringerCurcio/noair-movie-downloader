import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('posterStyleStore (T-002 vertical-poster toggle)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.resetModules();
  });

  it('defaults to vertical 2:3 posters', async () => {
    const { usePosterStyleStore, DEFAULT_POSTER_STYLE } = await import('./posterStyleStore');
    expect(DEFAULT_POSTER_STYLE).toBe('vertical');
    expect(usePosterStyleStore.getState().style).toBe('vertical');
  });

  it('persists the horizontal choice across a reload (localStorage pattern)', async () => {
    const first = await import('./posterStyleStore');
    first.usePosterStyleStore.getState().setStyle('horizontal');
    expect(first.usePosterStyleStore.getState().style).toBe('horizontal');

    vi.resetModules();
    const reloaded = await import('./posterStyleStore');
    expect(reloaded.usePosterStyleStore.getState().style).toBe('horizontal');
  });

  it('maps vertical to the app shell CSS class and horizontal to none', async () => {
    const { posterStyleClass } = await import('./posterStyleStore');
    expect(posterStyleClass('horizontal')).toBe('');
    expect(posterStyleClass('vertical')).toBe('posters-vertical');
  });
});
