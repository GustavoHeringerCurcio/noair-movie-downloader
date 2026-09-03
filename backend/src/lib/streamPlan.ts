import type { MediaProbe } from './probe.js';

export type StreamMode = 'direct' | 'remux-audio' | 'transcode' | 'player-required';

const SAFE_VIDEO_CODECS = new Set(['h264', 'vp9', 'av1']);
const SAFE_AUDIO_CODECS = new Set(['aac', 'mp3', 'opus', 'flac']);

const UHD_HEIGHT = 2160;

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
