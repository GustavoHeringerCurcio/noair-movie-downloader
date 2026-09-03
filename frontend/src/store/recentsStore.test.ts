import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RECENTS_MAX, RECENTS_KEY, upsertRecent, useRecentsStore } from './recentsStore';
import type { MediaItem } from '../types';

function item(tmdbId: number, mediaType: 'movie' | 'tv' = 'movie', title?: string): MediaItem {
  return {
    tmdbId,
    mediaType,
    title: title ?? `Title ${tmdbId}`,
    year: 2000,
    posterPath: null,
    backdropPath: null,
    overview: '',
    voteAverage: 0,
  };
}

function recentsOfStore(): Array<{ tmdbId: number }> {
  return useRecentsStore.getState().recents.map((r) => r.item);
}

beforeEach(() => {
  window.localStorage.clear();
  useRecentsStore.setState({ recents: [] });
});

describe('upsertRecent', () => {
  it('prepends new items in most-recent-first order', () => {
    let list = upsertRecent([], item(1));
    list = upsertRecent(list, item(2));
    list = upsertRecent(list, item(3));
    expect(list.map((r) => r.item.tmdbId)).toEqual([3, 2, 1]);
  });

  it('dedupes by tmdbId + mediaType, moving the entry to the front', () => {
    let list = upsertRecent([], item(1));
    list = upsertRecent(list, item(2));
    list = upsertRecent(list, item(1, 'movie', 'Renamed'));
    expect(list).toHaveLength(2);
    expect(list[0].item.tmdbId).toBe(1);
    expect(list[0].item.title).toBe('Renamed');
  });

  it('keeps separate tv entries for the same tmdbId as movie entries', () => {
    let list = upsertRecent([], item(1, 'movie'));
    list = upsertRecent(list, item(1, 'tv'));
    expect(list).toHaveLength(2);
  });

  it('caps the list at RECENTS_MAX', () => {
    let list = upsertRecent([], item(0));
    for (let id = 1; id <= RECENTS_MAX + 5; id++) {
      list = upsertRecent(list, item(id));
    }
    expect(list).toHaveLength(RECENTS_MAX);
    expect(list[0].item.tmdbId).toBe(RECENTS_MAX + 5);
  });
});

describe('useRecentsStore', () => {
  it('records to the front and persists to localStorage', () => {
    useRecentsStore.getState().record(item(7));
    useRecentsStore.getState().record(item(8));

    expect(recentsOfStore().map((r) => r.tmdbId)).toEqual([8, 7]);
    const stored = JSON.parse(window.localStorage.getItem(RECENTS_KEY) ?? '[]') as Array<{
      item: { tmdbId: number };
    }>;
    expect(stored.map((r) => r.item.tmdbId)).toEqual([8, 7]);
  });

  it('dedupes through the public record action', () => {
    const store = useRecentsStore.getState();
    store.record(item(1, 'movie', 'Old name'));
    store.record(item(1, 'movie', 'New name'));
    const recents = useRecentsStore.getState().recents;
    expect(recents).toHaveLength(1);
    expect(recents[0].item.title).toBe('New name');
  });

  it('clears recents and removes the stored key', () => {
    useRecentsStore.getState().record(item(1));
    useRecentsStore.getState().clear();
    expect(useRecentsStore.getState().recents).toHaveLength(0);
    expect(window.localStorage.getItem(RECENTS_KEY)).toBeNull();
  });

  it('restores valid recents from localStorage on load', async () => {
    useRecentsStore.getState().record(item(1));
    useRecentsStore.getState().record(item(2));
    vi.resetModules();
    const fresh = await import('./recentsStore');
    expect(fresh.useRecentsStore.getState().recents.map((r) => r.item.tmdbId)).toEqual([2, 1]);
  });

  it('ignores corrupt localStorage data on load', async () => {
    window.localStorage.setItem(RECENTS_KEY, '{not valid json');
    vi.resetModules();
    const fresh = await import('./recentsStore');
    expect(fresh.useRecentsStore.getState().recents).toEqual([]);
  });
});
