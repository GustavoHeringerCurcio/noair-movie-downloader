import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { WatchPage } from './WatchPage';
import { useDownloadsStore } from '../store/downloadsStore';
import { useRecentsStore } from '../store/recentsStore';
import type { DownloadRecord } from '../types';

const HASH = 'ef'.repeat(20);

function makeDownload(overrides: Partial<DownloadRecord> = {}): DownloadRecord {
  return {
    id: 1,
    tmdbId: 100,
    mediaType: 'tv',
    title: 'Some Show',
    year: 2025,
    posterPath: '/x.jpg',
    backdropPath: null,
    seasonNumber: null,
    episodeNumber: null,
    infoHash: HASH,
    torrentName: 'Some.Show.S01.1080p',
    indexer: 'x',
    sizeBytes: 0,
    state: 'seeding',
    progress: 1,
    downloadSpeed: 0,
    uploadSpeed: 0,
    etaSeconds: null,
    ratio: 0,
    contentPath: '/downloads/show',
    streamFilePath: 'show/S01E01.mkv',
    streamable: true,
    createdAt: '2026-09-01T00:00:00.000Z',
    completedAt: '2026-09-02T00:00:00.000Z',
    resolution: '1080p',
    source: 'WEB-DL',
    codec: 'x264',
    hdr: false,
    isDolbyVision: false,
    ...overrides,
  };
}

function stubApi(filesCount: number): void {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/files')) {
      const files = Array.from({ length: filesCount }).map((_, i) => ({
        relative: `show/S01E0${i + 1}.mkv`,
        mime: 'video/x-matroska',
        size: 100 + i,
        complete: true,
      }));
      return { ok: true, status: 200, json: async () => ({ files }) };
    }
    if (url.includes('/playinfo')) {
      const file = new URL(url, 'http://x').searchParams.get('file');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          mode: 'direct',
          videoCodec: 'h264',
          audioCodec: 'aac',
          height: 1080,
          streamUrl: `/api/stream/${HASH}/watch${file ? `?file=${encodeURIComponent(file)}` : ''}`,
          playUrl: `/api/stream/${HASH}`,
          fileUrl: `/api/downloads/${HASH}/file`,
        }),
      };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  }));
}

function renderWatch(): void {
  render(
    <MemoryRouter initialEntries={[`/watch/${HASH}`]}>
      <Routes>
        <Route path="/watch/:infoHash" element={<WatchPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  useDownloadsStore.setState({ downloads: [makeDownload()], connected: true });
  useRecentsStore.setState({ recents: [] });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('WatchPage', () => {
  it('shows a file/episode picker when the download has multiple video files', async () => {
    stubApi(3);
    renderWatch();

    expect(await screen.findByText(/contains 3 video files/i)).toBeInTheDocument();
    expect(screen.getByText('S01E01.mkv')).toBeInTheDocument();
    expect(screen.getByText('S01E03.mkv')).toBeInTheDocument();
  });

  it('auto-plays when the download has a single video file', async () => {
    stubApi(1);
    renderWatch();

    await waitFor(() => {
      expect(document.querySelector('video')).not.toBeNull();
    });
    expect(screen.queryByText(/choose what to play/i)).not.toBeInTheDocument();
  });
});
