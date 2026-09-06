import { useEffect, useRef } from 'react';

/**
 * Test double for `ShakaPlayer` used by WatchPage integration tests. Renders a
 * plain <video> and forwards media events to the caller's callbacks so WatchPage
 * flows (progress saving, stall detection, resume) behave like they would with
 * the real player. Also counts real keyed mounts/unmounts so tests can assert
 * that the player is (re)created — e.g. after a stall "Retry stream".
 */

export interface FakeShakaPlayerProps {
  manifestUrl: string;
  resumeAt?: number | null;
  onTick?: (video: HTMLVideoElement) => void;
  onPlayback?: () => void;
  onError?: (message: string) => void;
  onStarted?: () => void;
}

export const shakaDouble = {
  mounts: 0,
  unmounts: 0,
  all: [] as FakeShakaPlayerProps[],
  latest: null as FakeShakaPlayerProps | null,
  reset() {
    this.mounts = 0;
    this.unmounts = 0;
    this.all = [];
    this.latest = null;
  },
};

export function ShakaPlayerDouble(props: FakeShakaPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    shakaDouble.mounts += 1;
    shakaDouble.all.push(props);
    return () => {
      shakaDouble.unmounts += 1;
    };
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;
    const onTimeUpdate = (): void => props.onTick?.(video);
    const onPlaying = (): void => props.onPlayback?.();
    const onLoadedMetadata = (): void => props.onStarted?.();
    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('playing', onPlaying);
    video.addEventListener('loadedmetadata', onLoadedMetadata);
    return () => {
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
    };
  }, [props.onTick, props.onPlayback, props.onStarted]);

  shakaDouble.latest = props;

  return <video ref={videoRef} data-testid="shaka" controls autoPlay playsInline />;
}
