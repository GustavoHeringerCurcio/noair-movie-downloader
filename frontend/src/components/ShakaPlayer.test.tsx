import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { ShakaPlayer } from './ShakaPlayer';

/**
 * Shaka ships a real UMD bundle that needs MSE + DOM APIs jsdom can't provide,
 * so the module is replaced with a controllable fake. Because shaka-player is
 * CJS, vitest inlines it and reads the mock through the interop `default`
 * export (named exports kept too) — the component's `loaded.default ?? loaded`
 * normalization is the exercised path.
 */
const shakaState = vi.hoisted(() => {
  const box = {
    fakeDuration: NaN,
    loadError: null as string | null,
    deferNextLoad: false,
    pendingResolve: null as (() => void) | null,
    pendingReject: null as ((reason: unknown) => void) | null,
  };
  const players: Array<{
    attach: ReturnType<typeof vi.fn>;
    configure: ReturnType<typeof vi.fn>;
    load: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
  }> = [];
  const overlays: Array<{
    configure: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
    args: unknown[];
  }> = [];
  return {
    installAll: vi.fn(),
    players,
    overlays,
    box,
    setDuration(value: number) {
      box.fakeDuration = value;
    },
    setLoadError(message: string | null) {
      box.loadError = message;
    },
    deferNext() {
      box.deferNextLoad = true;
    },
    resolveLoad() {
      box.pendingResolve?.();
      box.pendingResolve = null;
    },
    rejectLoad(reason: unknown) {
      box.pendingReject?.(reason);
      box.pendingReject = null;
    },
    reset() {
      box.fakeDuration = NaN;
      box.loadError = null;
      box.deferNextLoad = false;
      box.pendingResolve = null;
      box.pendingReject = null;
      players.length = 0;
      overlays.length = 0;
    },
  };
});

vi.mock('shaka-player/dist/shaka-player.ui.js', () => {
  class Player {
    attach = vi.fn().mockResolvedValue(undefined);
    configure = vi.fn();
    load = vi.fn().mockImplementation(() => {
      const box = shakaState.box;
      if (box.deferNextLoad) {
        box.deferNextLoad = false;
        return new Promise<void>((resolve, reject) => {
          box.pendingResolve = resolve;
          box.pendingReject = reject;
        });
      }
      if (box.loadError) return Promise.reject(new Error(box.loadError));
      return Promise.resolve();
    });
    destroy = vi.fn().mockResolvedValue(undefined);
    constructor() {
      shakaState.players.push(this);
    }
  }
  class Overlay {
    configure = vi.fn();
    destroy = vi.fn().mockResolvedValue(undefined);
    args: unknown[];
    constructor(player: unknown, container: unknown, video: unknown) {
      this.args = [player, container, video];
      shakaState.overlays.push(this);
    }
  }
  // shaka-player is a CJS/UMD bundle, so vitest's CJS interop reads the mock's
  // `default` export; named exports are also provided for ESM-namespace importers.
  const fake = {
    polyfill: { installAll: shakaState.installAll },
    Player,
    ui: { Overlay },
  };
  return { ...fake, default: fake };
});

type Props = ComponentProps<typeof ShakaPlayer>;

const MANIFEST = '/api/playback/abc/hls/master.m3u8';

/**
 * The shaka UMD module is loaded with a dynamic import, which under a
 * fully-parallel vitest run can take longer than @testing-library's 1s default
 * waitFor budget. Give module-boot assertions a generous explicit timeout so the
 * suite is deterministic regardless of machine load.
 */
const BOOT_TIMEOUT = 5000;

function renderPlayer(props: Partial<Props> = {}) {
  const callbacks = {
    onTick: vi.fn(),
    onPlayback: vi.fn(),
    onError: vi.fn(),
    onStarted: vi.fn(),
  };
  render(
    <ShakaPlayer manifestUrl={MANIFEST} resumeAt={0} {...callbacks} {...props} />,
  );
  return callbacks;
}

function video(): HTMLVideoElement {
  return document.querySelector('video') as HTMLVideoElement;
}

beforeEach(() => {
  shakaState.reset();
  Object.defineProperty(HTMLMediaElement.prototype, 'duration', {
    configurable: true,
    get: () => shakaState.box.fakeDuration,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ShakaPlayer', () => {
  it('lazy-loads shaka, installs polyfills and boots a configured player', async () => {
    renderPlayer();

    await waitFor(() => expect(shakaState.players).toHaveLength(1), { timeout: BOOT_TIMEOUT });
    const player = shakaState.players[0]!;

    expect(shakaState.installAll).toHaveBeenCalled();
    expect(player.attach).toHaveBeenCalledWith(video());
    expect(player.configure).toHaveBeenCalledWith({
      streaming: { bufferingGoal: 60, startAtLiveEdge: false },
      abr: { enabled: false },
    });
    expect(player.load).toHaveBeenCalledWith(MANIFEST);
  });

  it('renders Shaka’s own UI overlay with the audio/subtitle control elements', async () => {
    renderPlayer();
    await waitFor(() => expect(shakaState.overlays).toHaveLength(1), { timeout: BOOT_TIMEOUT });

    const overlay = shakaState.overlays[0]!;
    // Overlay(player, videoContainer, video): the player instance must be first —
    // swapping these breaks Controls (it cast-wraps the "player" and dies).
    expect(overlay.args[0]).toBe(shakaState.players[0]);
    expect(overlay.args[1]).toBeInstanceOf(HTMLDivElement);
    expect(overlay.args[2]).toBe(video());
    expect(overlay.configure).toHaveBeenCalledWith(
      expect.objectContaining({
        controlPanelElements: expect.arrayContaining(['language', 'overflow_menu', 'play_pause']),
        overflowMenuButtons: expect.arrayContaining(['captions', 'quality', 'language']),
      }),
    );
  });

  it('seeks to the resume position once the duration is known and reports started', async () => {
    shakaState.setDuration(120);
    const callbacks = renderPlayer({ resumeAt: 45 });

    await waitFor(() => expect(callbacks.onStarted).toHaveBeenCalledTimes(1));
    expect(video().currentTime).toBe(45);
    expect(callbacks.onError).not.toHaveBeenCalled();
  });

  it('applies the resume position via the durationchange listener when duration arrives late', async () => {
    // duration is NaN when load resolves → listener registered, resume applied on durationchange
    const callbacks = renderPlayer({ resumeAt: 30 });

    await waitFor(() => expect(shakaState.players[0]!.load).toHaveBeenCalled());
    expect(callbacks.onStarted).not.toHaveBeenCalled();

    shakaState.setDuration(90);
    fireEvent.durationChange(video());

    expect(callbacks.onStarted).toHaveBeenCalledTimes(1);
    expect(video().currentTime).toBe(30);
  });

  it('reports playback events to the caller', async () => {
    shakaState.setDuration(120);
    const callbacks = renderPlayer();

    await waitFor(() => expect(callbacks.onStarted).toHaveBeenCalled());

    fireEvent.timeUpdate(video());
    expect(callbacks.onTick).toHaveBeenCalledWith(video());

    fireEvent.playing(video());
    expect(callbacks.onPlayback).toHaveBeenCalledTimes(1);
  });

  it('surfaces a load failure through onError instead of throwing', async () => {
    shakaState.setLoadError('The video could not be loaded');
    const callbacks = renderPlayer();

    await waitFor(() => expect(callbacks.onError).toHaveBeenCalledTimes(1));
    expect(callbacks.onError).toHaveBeenCalledWith('The video could not be loaded');
    expect(callbacks.onStarted).not.toHaveBeenCalled();
  });

  it('destroys the player and overlay on unmount', async () => {
    renderPlayer();
    await waitFor(() => expect(shakaState.players).toHaveLength(1), { timeout: BOOT_TIMEOUT });

    cleanup();

    await waitFor(() => expect(shakaState.players[0]!.destroy).toHaveBeenCalled());
    expect(shakaState.overlays[0]!.destroy).toHaveBeenCalled();
  });

  it('ignores a late load rejection after unmount', async () => {
    shakaState.deferNext();
    const callbacks = renderPlayer();

    await waitFor(() => expect(shakaState.players[0]!.load).toHaveBeenCalled());
    cleanup();
    shakaState.rejectLoad(new Error('too late'));
    await waitFor(() => expect(shakaState.players[0]!.destroy).toHaveBeenCalled());

    expect(callbacks.onError).not.toHaveBeenCalled();
    expect(callbacks.onStarted).not.toHaveBeenCalled();
  });
});
