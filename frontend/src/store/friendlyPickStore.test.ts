import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_FRIENDLY_PICK_MODE,
  FRIENDLY_PICK_STORAGE_KEY,
  useFriendlyPickStore,
} from './friendlyPickStore';

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  window.localStorage.clear();
  useFriendlyPickStore.setState({ mode: DEFAULT_FRIENDLY_PICK_MODE });
});

describe('friendlyPickStore (T-003)', () => {
  it('defaults to most-seeded so today’s pick behaviour is unchanged', () => {
    expect(useFriendlyPickStore.getState().mode).toBe('most-seeded');
  });

  it('setMode updates the in-memory mode and persists it to localStorage', async () => {
    useFriendlyPickStore.getState().setMode('web-playable');
    expect(useFriendlyPickStore.getState().mode).toBe('web-playable');
    await flush();
    const stored = JSON.parse(window.localStorage.getItem(FRIENDLY_PICK_STORAGE_KEY) ?? '{}') as {
      state: { mode: unknown };
    };
    expect(stored.state.mode).toBe('web-playable');
  });

  it('restores the persisted choice on a fresh load (reload survives)', async () => {
    useFriendlyPickStore.getState().setMode('web-playable');
    await flush();
    // Simulate a page reload: re-create the store module so it rehydrates from
    // localStorage instead of reusing the in-memory state above.
    vi.resetModules();
    const fresh = await import('./friendlyPickStore');
    await flush();
    expect(fresh.useFriendlyPickStore.getState().mode).toBe('web-playable');
  });

  it('falls back to the default when the persisted value is unknown/corrupt', async () => {
    window.localStorage.setItem(
      FRIENDLY_PICK_STORAGE_KEY,
      JSON.stringify({ state: { mode: 'not-a-mode' }, version: 0 }),
    );
    vi.resetModules();
    const fresh = await import('./friendlyPickStore');
    await flush();
    expect(fresh.useFriendlyPickStore.getState().mode).toBe('most-seeded');
  });
});
