import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';

const execFileAsync = promisify(execFile);

export interface VideoInfo {
  index: number;
  codec: string | null;
  width: number | null;
  height: number | null;
  hdr: boolean;
  /** Codec profile label (e.g. "High", "Main", "Main 10") — used for browser-decode support checks. */
  profile?: string | null;
  /** Pixel format (e.g. "yuv420p", "yuv420p10le") — bit depth gate for HEVC. */
  pixFmt?: string | null;
  /** ffprobe level value (e.g. 120 = HEVC level 4.0). */
  level?: number | null;
}

export interface AudioInfo {
  index: number;
  codec: string | null;
  language: string | null;
  title: string | null;
  channels: number | null;
  default: boolean;
  /** Codec profile label (e.g. "LC") — aac-lc can be stream-copied, HE-AAC cannot. */
  profile?: string | null;
  /** Sample rate in Hz. */
  sampleRate?: number | null;
}

export interface SubtitleInfo {
  index: number;
  codec: string | null;
  /** 'text' when the stream can be converted to WebVTT (srt/ass/webvtt/mov_text); 'bitmap' otherwise (PGS/VobSub). */
  kind: 'text' | 'bitmap';
  language: string | null;
  title: string | null;
  default: boolean;
}

export interface MediaInfo {
  /** Detected container: mkv, mp4, webm, mov, ts, avi, ... (from the file extension). */
  container: string | null;
  durationSeconds: number | null;
  video: VideoInfo | null;
  audioTracks: AudioInfo[];
  subtitleTracks: SubtitleInfo[];
  /** First-audio-track conveniences kept for the legacy direct/remux/transcode decision. */
  videoCodec: string | null;
  audioCodec: string | null;
  height: number | null;
}

const cache = new Map<string, MediaInfo | null>();

function cacheKey(filePath: string): string {
  try {
    const stat = fs.statSync(filePath);
    return `${filePath}|${stat.size}|${stat.mtimeMs}`;
  } catch {
    return `${filePath}|?`;
  }
}

interface FfprobeStream {
  index?: number;
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  channels?: number;
  color_transfer?: string;
  /** Codec profile label, e.g. video "High"/"Main 10", audio "LC". */
  profile?: string;
  pix_fmt?: string;
  /** Codec level idc, e.g. HEVC 120 = level 4.0. */
  level?: number;
  sample_rate?: string;
  disposition?: { default?: number; forced?: number };
  tags?: {
    language?: string;
    title?: string;
    DURATION?: string;
    [key: string]: string | undefined;
  };
  /** For subtitle streams: 'subrip'|'ass'|'webvtt'|'mov_text' are text; 'hdmv_pgs_subtitle'|'dvd_subtitle' are bitmap. */
}

interface FfprobeFormat {
  duration?: string;
}

interface FfprobeOutput {
  streams?: FfprobeStream[];
  format?: FfprobeFormat;
}

/** Common ISO-639-2 (3-letter) tag values seen in MKV containers → 2-letter codes. */
const LANGUAGE_ALPHA3: Record<string, string> = {
  eng: 'en',
  spa: 'es',
  por: 'pt',
  fre: 'fr',
  fra: 'fr',
  ger: 'de',
  deu: 'de',
  ita: 'it',
  jpn: 'ja',
  kor: 'ko',
  chi: 'zh',
  zho: 'zh',
  rus: 'ru',
  ara: 'ar',
  hin: 'hi',
  nld: 'nl',
  swe: 'sv',
  pol: 'pl',
  tur: 'tr',
};

export function normalizeLanguage(tag: string | null | undefined): string | null {
  if (!tag) return null;
  const value = tag.trim().toLowerCase();
  if (value === 'und' || value === 'unk' || value === 'xx') return null;
  if (/^[a-z]{2}$/.test(value)) return value;
  return LANGUAGE_ALPHA3[value] ?? null;
}

const TEXT_SUBTITLE_CODECS = new Set(['subrip', 'ass', 'ssa', 'webvtt', 'mov_text']);

export function subtitleKind(codec: string | null): SubtitleInfo['kind'] {
  return codec && TEXT_SUBTITLE_CODECS.has(codec) ? 'text' : 'bitmap';
}

function videoHdr(stream: FfprobeStream): boolean {
  const color = stream.color_transfer ?? '';
  return /smpte2084|arib-std-b67/i.test(color);
}

/**
 * Introspects every media stream in a file: the primary video, each audio track
 * and each subtitle track with language/title/codec metadata. Playback is
 * gated to complete files, so results are stable and safe to cache.
 */
export async function probeMediaInfo(filePath: string): Promise<MediaInfo | null> {
  const key = cacheKey(filePath);
  if (cache.has(key)) return cache.get(key) ?? null;

  let info: MediaInfo | null = null;
  try {
    const { stdout } = await execFileAsync(
      'ffprobe',
      [
        '-v', 'error',
        '-show_streams',
        '-show_format',
        '-of', 'json',
        filePath,
      ],
      { timeout: 30000, maxBuffer: 8 * 1024 * 1024 },
    );
    const data = JSON.parse(stdout) as FfprobeOutput;
    const streams = data.streams ?? [];

    const videoStreams = streams.filter((s) => s.codec_type === 'video');
    const primaryVideo = videoStreams[0];

    const audioTracks: AudioInfo[] = streams
      .filter((s) => s.codec_type === 'audio')
      .map((s) => ({
        index: s.index ?? 0,
        codec: s.codec_name ?? null,
        language: normalizeLanguage(s.tags?.language),
        title: s.tags?.title ?? null,
        channels: s.channels ?? null,
        default: (s.disposition?.default ?? 0) === 1,
        profile: s.profile ?? null,
        sampleRate: s.sample_rate ? Number(s.sample_rate) || null : null,
      }));

    const subtitleTracks: SubtitleInfo[] = streams
      .filter((s) => s.codec_type === 'subtitle')
      .map((s) => ({
        index: s.index ?? 0,
        codec: s.codec_name ?? null,
        kind: subtitleKind(s.codec_name ?? null),
        language: normalizeLanguage(s.tags?.language),
        title: s.tags?.title ?? null,
        default: (s.disposition?.default ?? 0) === 1,
      }));

    const firstAudio = audioTracks[0] ?? null;
    info = {
      container: containerFromPath(filePath),
      durationSeconds: Number(data.format?.duration) || null,
      video: primaryVideo
        ? {
            index: primaryVideo.index ?? 0,
            codec: primaryVideo.codec_name ?? null,
            width: primaryVideo.width ?? null,
            height: primaryVideo.height ?? null,
            hdr: videoHdr(primaryVideo),
            profile: primaryVideo.profile ?? null,
            pixFmt: primaryVideo.pix_fmt ?? null,
            level: primaryVideo.level ?? null,
          }
        : null,
      audioTracks,
      subtitleTracks,
      videoCodec: primaryVideo?.codec_name ?? null,
      audioCodec: firstAudio?.codec ?? null,
      height: primaryVideo?.height ?? null,
    };
  } catch (error) {
    console.error(`ffprobe (full) failed for ${filePath}`, error);
    info = null;
  }
  cache.set(key, info);
  return info;
}

export function containerFromPath(filePath: string): string | null {
  const ext = filePath.split('.').pop()?.toLowerCase();
  return ext && ext.length <= 5 ? ext : null;
}

/** Exposed for tests so memoized results never leak between cases. */
export function clearMediaInfoCache(): void {
  cache.clear();
}

const SIDECAR_SUBTITLE_EXTENSIONS = new Set(['srt', 'ass', 'ssa', 'vtt', 'sub', 'idx']);

export interface SidecarSubtitle {
  name: string;
  language: string | null;
}

/**
 * Lists external subtitle files sitting next to a video file (same folder),
 * e.g. `Movie.srt`, `Movie.eng.srt` or `Movie.spa.ass`. The language is guessed
 * from the common `basename.xx.ext` pattern; otherwise it stays null and the UI
 * falls back to showing the file name.
 */
export function listSidecarSubtitles(videoAbsolutePath: string): SidecarSubtitle[] {
  const dir = videoAbsolutePath.slice(0, Math.max(videoAbsolutePath.lastIndexOf('/'), videoAbsolutePath.lastIndexOf('\\')) + 1) || '.';
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const videoStem = videoAbsolutePath.split(/[\\/]/).pop() ?? '';
  const base = videoStem.replace(/\.[^.]+$/, '').toLowerCase();

  const subs: SidecarSubtitle[] = [];
  for (const name of entries) {
    const lower = name.toLowerCase();
    const ext = lower.split('.').pop() ?? '';
    if (!SIDECAR_SUBTITLE_EXTENSIONS.has(ext)) continue;
    const stemLower = name.replace(/\.[^.]+$/, '').toLowerCase();
    if (stemLower !== base && !stemLower.startsWith(`${base}.`)) continue;
    const token = stemLower.slice(base.length).replace(/^\./, '');
    const language = token && token.length <= 3 ? normalizeLanguage(token) : null;
    subs.push({ name, language });
  }
  return subs.sort((a, b) => a.name.localeCompare(b.name));
}
