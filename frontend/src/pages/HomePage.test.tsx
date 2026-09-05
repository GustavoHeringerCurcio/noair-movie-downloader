import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import { HomePage } from './HomePage';
import { useDownloadsStore } from '../store/downloadsStore';
import { useRecentsStore } from '../store/recentsStore';
import type { DownloadRecord, MediaItem } from '../types';

const ITEM: MediaItem = {
  tmdbId: 27205,
  mediaType: 'movie',
  title: 'Inception',
  year: 2010,
  posterPath: '/qL9BmNyBAtPX5N9dXmY1Qa4fPv.jpg',
  backdropPath: null,
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
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('HomePage', () => {
  it('renders downloads, recents and discover rails on load', async () => {
    stubFetch();
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );

    expect(screen.getByText('Downloads')).toBeInTheDocument();
    expect(screen.getByText('Recently Viewed')).toBeInTheDocument();

    expect(await screen.findByText('Trending This Week')).toBeInTheDocument();
    expect((await screen.findAllByText('Inception')).length).toBeGreaterThan(0);
    expect(screen.getByText('Popular Movies')).toBeInTheDocument();
    expect(screen.getByText('Best Movies')).toBeInTheDocument();
    expect(screen.getByText('Top Rated (Recent)')).toBeInTheDocument();
    expect(screen.getByText('Popular TV')).toBeInTheDocument();
    expect(screen.getByText('Best Series')).toBeInTheDocument();
    expect(screen.queryByText('Now Playing')).not.toBeInTheDocument();
  });

  it('shows empty-state hints for downloads and recents when nothing exists yet', async () => {
    stubFetch();
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );

    expect(await screen.findByText(/start a download to see it here/i)).toBeInTheDocument();
    expect(screen.getByText(/will appear here/i)).toBeInTheDocument();
  });

  it('replaces rails with live search results while typing, then clears back to browse', async () => {
    stubFetch();
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );

    const input = screen.getByLabelText(/search movies and tv/i);
    fireEvent.change(input, { target: { value: 'inception' } });

    expect(await screen.findByText(/Results for “inception”/i)).toBeInTheDocument();
    expect((await screen.findAllByText('Inception')).length).toBeGreaterThan(0);
    expect(screen.queryByText('Downloads')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /clear search/i }));

    expect(await screen.findByText('Downloads')).toBeInTheDocument();
    expect(screen.queryByText(/Results for/i)).not.toBeInTheDocument();
  });

  it('renders completed downloads alongside live in-progress progress', async () => {
    stubFetch();
    useDownloadsStore.setState({
      downloads: [
        makeDownload({
          id: 1,
          infoHash: 'b'.repeat(40),
          progress: 0.42,
          state: 'downloading',
        }),
        makeDownload({
          id: 2,
          infoHash: 'c'.repeat(40),
          progress: 1,
          state: 'seeding',
          title: 'The Godfather',
          year: 1972,
        }),
      ],
    });

    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );

    expect(screen.getByText('Downloading 42%')).toBeInTheDocument();
    expect(await screen.findByText('The Godfather')).toBeInTheDocument();
    expect(screen.getByText('1972')).toBeInTheDocument();
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

    expect(await screen.findByText('The Matrix')).toBeInTheDocument();
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
