import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import { HomePage } from './HomePage';
import { useDownloadsStore } from '../store/downloadsStore';
import { useRecentsStore } from '../store/recentsStore';
import { useSearchStore } from '../store/searchStore';
import type { DownloadRecord, MediaItem } from '../types';

const ITEM: MediaItem = {
  tmdbId: 27205,
  mediaType: 'movie',
  title: 'Inception',
  year: 2010,
  posterPath: '/qL9BmNyBAtPX5N9dXmY1Qa4fPv.jpg',
  backdropPath: '/backdrop.jpg',
  overview: 'A thief who steals corporate secrets.',
  voteAverage: 8.4,
};

function makeDownload(overrides: Partial<DownloadRecord> = {}): DownloadRecord {
  const base: DownloadRecord = {
    id: 1,
    tmdbId: 27205,
    mediaType: 'movie',
    title: 'Shawshank Redemption',
    year: 1994,
    posterPath: '/x.jpg',
    backdropPath: '/backdrop.jpg',
    seasonNumber: null,
    episodeNumber: null,
    infoHash: 'a'.repeat(40),
    torrentName: 'Shawshank.1994.1080p',
    indexer: '1337x',
    sizeBytes: 0,
    state: 'downloading',
    progress: 0.42,
    downloadSpeed: 100,
    uploadSpeed: 0,
    etaSeconds: 60,
    ratio: 0,
    contentPath: null,
    streamFilePath: null,
    streamable: false,
    createdAt: '2026-09-01T00:00:00.000Z',
    completedAt: null,
    resolution: null,
    source: null,
    codec: null,
    hdr: false,
    isDolbyVision: false,
    ...overrides,
  };
  return base;
}

function stubFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ items: [ITEM] }),
    }),
  );
}

beforeEach(() => {
  window.localStorage.clear();
  useDownloadsStore.setState({ downloads: [], connected: false });
  useRecentsStore.setState({ recents: [] });
  useSearchStore.setState({ open: false, query: '', type: 'all', recentSearches: [] });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('HomePage', () => {
  it('renders My Downloads, Recently Viewed and the three browse rails', async () => {
    stubFetch();
    useRecentsStore.getState().record({
      tmdbId: 603,
      mediaType: 'movie',
      title: 'The Matrix',
      year: 1999,
      posterPath: null,
      backdropPath: null,
      overview: '',
      voteAverage: 8.7,
    });
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );

    expect(screen.getByText('Recently Viewed')).toBeInTheDocument();
    expect((await screen.findAllByText('My Downloads')).length).toBeGreaterThan(0);
    expect(await screen.findByText('Trending This Week')).toBeInTheDocument();
    expect(screen.getByText('Best Movies')).toBeInTheDocument();
    expect(screen.getByText('Best Series')).toBeInTheDocument();
    expect((await screen.findAllByRole('button', { name: /inception/i })).length).toBeGreaterThan(0);
  });

  it('shows a hero and empty-state hints when nothing exists yet', async () => {
    stubFetch();
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: /find it\. download it/i })).toBeInTheDocument();
    expect(await screen.findByText(/your downloads will live here/i)).toBeInTheDocument();
    expect(screen.queryByText(/Recently Viewed/i)).not.toBeInTheDocument();
  });

  it('renders completed and in-progress downloads in the My Downloads rail', async () => {
    stubFetch();
    useDownloadsStore.setState({
      downloads: [
        makeDownload({ infoHash: 'b'.repeat(40), progress: 0.42, state: 'downloading' }),
        makeDownload({
          id: 2,
          infoHash: 'c'.repeat(40),
          progress: 1,
          state: 'seeding',
          title: 'The Godfather',
          year: 1972,
          tmdbId: 238,
          streamable: true,
        }),
      ],
    });

    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );

    expect((await screen.findAllByRole('button', { name: /shawshank/i })).length).toBeGreaterThan(0);
    expect((await screen.findAllByRole('button', { name: /the godfather/i })).length).toBeGreaterThan(0);
    const watchButtons = await screen.findAllByRole('button', { name: /^watch/i });
    expect(watchButtons.length).toBeGreaterThanOrEqual(1);
  });

  it('shows recently viewed movies from the recents store', async () => {
    stubFetch();
    useRecentsStore.getState().record({
      tmdbId: 603,
      mediaType: 'movie',
      title: 'The Matrix',
      year: 1999,
      posterPath: null,
      backdropPath: null,
      overview: '',
      voteAverage: 8.7,
    });

    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );

    expect((await screen.findAllByRole('button', { name: /the matrix/i })).length).toBeGreaterThan(0);
  });

  it('collapses multiple copies of one movie into a single card with version chips', async () => {
    stubFetch();
    useDownloadsStore.setState({
      downloads: [
        makeDownload({
          infoHash: 'd'.repeat(40),
          state: 'seeding',
          progress: 1,
          streamable: true,
          resolution: '1080p',
          source: 'WEB-DL',
          codec: 'x264',
        }),
        makeDownload({
          id: 2,
          infoHash: 'e'.repeat(40),
          state: 'seeding',
          progress: 1,
          streamable: true,
          resolution: '2160p',
          source: 'REMUX',
          codec: 'x265',
        }),
      ],
    });

    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );

    expect(
      (await screen.findAllByRole('button', { name: /shawshank redemption \(1994\) — open details/i })).length,
    ).toBe(1);
    expect((await screen.findAllByRole('button', { name: '1080p WEB-DL x264' })).length).toBe(1);
    expect((await screen.findAllByRole('button', { name: '2160p REMUX x265' })).length).toBe(1);
  });

  it('shows an error message when browse sections fail to load', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        json: async () => ({ error: 'TMDB unreachable' }),
      }),
    );

    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );

    expect((await screen.findAllByText(/TMDB unreachable/i)).length).toBeGreaterThan(0);
  });
});
