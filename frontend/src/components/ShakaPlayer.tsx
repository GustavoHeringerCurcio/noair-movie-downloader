import { useEffect, useRef } from 'react';

interface ShakaPlayerProps {
  manifestUrl: string;
  resumeAt?: number | null;
  /** Called with the <video> element on every timeupdate (for resume storage). */
  onTick?: (video: HTMLVideoElement) => void;
  onPlayback?: () => void;
  /** Called once the stream failed to start; the caller can offer fallbacks. */
  onError?: (message: string) => void;
  /** Called after the requested resume position was applied. */
  onStarted?: () => void;
}

interface PlayerHandle {
  destroy(): Promise<void>;
}

interface OverlayHandle {
  destroy(): Promise<void>;
  configure(options: Record<string, unknown>): void;
}

type ShakaModule = {
  polyfill: { installAll(): void };
  Player: new () => { attach(el: HTMLVideoElement): Promise<void>; load(url: string): Promise<void>; configure(o: Record<string, unknown>): void; destroy(): Promise<void> };
  ui?: { Overlay: new (player: unknown, container: HTMLDivElement, video: HTMLVideoElement) => OverlayHandle };
  default?: ShakaModule;
};

function messageFromError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Shaka ships as a UMD/CJS bundle; under Vite's dev CJS→ESM interop the API can
 * sit behind the module's `default` export while the production build exposes it
 * directly — normalize both.
 */
async function loadShaka(): Promise<NonNullable<ShakaModule['default']>> {
  const loaded = (await import('shaka-player/dist/shaka-player.ui.js')) as unknown as ShakaModule;
  const shaka = (loaded.default ?? loaded) as NonNullable<ShakaModule['default']>;
  if (!shaka || typeof shaka.Player !== 'function') {
    throw new Error('Shaka Player failed to initialize (unexpected module shape)');
  }
  return shaka;
}

/**
 * HLS playback via Shaka Player. The player is loaded lazily (dynamic import)
 * so direct-play pages never pay for it. Shaka renders its own controls overlay
 * with audio-language and subtitle menus populated from the HLS master playlist.
 */
export function ShakaPlayer({ manifestUrl, resumeAt, onTick, onPlayback, onError, onStarted }: ShakaPlayerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const handleRef = useRef<{ player?: PlayerHandle; overlay?: OverlayHandle }>({});
  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    const video = videoRef.current;
    if (!container || !video) return undefined;

    const teardown = async (): Promise<void> => {
      const overlay = handleRef.current.overlay;
      const player = handleRef.current.player;
      handleRef.current = {};
      try {
        if (overlay) await overlay.destroy();
      } catch {
        /* ignore */
      }
      try {
        if (player) await player.destroy();
      } catch {
        /* ignore */
      }
    };

    void (async () => {
      try {
        await teardown();
        const module = await loadShaka();
        await import('shaka-player/dist/controls.css');
        if (cancelled) return;

        module.polyfill.installAll();
        const player = new module.Player();
        handleRef.current.player = player;
        await player.attach(video);
        player.configure({
          // startAtLiveEdge: a package that is still being converted is served as
          // a growing EVENT playlist (no #EXT-X-ENDLIST yet), which Shaka treats as
          // live — without this it would jump to the live edge (the conversion
          // frontier) and skip the start of the movie. Start from the beginning.
          streaming: { bufferingGoal: 60, startAtLiveEdge: false },
          abr: { enabled: false },
        });

        if (module.ui && module.ui.Overlay) {
          // Overlay(player, videoContainer, video) — the player must come first,
          // otherwise Controls casts around the container and dies on getAdManager.
          const overlay = new module.ui.Overlay(player, container, video);
          handleRef.current.overlay = overlay;
          overlay.configure({
            // Fullscreen, sound (mute + volume), subtitles and trick-play are all
            // stock Shaka UI elements; captions/PiP auto-hide when unsupported or
            // when the stream carries no text track.
            controlPanelElements: [
              'play_pause',
              'mute_volume',
              'time_and_duration',
              'spacer',
              'rewind',
              'fast_forward',
              'language',
              'captions',
              'playback_rate',
              'overflow_menu',
              'picture_in_picture',
              'fullscreen',
            ],
            overflowMenuButtons: [
              'captions',
              'captions-position',
              'captions-size',
              'quality',
              'language',
              'playback_rate',
              'picture_in_picture',
            ],
            enableTooltips: true,
          });
        }

        await player.load(manifestUrl);
        if (cancelled) return;

        const seekToResume = (): void => {
          if (resumeAt && resumeAt > 0 && Number.isFinite(video.duration) && resumeAt < video.duration) {
            video.currentTime = resumeAt;
            onStarted?.();
          } else {
            onStarted?.();
          }
        };
        if (Number.isFinite(video.duration) && video.duration > 0) {
          seekToResume();
        } else {
          video.addEventListener('durationchange', seekToResume, { once: true });
        }

        video.addEventListener('timeupdate', () => onTick?.(video), { passive: true });
        if (onPlayback) video.addEventListener('playing', () => onPlayback());
      } catch (error) {
        if (cancelled) return;
        onError?.(messageFromError(error));
      }
    })();

    return () => {
      cancelled = true;
      void teardown();
    };
  }, [manifestUrl]);

  return (
    <div ref={containerRef} className="shaka-player-host" style={{ width: '100%' }}>
      <video ref={videoRef} className="watch-video" playsInline autoPlay />
    </div>
  );
}
