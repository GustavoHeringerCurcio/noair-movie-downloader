import path from 'node:path';
import type { AudioInfo, MediaInfo, SidecarSubtitle, SubtitleInfo } from './mediaInfo.js';

/**
 * Pure builders for the "web package" pipeline: converting a fully-downloaded
 * file into an HLS package (video stream-copied, audio re-encoded to AAC per
 * track, text subtitles to WebVTT) that a MSE player (Shaka) can play with
 * audio-language and subtitle switching. No ffmpeg is invoked here — these
 * functions only describe the file layout, ffmpeg arguments and playlists so
 * they can be unit-tested.
 *
 * Media playlists are emitted as growing EVENT playlists (never sealed with
 * #EXT-X-ENDLIST until the ffmpeg pass finishes) written through a temp file,
 * so a player can start streaming from the earliest segments while the rest of
 * the copy is still being built — the "watchable package" (W-001).
 */

/**
 * Deterministic directory key for one package (per torrent + file + variant).
 * The default (web) variant stream-copies the video; `compat` re-encodes it to
 * H.264 for files the browser's MSE can't decode, so the two never collide.
 */
export function packageKey(infoHash: string, relative: string, variant?: 'web' | 'compat'): string {
  const slug = relative.split('/').join('-').replace(/[^A-Za-z0-9._-]/g, '-');
  const suffix = variant === 'compat' ? '-compat' : '';
  return `${infoHash.toLowerCase()}-${slug}${suffix}`;
}

const LANGUAGE_LABELS: Record<string, string> = {
  en: 'English',
  es: 'Español',
  pt: 'Português',
  fr: 'Français',
  de: 'Deutsch',
  it: 'Italiano',
  ja: '日本語',
  ko: '한국어',
  zh: '中文',
  ru: 'Русский',
  ar: 'العربية',
  hi: 'हिन्दी',
  nl: 'Nederlands',
  sv: 'Svenska',
  pl: 'Polski',
  tr: 'Türkçe',
};

export function languageLabel(language: string | null): string {
  if (language && LANGUAGE_LABELS[language]) return LANGUAGE_LABELS[language]!;
  return language ? language.toUpperCase() : 'Unknown';
}

/** Valid EXT-X-MEDIA LANGUAGE value; falls back to "und". */
export function hlsLanguage(language: string | null): string {
  return language && /^[a-z]{2,3}(-[A-Za-z0-9]+)*$/.test(language) ? language : 'und';
}

export interface AudioRendition {
  streamIndex: number;
  language: string | null;
  title: string | null;
  label: string;
  default: boolean;
}

export interface SubtitleRendition {
  id: string;
  language: string | null;
  label: string;
}

export function pickAudioRenditions(media: MediaInfo): AudioRendition[] {
  const firstDefault = media.audioTracks.find((a) => a.default) ?? media.audioTracks[0];
  return media.audioTracks.map((a: AudioInfo) => ({
    streamIndex: a.index,
    language: a.language,
    title: a.title,
    label: a.title || languageLabel(a.language),
    default: a === firstDefault || media.audioTracks.length === 1,
  }));
}

export function pickSubtitleRenditions(
  tracks: SubtitleInfo[],
  sidecars: SidecarSubtitle[],
): SubtitleRendition[] {
  const textTracks = tracks
    .filter((s) => s.kind === 'text')
    .map((s, i) => ({
      id: `track-${i}`,
      language: s.language,
      label: s.title || languageLabel(s.language),
    }));
  const sidecar = sidecars.map((s, i) => ({
    id: `sidecar-${i}`,
    language: s.language,
    label: languageLabel(s.language) || s.name.replace(/\.(srt|ass|ssa|vtt)$/i, ''),
  }));
  return [...textTracks, ...sidecar];
}

/** fMP4 HLS segments, ~6s each, EVENT (growing, playable-early) playlist written to `<dir>/main.m3u8`. */
export function videoSegmentArgs(input: string, dir: string): string[] {
  return [
    '-hide_banner',
    '-loglevel', 'error',
    '-i', input,
    '-map', '0:v:0',
    '-c:v', 'copy',
    '-an', '-dn',
    '-f', 'hls',
    '-hls_time', '6',
    '-hls_playlist_type', 'event',
    '-hls_flags', 'temp_file',
    '-hls_segment_type', 'fmp4',
    '-hls_fmp4_init_filename', 'init.mp4',
    '-hls_segment_filename', path.join(dir, 'seg_%05d.m4s'),
    path.join(dir, 'main.m3u8'),
  ];
}

/**
 * The "compatibility" video rendition (D26/D27): same fMP4 HLS layout as
 * `videoSegmentArgs` but the video is re-encoded once to H.264 instead of
 * stream-copied, so files the browser's MSE can't decode (HEVC/x265 8- or
 * 10-bit, and — with the 4K opt-in — 2160p content) still play in-browser.
 * `targetHeight` scales the encode down (e.g. 1080) for 4K sources; leave it
 * null to keep the source resolution.
 */
export function videoCompatSegmentArgs(
  input: string,
  dir: string,
  opts: { targetHeight?: number | null } = {},
): string[] {
  const args = [
    '-hide_banner',
    '-loglevel', 'error',
    '-i', input,
    '-map', '0:v:0',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '21',
    '-pix_fmt', 'yuv420p',
  ];
  if (opts.targetHeight && opts.targetHeight > 0) {
    args.push('-vf', `scale=-2:${opts.targetHeight}`);
  }
  args.push(
    '-an', '-dn',
    '-f', 'hls',
    '-hls_time', '6',
    '-hls_playlist_type', 'event',
    '-hls_flags', 'temp_file',
    '-hls_segment_type', 'fmp4',
    '-hls_fmp4_init_filename', 'init.mp4',
    '-hls_segment_filename', path.join(dir, 'seg_%05d.m4s'),
    path.join(dir, 'main.m3u8'),
  );
  return args;
}

/**
 * A browser-safe AAC track can be stream-copied into the fMP4 rendition —
 * re-encoding it (AAC → AAC) wastes minutes of single-core CPU for no gain.
 * Only AAC-LC ≤ 48 kHz is copied; HE-AAC (SBR/PS) keeps its container codec
 * quirks that MSE players don't handle, so it is still re-encoded.
 */
export function canCopyAudioTrack(track: { codec?: string | null; profile?: string | null; sampleRate?: number | null }): boolean {
  if ((track.codec ?? '').toLowerCase() !== 'aac') return false;
  const profile = (track.profile ?? '').toLowerCase();
  if (profile && profile !== 'lc') return false;
  const rate = track.sampleRate;
  return rate == null || (rate > 0 && rate <= 48000);
}

/** One audio track → AAC, separate fMP4 HLS rendition in `<dir>/main.m3u8`. */
export function audioSegmentArgs(
  input: string,
  streamIndex: number,
  dir: string,
  opts: { copy?: boolean } = {},
): string[] {
  const encode = opts.copy
    ? ['-c:a', 'copy']
    : ['-c:a', 'aac', '-b:a', '192k', '-aac_coder', 'fast'];
  return [
    '-hide_banner',
    '-loglevel', 'error',
    '-i', input,
    '-map', `0:${streamIndex}`,
    ...encode,
    '-f', 'hls',
    '-hls_time', '6',
    '-hls_playlist_type', 'event',
    '-hls_flags', 'temp_file',
    '-hls_segment_type', 'fmp4',
    '-hls_fmp4_init_filename', 'init.mp4',
    '-hls_segment_filename', path.join(dir, 'seg_%05d.m4s'),
    path.join(dir, 'main.m3u8'),
  ];
}

/** Convert an embedded text subtitle stream to a single WebVTT file. */
export function embeddedSubtitleArgs(input: string, streamIndex: number, out: string): string[] {
  return [
    '-hide_banner',
    '-loglevel', 'error',
    '-y',
    '-i', input,
    '-map', `0:${streamIndex}`,
    '-c:s', 'webvtt',
    '-f', 'webvtt',
    out,
  ];
}

/** Convert a sidecar subtitle file (srt/ass/…) to a single WebVTT file. */
export function sidecarSubtitleArgs(sidecar: string, out: string): string[] {
  return [
    '-hide_banner',
    '-loglevel', 'error',
    '-y',
    '-i', sidecar,
    '-map', '0:0',
    '-c:s', 'webvtt',
    '-f', 'webvtt',
    out,
  ];
}

/**
 * HLS subtitle media playlist that references a single whole-file WebVTT
 * segment. Kept deliberately simple: one #EXTINF covering the media duration.
 */
export function subtitleMediaPlaylist(durationSeconds: number | null, fileName = 'subs.vtt'): string {
  const duration = durationSeconds && durationSeconds > 0 ? durationSeconds : 600;
  const target = Math.ceil(duration);
  const inf = duration.toFixed(3);
  return [
    '#EXTM3U',
    '#EXT-X-VERSION:6',
    '#EXT-X-PLAYLIST-TYPE:VOD',
    '#EXT-X-MEDIA-SEQUENCE:0',
    `#EXT-X-TARGETDURATION:${target}`,
    `#EXTINF:${inf},`,
    fileName,
    '#EXT-X-ENDLIST',
    '',
  ].join('\n');
}

export interface MasterOptions {
  durationSeconds: number | null;
  audio: AudioRendition[];
  subtitles: SubtitleRendition[];
  /** Estimated bandwidth of the video rendition (video-only), e.g. from bytes/duration. */
  bandwidth: number | null;
  /** video stream's codec name (h264/hevc/…) for the CODECS hint (optional). */
  videoCodec?: string | null;
  resolution?: { width: number | null; height: number | null } | null;
}

/**
 * Author the master playlist. The main rendition is VIDEO-ONLY (all audio lives
 * in the AUDIO group so Shaka can switch languages); subtitles come from a
 * SUBTITLES group pointing at per-track subtitle media playlists.
 */
export function buildMasterPlaylist(opts: MasterOptions): string {
  const lines: string[] = ['#EXTM3U', '#EXT-X-VERSION:6', '#EXT-X-INDEPENDENT-SEGMENTS'];
  const hasAudio = opts.audio.length > 0;
  const hasSubs = opts.subtitles.length > 0;

  if (hasAudio) {
    opts.audio.forEach((audio) => {
      const attrs = [
        `TYPE=AUDIO`,
        `GROUP-ID="aud"`,
        `NAME="${quoteAttr(audio.label)}"`,
        `LANGUAGE="${hlsLanguage(audio.language)}"`,
        audio.default ? 'DEFAULT=YES' : 'DEFAULT=NO',
        'AUTOSELECT=YES',
        `URI="audio/${audio.streamIndex}/main.m3u8"`,
      ];
      lines.push(`#EXT-X-MEDIA:${attrs.join(',')}`);
    });
  }

  if (hasSubs) {
    opts.subtitles.forEach((sub) => {
      const attrs = [
        `TYPE=SUBTITLES`,
        `GROUP-ID="subs"`,
        `NAME="${quoteAttr(sub.label)}"`,
        `LANGUAGE="${hlsLanguage(sub.language)}"`,
        'DEFAULT=NO',
        'AUTOSELECT=YES',
        `URI="subs/${sub.id}.m3u8"`,
      ];
      lines.push(`#EXT-X-MEDIA:${attrs.join(',')}`);
    });
  }

  const streamAttrs = ['BANDWIDTH=4000000'];
  if (opts.videoCodec) streamAttrs.push(`CODECS="${codecsHint(opts.videoCodec, hasAudio)}"`);
  if (opts.resolution?.width && opts.resolution.height) {
    streamAttrs.push(`RESOLUTION=${opts.resolution.width}x${opts.resolution.height}`);
  }
  if (hasAudio) streamAttrs.push('AUDIO="aud"');
  if (hasSubs) streamAttrs.push('SUBTITLES="subs"');
  lines.push(`#EXT-X-STREAM-INF:${streamAttrs.join(',')}`);
  lines.push('video/main.m3u8');
  lines.push('');
  return lines.join('\n');
}

function quoteAttr(value: string): string {
  return value.replace(/"/g, '');
}

/** Keep CODECS minimal: the AAC encoder emits mp4a.40.2; video codec is best-effort. */
function codecsHint(videoCodec: string, hasAudio: boolean): string {
  const video = videoCodecNameToCodecs(videoCodec);
  return hasAudio ? `${video},mp4a.40.2` : video;
}

function videoCodecNameToCodecs(codec: string): string {
  switch (codec.toLowerCase()) {
    case 'h264':
      return 'avc1.640028';
    case 'hevc':
      return 'hvc1.1.6.L93.B0';
    case 'vp9':
      return 'vp09.00.10.08';
    case 'av1':
      return 'av01.0.04M.08';
    default:
      return codec;
  }
}

/**
 * MediaSource type strings (one per codec-string spelling) that describe a
 * packaged HLS rendition's video track (+ its always-AAC audio). The browser
 * preflight probes these with `MediaSource.isTypeSupported` *before* any
 * packaging starts, so content the browser can never decode (e.g. HEVC
 * Main10 in Chrome/Firefox) is routed straight to the external-player flow
 * instead of paying for a doomed package build.
 *
 * Returns `[]` when the codec is definitely not browser-decodable, so callers
 * can short-circuit to the player screen.
 */
export interface MseVideoProbe {
  codec: string | null;
  profile?: string | null;
  level?: number | null;
  pixFmt?: string | null;
}

export function mseProbeTypes(video: MseVideoProbe | null): string[] {
  if (!video || !video.codec) return [];
  const codec = video.codec.toLowerCase();
  const audio = ',mp4a.40.2';
  switch (codec) {
    case 'h264':
    case 'avc1':
      return [`video/mp4; codecs="avc1.640028${audio}"`, `video/mp4; codecs="avc1.4d401f${audio}"`];
    case 'vp9':
      return [`video/mp4; codecs="vp09.00.10.08${audio}"`];
    case 'av1':
      return [`video/mp4; codecs="av01.0.04M.08${audio}"`];
    case 'hevc':
    case 'h265': {
      if (hevcBeyondBrowserSupport(video)) return [];
      const level = hevcLevelIdc(video.level);
      return [
        `video/mp4; codecs="hvc1.1.6.L${level}.B0${audio}"`,
        `video/mp4; codecs="hev1.1.6.L${level}.B0${audio}"`,
      ];
    }
    default:
      // Unknown/legacy codecs never reach hls packaging (they go to
      // transcode/player-required instead) — stay permissive.
      return [];
  }
}

/** Chrome/Firefox cannot decode HEVC beyond 8-bit Main; detect and gate out. */
function hevcBeyondBrowserSupport(video: MseVideoProbe): boolean {
  const pix = (video.pixFmt ?? '').toLowerCase();
  const profile = (video.profile ?? '').toLowerCase();
  if (/(p0?10|p0?12|10le|12le|yuv420p10|yuv444)/.test(pix)) return true;
  if (/main\s*10|main10|12|rext|422|444/.test(profile)) return true;
  return false;
}

/** ffprobe HEVC `level` is level * 30 (e.g. 120 = 4.0); default to a safe 3.1. */
function hevcLevelIdc(level: number | null | undefined): number {
  return typeof level === 'number' && level > 0 ? level : 93;
}

export interface PackageLayout {
  key: string;
  root: string;
  videoDir: string;
  audioDir: (streamIndex: number) => string;
  subsDir: string;
}

export function layoutFor(packageRoot: string, key: string): PackageLayout {
  const root = path.join(packageRoot, key);
  return {
    key,
    root,
    videoDir: path.join(root, 'video'),
    audioDir: (streamIndex: number) => path.join(root, 'audio', String(streamIndex)),
    subsDir: path.join(root, 'subs'),
  };
}
