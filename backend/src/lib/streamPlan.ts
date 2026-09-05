import type { MediaInfo } from './mediaInfo.js';
import type { MediaProbe } from './probe.js';

export type StreamMode = 'direct' | 'remux-audio' | 'transcode' | 'player-required';
/** Playback mode reported by playinfo. 'hls' = Shaka plays an HLS web package. */
export type PlaybackMode = StreamMode | 'hls';

const SAFE_VIDEO_CODECS = new Set(['h264', 'vp9', 'av1']);
const SAFE_AUDIO_CODECS = new Set(['aac', 'mp3', 'opus', 'flac']);

const UHD_HEIGHT = 2160;

/** Video codecs ffmpeg can stream-copy into an fMP4 HLS package. */
export const HLS_COPYABLE_VIDEO = new Set(['h264', 'hevc', 'vp9', 'av1']);

/** Containers the browser <video> element can demux natively (direct playback). */
const NATIVE_CONTAINERS = new Set(['mp4', 'webm', 'mov']);

/** Legacy decision used by the /watch raw-remux path (kept for compatibility). */
export function decideStreamMode(probe: MediaProbe): StreamMode {
  const video = probe.videoCodec?.toLowerCase() ?? null;
  const audio = probe.audioCodec?.toLowerCase() ?? null;
  const height = probe.height ?? 0;

  const videoSafe = video === null || SAFE_VIDEO_CODECS.has(video);
  const audioSafe = audio === null || SAFE_AUDIO_CODECS.has(audio);

  if (videoSafe && audioSafe) return 'direct';
  if (videoSafe) return 'remux-audio';
  if (height >= UHD_HEIGHT) return 'player-required';
  return 'transcode';
}

/**
 * Modern decision over the full media probe. `direct` only when the container
 * plays natively AND video + all audio tracks are browser-safe with nothing the
 * player would need extra tracks/subs for. Everything with a copyable video
 * codec gets packaged to HLS (container change, AAC audio per language, WebVTT
 * subtitles). Video codecs that cannot be stream-copied keep the legacy
 * transcode/external behavior.
 */
export function decidePlaybackMode(media: MediaInfo | null, extra?: { sidecarSubtitles?: number }): PlaybackMode {
  if (!media) return 'direct';
  const videoCodec = media.videoCodec?.toLowerCase() ?? null;
  const container = media.container?.toLowerCase() ?? null;
  const audioAllSafe =
    media.audioTracks.length === 0 || media.audioTracks.every((a) => SAFE_AUDIO_CODECS.has(a.codec?.toLowerCase() ?? ''));
  const singleAudio = media.audioTracks.length <= 1;
  const wantsExtraTracks =
    media.subtitleTracks.length > 0 || media.audioTracks.length > 1 || (extra?.sidecarSubtitles ?? 0) > 0;

  if (container && NATIVE_CONTAINERS.has(container) && videoCodec && SAFE_VIDEO_CODECS.has(videoCodec)) {
    if (audioAllSafe && singleAudio && !wantsExtraTracks) return 'direct';
  }

  if (videoCodec && HLS_COPYABLE_VIDEO.has(videoCodec)) {
    // 4K/UHD HEVC is stream-copied into an HLS package most browsers still can't
    // decode — keep the bit-perfect external-player flow for that case.
    if (videoCodec === 'hevc' && (media.height ?? 0) >= UHD_HEIGHT) return 'player-required';
    return 'hls';
  }

  const height = media.height ?? 0;
  if (height >= UHD_HEIGHT) return 'player-required';
  return 'transcode';
}
