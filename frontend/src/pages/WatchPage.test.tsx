import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { WatchPage } from './WatchPage';
import { useDownloadsStore } from '../store/downloadsStore';
import { useRecentsStore } from '../store/recentsStore';
import { useToastStore } from '../store/toastStore';
import { shakaDouble } from '../components/ShakaPlayer.double';
import { SETUP_DONE_KEY } from '../lib/openerInstaller';
import type { DownloadRecord } from '../types';

vi.mock('../components/ShakaPlayer', async () => {
  const { ShakaPlayerDouble } = await import('../components/ShakaPlayer.double');
  return { ShakaPlayer: ShakaPlayerDouble };
});

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
  shakaDouble.reset();
  useDownloadsStore.setState({ downloads: [makeDownload()], connected: true });
  useRecentsStore.setState({ recents: [] });
  useToastStore.setState({ toasts: [] });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('WatchPage', () => {
  it('shows a file/episode picker when the download has multiple video files', async () => {
    stubApi(3);
    renderWatch();

    expect(await screen.findByText(/contains 3 videos/i)).toBeInTheDocument();
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

const MANIFEST = `/api/playback/${HASH}/hls/master.m3u8`;
const COMPAT_MANIFEST = '/api/playback/pkg/movie.mkv-compat/master.m3u8';

interface HlsStatus {
  phase: 'packaging' | 'ready' | 'failed';
  progress: number;
  error: string | null;
  playable?: boolean;
}

function hlsPlayInfo(): Record<string, unknown> {
  return {
    mode: 'hls',
    videoCodec: 'h264',
    audioCodec: 'ac3',
    height: 1080,
    container: 'mkv',
    durationSeconds: 600,
    video: { index: 0, codec: 'h264', width: 1920, height: 1080, hdr: false },
    audioTracks: [
      { index: 1, codec: 'ac3', language: 'en', title: null, channels: 6, default: true },
      { index: 2, codec: 'aac', language: 'pt', title: null, channels: 2, default: false },
    ],
    subtitleTracks: [],
    sidecarSubtitles: [],
    streamUrl: `/api/stream/${HASH}`,
    playUrl: `/api/stream/${HASH}`,
    fileUrl: `/api/downloads/${HASH}/file`,
    manifestUrl: MANIFEST,
  };
}

function singleCompleteFile(): Record<string, unknown> {
  return {
    relative: 'movie.mkv',
    mime: 'video/x-matroska',
    size: 1024,
    complete: true,
    seasonNumber: null,
    episodeNumber: null,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

const DEFAULT_HLS_STATUS: HlsStatus = { phase: 'ready', progress: 1, error: null };

/**
 * Fetch stub for the HLS flow. The status queue is consumed in order and falls
 * back to `ready` once empty, so tests can push more statuses later (e.g. after
 * a retry) to drive the transition packaging → ready. `opts.mseProbe` sets the
 * playinfo preflight candidate list.
 */
function stubHls(
  statuses: HlsStatus[],
  opts: { mseProbe?: string[]; compat?: boolean } = {},
): {
  calls: { playinfo: number; status: number; deleted: number; statusUrls: string[] };
  push: (status: HlsStatus) => void;
} {
  const queue = [...statuses];
  const calls = { playinfo: 0, status: 0, deleted: 0, statusUrls: [] as string[] };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/hls/status')) {
        calls.status += 1;
        calls.statusUrls.push(url);
        const next = queue.shift() ?? DEFAULT_HLS_STATUS;
        return jsonResponse(next);
      }
      if (url.includes('/playinfo')) {
        calls.playinfo += 1;
        const playinfo = { ...hlsPlayInfo() };
        if (opts.mseProbe !== undefined) playinfo.mseProbe = opts.mseProbe;
        if (opts.compat) playinfo.compat = { manifestUrl: COMPAT_MANIFEST, targetHeight: null };
        return jsonResponse(playinfo);
      }
      if (url.includes('/files')) {
        return jsonResponse({ files: [singleCompleteFile()] });
      }
      if (init?.method === 'DELETE') {
        calls.deleted += 1;
        return jsonResponse(undefined, 204);
      }
      return jsonResponse({});
    }),
  );
  return { calls, push: (status: HlsStatus) => queue.push(status) };
}

function shakaVideo(): HTMLVideoElement {
  return document.querySelector('[data-testid="shaka"]') as HTMLVideoElement;
}

describe('WatchPage HLS playback', () => {
  it('mounts the Shaka player once the package is ready', async () => {
    stubHls([{ phase: 'ready', progress: 1, error: null }]);
    renderWatch();

    await waitFor(() => expect(shakaDouble.mounts).toBe(1));
    expect(shakaDouble.latest?.manifestUrl).toBe(MANIFEST);
    expect(shakaVideo()).toBeInTheDocument();
    expect(screen.queryByText(/building a web-compatible copy/i)).not.toBeInTheDocument();
  });

  it('shows packaging progress before the player mounts once ready', async () => {
    stubHls([{ phase: 'packaging', progress: 0.4, error: null }]);
    renderWatch();

    expect(await screen.findByText(/building a web-compatible copy/i)).toBeInTheDocument();
    expect(await screen.findByText(/40%/)).toBeInTheDocument();
    expect(shakaDouble.mounts).toBe(0);

    // the status poll ticks every 2s; once it reports ready the player mounts
    await waitFor(() => expect(shakaDouble.mounts).toBe(1), { timeout: 6000 });
    expect(shakaDouble.latest?.manifestUrl).toBe(MANIFEST);
  });

  it('mounts the player as soon as the package is playable, while the copy still builds (W-001)', async () => {
    stubHls([{ phase: 'packaging', progress: 0.2, error: null, playable: true }]);
    renderWatch();

    // No full "wait for the whole film" — the player starts on the early segments.
    await waitFor(() => expect(shakaDouble.mounts).toBe(1), { timeout: 6000 });
    expect(shakaDouble.latest?.manifestUrl).toBe(MANIFEST);
    expect(screen.getByRole('status')).toHaveTextContent(/you can watch now/i);

    // The poll keeps running and the player stays mounted once the copy is done.
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument(), { timeout: 6000 });
    expect(shakaDouble.mounts).toBe(1);
  });

  it('gates mounting behind the resume prompt and starts at the saved position', async () => {
    window.localStorage.setItem(`movie-downloader.playback.${HASH}`, '600');
    stubHls([{ phase: 'ready', progress: 1, error: null }]);
    renderWatch();

    expect(await screen.findByText(/resume from 10:00/i)).toBeInTheDocument();
    expect(shakaDouble.mounts).toBe(0);

    fireEvent.click(screen.getByRole('button', { name: /^resume$/i }));

    await waitFor(() => expect(shakaDouble.mounts).toBe(1));
    expect(shakaDouble.latest?.resumeAt).toBe(600);
  });

  it('mounts from the start when the user chooses Restart', async () => {
    window.localStorage.setItem(`movie-downloader.playback.${HASH}`, '600');
    stubHls([{ phase: 'ready', progress: 1, error: null }]);
    renderWatch();

    await screen.findByText(/resume from 10:00/i);
    fireEvent.click(screen.getByRole('button', { name: /restart/i }));

    await waitFor(() => expect(shakaDouble.mounts).toBe(1));
    expect(shakaDouble.latest?.resumeAt).toBe(0);
  });

  it('shows a failure overlay with fallbacks when packaging fails, and recovers on Retry', async () => {
    window.localStorage.setItem(SETUP_DONE_KEY, '1'); // Player links render once setup is confirmed
    const { calls } = stubHls([{ phase: 'failed', progress: 0, error: 'disk full' }]);
    renderWatch();

    expect(await screen.findByText(/couldn’t prepare a browser-playable copy/i)).toBeInTheDocument();
    expect(screen.getByText('disk full')).toBeInTheDocument();
    const playerHref = screen.getByRole('link', { name: /open in your player/i }).getAttribute('href') ?? '';
    expect(playerHref).toMatch(/^movie:http:\/\/localhost:3000\/api\/stream\//);
    // Regression guard (T-001): the hand-off URL must survive the browser's URI
    // parser — the old movie://<absolute-url> form was rewritten to movie://http//…
    expect(new URL(playerHref).href).toBe(playerHref);
    expect(screen.getByRole('link', { name: /download file/i })).toHaveAttribute(
      'href',
      `/api/downloads/${HASH}/file`,
    );

    fireEvent.click(screen.getByRole('button', { name: /retry/i }));

    // Retry clears the failed package (DELETE) and repolls → ready → player mounts
    await waitFor(() => expect(calls.deleted).toBe(1));
    await waitFor(() => expect(shakaDouble.mounts).toBe(1), { timeout: 6000 });
    expect(shakaDouble.latest?.manifestUrl).toBe(MANIFEST);
  });

  it('always hands the file to the OS handler — no routing to Settings, gentle hint when not connected', async () => {
    stubHls([{ phase: 'failed', progress: 0, error: 'disk full' }]);
    render(
      <MemoryRouter initialEntries={[`/watch/${HASH}`]}>
        <Routes>
          <Route path="/watch/:infoHash" element={<WatchPage />} />
          <Route path="/settings" element={<div>settings-page</div>} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText(/couldn’t prepare a browser-playable copy/i);

    // The action is a real movie: link whether or not setup is confirmed — it
    // never routes the user to Settings and never blocks the hand-off.
    const playerLink = screen.getByRole('link', { name: /open in your player/i });
    expect(playerLink.getAttribute('href')).toMatch(/^movie:http:\/\/localhost:3000\/api\/stream\//);

    fireEvent.click(playerLink);

    expect(screen.queryByText('settings-page')).not.toBeInTheDocument();
    useToastStore.setState({ toasts: [] });
    fireEvent.click(screen.getByRole('link', { name: /open in your player/i }));
    const hint = useToastStore.getState().toasts.find((t) => t.message.includes('Connect it once'));
    expect(hint).toBeTruthy();
  });

  it('shows no setup hint once the local player is connected', async () => {
    window.localStorage.setItem(SETUP_DONE_KEY, '1'); // Player links open silently once setup is confirmed
    stubHls([{ phase: 'failed', progress: 0, error: 'disk full' }]);
    renderWatch();

    await screen.findByText(/couldn’t prepare a browser-playable copy/i);
    fireEvent.click(screen.getByRole('link', { name: /open in your player/i }));

    expect(useToastStore.getState().toasts.some((t) => t.message.includes('Connect it once'))).toBe(false);
  });

  it('surfaces a Shaka startup failure into the failure overlay', async () => {
    stubHls([{ phase: 'ready', progress: 1, error: null }]);
    renderWatch();
    await waitFor(() => expect(shakaDouble.mounts).toBe(1));

    act(() => shakaDouble.latest?.onError?.('Shaka cannot play this manifest'));

    expect(screen.getByText(/couldn’t prepare a browser-playable copy/i)).toBeInTheDocument();
    expect(screen.getByText('Shaka cannot play this manifest')).toBeInTheDocument();
  });

  it('re-mounts the player when “Retry stream” is clicked after a stall', async () => {
    stubHls([{ phase: 'ready', progress: 1, error: null }]);
    renderWatch();
    await waitFor(() => expect(shakaDouble.mounts).toBe(1));

    // Arm the stall watchdog: onTick fires on every timeupdate and schedules a
    // 20s stall check. Fake only the timeout APIs so Date.now() stays real and
    // saveProgress' 5s throttle guard doesn't swallow the first tick. jsdom
    // media never plays, so report a "playing" video to satisfy the stall probe.
    const playingVideo = shakaVideo();
    Object.defineProperty(playingVideo, 'paused', { configurable: true, get: () => false });
    Object.defineProperty(playingVideo, 'readyState', { configurable: true, get: () => 3 });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    try {
      fireEvent.timeUpdate(playingVideo);
      act(() => {
        vi.advanceTimersByTime(20_000);
      });
    } finally {
      vi.useRealTimers();
    }

    expect(await screen.findByText(/stream stalled/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /retry stream/i }));

    // the reload nonce keys the player, so retry unmounts and re-mounts it fresh
    await waitFor(() => expect(shakaDouble.mounts).toBe(2));
    expect(shakaDouble.latest?.manifestUrl).toBe(MANIFEST);
  });

  it('skips packaging entirely when the browser cannot decode the hls video codec', async () => {
    window.localStorage.setItem(SETUP_DONE_KEY, '1'); // Player links render once setup is confirmed
    vi.stubGlobal('MediaSource', { isTypeSupported: vi.fn(() => false) });
    const { calls } = stubHls([], { mseProbe: ['video/mp4; codecs="hvc1.1.6.L120.B0,mp4a.40.2"'] });
    renderWatch();

    // The player-required screen appears instantly: no packaging status polling
    // ever starts and the Shaka player never mounts.
    expect(await screen.findByText(/can't decode in a web player/i)).toBeInTheDocument();
    const playerHref = screen.getByRole('link', { name: /open in your player/i }).getAttribute('href') ?? '';
    expect(playerHref).toMatch(/^movie:http:\/\/localhost:3000\/api\/stream\//);
    expect(new URL(playerHref).href).toBe(playerHref);
    expect(shakaDouble.mounts).toBe(0);
    expect(calls.status).toBe(0);
    expect(screen.queryByText(/building a web-compatible copy/i)).not.toBeInTheDocument();
  });

  it('proceeds to package when the browser supports the hls codec', async () => {
    vi.stubGlobal('MediaSource', { isTypeSupported: vi.fn(() => true) });
    stubHls([{ phase: 'ready', progress: 1, error: null }], {
      mseProbe: ['video/mp4; codecs="avc1.640028,mp4a.40.2"'],
    });
    renderWatch();

    await waitFor(() => expect(shakaDouble.mounts).toBe(1));
    expect(shakaDouble.latest?.manifestUrl).toBe(MANIFEST);
  });

  it('builds a cached compat copy when the browser cannot decode the hls codec (D26)', async () => {
    vi.stubGlobal('MediaSource', { isTypeSupported: vi.fn(() => false) });
    const { calls } = stubHls([{ phase: 'ready', progress: 1, error: null }], {
      mseProbe: ['video/mp4; codecs="hvc1.1.6.L120.B0,mp4a.40.2"'],
      compat: true,
    });
    renderWatch();

    await waitFor(() => expect(shakaDouble.mounts).toBe(1));
    expect(shakaDouble.latest?.manifestUrl).toBe(COMPAT_MANIFEST);
    expect(calls.statusUrls.some((u) => u.includes('variant=compat'))).toBe(true);
    expect(screen.queryByText(/can't decode in a web player/i)).not.toBeInTheDocument();
  });
});
