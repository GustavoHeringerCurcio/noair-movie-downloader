import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import { DownloadsPage } from './DownloadsPage';
import { SettingsPage } from './SettingsPage';
import { useDownloadsStore } from '@/store/downloadsStore';
import type { DownloadRecord } from '@/types';

function makeDownload(infoHash: string, overrides: Partial<DownloadRecord> = {}): DownloadRecord {
  return {
    id: 1,
    tmdbId: 27205,
    mediaType: 'movie',
    title: 'Shawshank Redemption',
    year: 1994,
    posterPath: '/x.jpg',
    backdropPath: null,
    seasonNumber: null,
    episodeNumber: null,
    infoHash,
    torrentName: 'Shawshank.1994.1080p',
    indexer: 'x',
    sizeBytes: 0,
    state: 'downloading',
    progress: 0.42,
    downloadSpeed: 0,
    uploadSpeed: 0,
    etaSeconds: null,
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
}

beforeEach(() => {
  window.localStorage.clear();
  useDownloadsStore.setState({ downloads: [], connected: false });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('DownloadsPage', () => {
  it('shows an empty state when nothing is downloaded', () => {
    render(
      <MemoryRouter>
        <DownloadsPage />
      </MemoryRouter>,
    );

    expect(screen.getByText('Downloads')).toBeInTheDocument();
    expect(screen.getByText(/nothing downloaded yet/i)).toBeInTheDocument();
  });

  it('renders download rows with status, progress and actions', () => {
    useDownloadsStore.setState({
      downloads: [
        makeDownload('a'.repeat(40), { state: 'seeding', progress: 1, etaSeconds: null }),
        makeDownload('b'.repeat(40), { title: 'The Matrix', year: 1999 }),
      ],
    });

    render(
      <MemoryRouter>
        <DownloadsPage />
      </MemoryRouter>,
    );

    expect(screen.getByText('1 completed · 1 in progress · 2 total')).toBeInTheDocument();
    expect(screen.getByText('Shawshank Redemption')).toBeInTheDocument();
    expect(screen.getByText('The Matrix')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /watch/i }).length).toBe(2);
    expect(screen.getAllByRole('button', { name: /remove/i }).length).toBe(2);
  });

  it('shows quality chips so duplicate copies of a title are distinguishable', () => {
    useDownloadsStore.setState({
      downloads: [
        makeDownload('a'.repeat(40), {
          state: 'seeding',
          progress: 1,
          etaSeconds: null,
          resolution: '2160p',
          source: 'REMUX',
          codec: 'x265',
        }),
        makeDownload('b'.repeat(40), {
          title: 'Blade Runner 2049',
          torrentName: 'Blade.Runner.2049.2017.1080p.WEB-DL',
          resolution: '1080p',
          source: 'WEB-DL',
          codec: 'x264',
        }),
      ],
    });

    render(
      <MemoryRouter>
        <DownloadsPage />
      </MemoryRouter>,
    );

    expect(screen.getByText('2160p')).toBeInTheDocument();
    expect(screen.getByText('REMUX')).toBeInTheDocument();
    expect(screen.getByText('1080p')).toBeInTheDocument();
    expect(screen.getByText('WEB-DL')).toBeInTheDocument();
    expect(screen.getByText(/Blade\.Runner/)).toBeInTheDocument();
  });
});

describe('SettingsPage', () => {
  it('renders system, configuration and about cards', () => {
    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>,
    );

    expect(screen.getByText('System')).toBeInTheDocument();
    expect(screen.getByText('Configuration')).toBeInTheDocument();
    expect(screen.getByText('About')).toBeInTheDocument();
    expect(screen.getByText('TMDB_API_KEY')).toBeInTheDocument();
  });
});
