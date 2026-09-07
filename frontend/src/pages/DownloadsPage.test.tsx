import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import { DownloadsPage } from './DownloadsPage';
import { SettingsPage } from './SettingsPage';
import { useDownloadsStore } from '@/store/downloadsStore';
import { isOpenerSetupDone } from '@/lib/openerInstaller';
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
        makeDownload('b'.repeat(40), { title: 'The Matrix', year: 1999, tmdbId: 603 }),
      ],
    });

    render(
      <MemoryRouter>
        <DownloadsPage />
      </MemoryRouter>,
    );

    expect(screen.getByText('1 ready to watch · 1 downloading · 2 total')).toBeInTheDocument();
    expect(screen.getByText('Shawshank Redemption')).toBeInTheDocument();
    expect(screen.getByText('The Matrix')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /watch/i }).length).toBe(2);
    expect(screen.getAllByRole('button', { name: /remove/i }).length).toBe(2);
  });

  it('groups copies of the same movie under one header and labels them as versions', () => {
    useDownloadsStore.setState({
      downloads: [
        makeDownload('a'.repeat(40), {
          state: 'seeding',
          progress: 1,
          etaSeconds: null,
          resolution: '2160p',
          source: 'REMUX',
          codec: 'x265',
          audioLang: 'en',
        }),
        makeDownload('b'.repeat(40), {
          state: 'seeding',
          progress: 1,
          etaSeconds: null,
          resolution: '1080p',
          source: 'WEB-DL',
          codec: 'x264',
          audioLang: 'pt',
          audioMode: 'dub',
        }),
      ],
    });

    render(
      <MemoryRouter>
        <DownloadsPage />
      </MemoryRouter>,
    );

    expect(screen.getByText('2 versions')).toBeInTheDocument();
    expect(screen.getByText('EN · 2160p REMUX x265')).toBeInTheDocument();
    expect(screen.getByText('PT · Dub · 1080p WEB-DL x264')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /remove/i }).length).toBe(2);
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
    expect(screen.getByText('OMDB_API_KEY')).toBeInTheDocument();
  });

  it('offers friendly player links, a single connect button and an informational status pill', () => {
    // jsdom's user-agent varies by host OS; force a Linux UA so the platform
    // branch under test is deterministic on any machine.
    Object.defineProperty(window.navigator, 'userAgent', {
      value: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120',
      configurable: true,
    });
    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>,
    );

    // The card explains itself in one line, then points new users at official sites.
    expect(screen.getByText('Local player')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /VLC/ })).toHaveAttribute('href', 'https://www.videolan.org/vlc/');
    expect(screen.getByRole('link', { name: /MPV/ })).toHaveAttribute('href', 'https://mpv.io/installation/');
    // Linux only lists Linux-supported players (no Windows-only MPC-HC / PotPlayer).
    expect(screen.queryByRole('link', { name: /MPC-HC/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /PotPlayer/ })).not.toBeInTheDocument();

    // The one-time connector is a single friendly button; the uninstaller lives
    // inside the collapsed technical details (jsdom keeps it in the DOM either way).
    expect(screen.getByRole('button', { name: /download setup file/i })).toBeInTheDocument();
    fireEvent.click(screen.getByText(/What this file does/i));
    expect(screen.getByRole('button', { name: /download uninstaller/i })).toBeInTheDocument();
    expect(screen.getByText('Not connected yet')).toBeInTheDocument();

    // Confirming only informs the status pill (and hides Player hints) — it never gates.
    fireEvent.click(screen.getByRole('button', { name: /I’ve run the file/i }));
    expect(screen.getByText(/Player buttons open your player/i)).toBeInTheDocument();
    expect(isOpenerSetupDone()).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: /mark as not connected/i }));
    expect(screen.getByText('Not connected yet')).toBeInTheDocument();
    expect(isOpenerSetupDone()).toBe(false);
  });
});
