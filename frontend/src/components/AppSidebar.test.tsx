import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import { SidebarProvider } from '@/components/ui/sidebar';
import { AppSidebar } from './AppSidebar';
import { useDownloadsStore } from '@/store/downloadsStore';
import type { DownloadRecord } from '@/types';

function makeDownload(infoHash: string): DownloadRecord {
  return {
    id: 1,
    tmdbId: 27205,
    mediaType: 'movie',
    title: 'Inception',
    year: 2010,
    posterPath: '/x.jpg',
    infoHash,
    torrentName: 'Inception.2010.1080p',
    indexer: 'x',
    sizeBytes: 0,
    state: 'downloading',
    progress: 0.5,
    downloadSpeed: 100,
    uploadSpeed: 0,
    etaSeconds: 60,
    ratio: 0,
    contentPath: null,
    streamFilePath: null,
    streamable: false,
    createdAt: '2026-09-01T00:00:00.000Z',
    completedAt: null,
  };
}

function renderSidebar(initialEntry = '/'): void {
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <SidebarProvider>
        <AppSidebar />
      </SidebarProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useDownloadsStore.setState({ downloads: [], connected: false });
});

afterEach(() => {
  cleanup();
});

describe('AppSidebar', () => {
  it('renders brand and Downloads/Settings navigation', () => {
    renderSidebar();

    expect(screen.getByText('Movie Downloader')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /downloads/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /settings/i })).toBeInTheDocument();
    expect(screen.getByText('Backend offline')).toBeInTheDocument();
  });

  it('shows the live download count badge', () => {
    useDownloadsStore.setState({ downloads: [makeDownload('a'.repeat(40)), makeDownload('b'.repeat(40))] });
    renderSidebar();

    expect(screen.getByRole('link', { name: /downloads\s*2/i })).toBeInTheDocument();
  });

  it('reflects backend connection status', () => {
    useDownloadsStore.setState({ connected: true });
    renderSidebar();

    expect(screen.getByText('Backend connected')).toBeInTheDocument();
  });
});
