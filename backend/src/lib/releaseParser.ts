import type { AudioLang, AudioMode, Coverage } from '../types.js';
import { detectAudioFlags } from './language.js';

export type ReleaseResolution = '2160p' | '1080p' | '720p' | '480p';
export type ReleaseSource = 'REMUX' | 'BluRay' | 'WEB-DL' | 'WEBRip' | 'BDRip' | 'BRRip' | 'HDTV' | 'DVDRip';
export type ReleaseCodec = 'x264' | 'x265' | 'AV1' | 'XviD' | 'DivX';

export interface ParsedRelease {
  resolution: ReleaseResolution | null;
  source: ReleaseSource | null;
  codec: ReleaseCodec | null;
  hdr: boolean;
  isDolbyVision: boolean;
  group: string | null;
  cleanTitle: string;
  audioCodec: ReleaseAudioCodec | null;
  audioLang: AudioLang | null;
  audioMode: AudioMode | null;
  coverage: Coverage[] | null;
}

export type ReleaseAudioCodec =
  | 'AAC'
  | 'AC3'
  | 'E-AC3'
  | 'DTS'
  | 'TrueHD'
  | 'FLAC'
  | 'Opus'
  | 'MP3'
  | 'Atmos';

export function isAudioCodecBrowserSafe(codec: ReleaseAudioCodec | null): boolean {
  return codec === 'AAC' || codec === 'MP3' || codec === 'FLAC' || codec === 'Opus';
}

const AUDIO_MATCHERS: Array<[ReleaseAudioCodec, RegExp]> = [
  ['E-AC3', /\b(eac3|ddp5|ddp2|ddp|dd ?plus)\b/],
  ['TrueHD', /\btruehd\b/],
  ['DTS', /\b(dts-hd|dtshd|dts)\b/],
  ['AC3', /\b(ac3|dd5|dd 5 1|dolby digital)\b/],
  ['Atmos', /\batmos\b/],
  ['AAC', /\baac\b/],
  ['FLAC', /\bflac\b/],
  ['Opus', /\bopus\b/],
  ['MP3', /\bmp3\b/],
];

function detectAudioCodec(norm: string): ReleaseAudioCodec | null {
  for (const [codec, re] of AUDIO_MATCHERS) {
    if (re.test(norm)) return codec;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Season / episode coverage
// ---------------------------------------------------------------------------

export interface FilenameEpisodeKey {
  season: number;
  episode: number;
}

const SEASON_EP_RE = /\bs(\d{1,2})e(\d{1,3})(?:\s*[-–]\s*e?(\d{1,3}))?\b/gi;
const X_EP_RE = /\b(\d{1,2})x(\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?\b/gi;
const SX_EP_RE = /\bs(\d{1,2})x(\d{1,3})\b/gi;
const SEASON_RANGE_RE = /\bs(\d{1,2})\s*[-–]\s*s(\d{1,2})\b/gi;
const SEASON_RE = /\bs(\d{1,2})\b/gi;
const WORD_SEASON_EP_RE = /\bseason\s+(\d{1,2})\s+episode\s+(\d{1,3})\b/gi;
const WORD_SEASON_RE = /\bseason\s+(\d{1,2})\b/gi;

const WHOLE_SERIES_RE =
  /\b(complete|full|whole)\s+series\b|\bseries\s+complete\b|complete\s+collection|all\s+seasons|the\s+complete\s+series\b/i;

interface RawSpan {
  season: number;
  from: number | null;
  to: number | null;
}

function mergeCoverage(spans: RawSpan[]): Coverage[] {
  const bySeason = new Map<number, RawSpan[]>();
  for (const span of spans) {
    const list = bySeason.get(span.season);
    if (list) list.push(span);
    else bySeason.set(span.season, [span]);
  }
  const merged: Coverage[] = [];
  for (const [season, seasonSpans] of bySeason) {
    const anyWholeSeason = seasonSpans.some((s) => s.from === null || s.to === null);
    if (anyWholeSeason) {
      merged.push({ season, episodes: null });
      continue;
    }
    const from = Math.min(...seasonSpans.map((s) => s.from as number));
    const to = Math.max(...seasonSpans.map((s) => s.to as number));
    merged.push({ season, episodes: [from, to] });
  }
  merged.sort(
    (a, b) =>
      a.season - b.season ||
      ((a.episodes ? a.episodes[0] : 0) - (b.episodes ? b.episodes[0] : 0)),
  );
  return merged;
}

/**
 * Extracts which seasons/episodes a release covers from a normalized title.
 * Returns null when no season/episode marker is present (coverage unknown —
 * the UI treats such results as Advanced-picker only).
 */
export function parseCoverage(norm: string): Coverage[] | null {
  let work = norm;
  const spans: RawSpan[] = [];

  const take = (re: RegExp, fn: (m: RegExpExecArray) => RawSpan | RawSpan[] | null): void => {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(work)) !== null) {
      const result = fn(m);
      if (result) {
        for (const span of Array.isArray(result) ? result : [result]) {
          if (span && span.season > 0) spans.push(span);
        }
      }
      work = work.slice(0, m.index) + ' '.repeat(m[0].length) + work.slice(m.index + m[0].length);
    }
  };

  take(WORD_SEASON_EP_RE, (m) => ({ season: Number(m[1]), from: Number(m[2]), to: Number(m[2]) }));
  take(SEASON_EP_RE, (m) => ({
    season: Number(m[1]),
    from: Number(m[2]),
    to: m[3] != null ? Number(m[3]) : Number(m[2]),
  }));
  take(X_EP_RE, (m) => ({
    season: Number(m[1]),
    from: Number(m[2]),
    to: m[3] != null ? Number(m[3]) : Number(m[2]),
  }));
  take(SX_EP_RE, (m) => ({ season: Number(m[1]), from: Number(m[2]), to: Number(m[2]) }));
  take(SEASON_RANGE_RE, (m) => {
    const from = Number(m[1]);
    const to = Number(m[2]);
    if (from > to) return null;
    const out: RawSpan[] = [];
    for (let season = from; season <= to; season += 1) out.push({ season, from: null, to: null });
    return out;
  });
  take(SEASON_RE, (m) => ({ season: Number(m[1]), from: null, to: null }));
  take(WORD_SEASON_RE, (m) => ({ season: Number(m[1]), from: null, to: null }));

  if (spans.length === 0) return null;
  return mergeCoverage(spans);
}

/** True when the title claims to cover every season (e.g. "Complete Series"). */
export function isWholeSeriesTitle(title: string): boolean {
  return WHOLE_SERIES_RE.test(normalizeTitle(title));
}

/** `coverageCovers(s, N)` → whole season N; `coverageCovers(s, N, M)` → episode M of season N. */
export function coverageCovers(coverage: Coverage[] | null, season: number, episode?: number): boolean {
  if (!coverage || coverage.length === 0) return false;
  const sameSeason = coverage.filter((c) => c.season === season);
  if (sameSeason.length === 0) return false;
  if (episode == null) return sameSeason.some((c) => c.episodes === null);
  return sameSeason.some(
    (c) => c.episodes === null || (episode >= c.episodes[0] && episode <= c.episodes[1]),
  );
}

/** Whether a coverage includes a full (unbroken) season pack. */
export function isFullSeason(coverage: Coverage[] | null, season: number): boolean {
  return coverage != null && coverage.some((c) => c.season === season && c.episodes === null);
}

/** Parses a file/name basename into a season/episode key (used by S13 tagging). */
export function episodeKeyFromFilename(name: string): FilenameEpisodeKey | null {
  const base = name.replace(/\.!qb$/i, '');
  const m = /\bs(\d{1,2})e(\d{1,3})\b/i.exec(base);
  if (!m) return null;
  const season = Number(m[1]);
  const episode = Number(m[2]);
  if (season <= 0 || episode <= 0) return null;
  return { season, episode };
}

/** Pads a season number to the canonical `S01` query token. */
export function seasonQueryToken(season: number): string {
  return `S${String(season).padStart(2, '0')}`;
}

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[._]+/g, ' ')
    .replace(/\bweb ?dl\b/g, 'web-dl')
    .replace(/\bweb ?rip\b/g, 'webrip')
    .replace(/\bblu ?ray\b/g, 'bluray')
    .replace(/\bx ?26 ?5\b/g, ' x265 ')
    .replace(/\bx ?26 ?4\b/g, ' x264 ')
    .replace(/\bh ?\.?265\b/g, ' h265 ')
    .replace(/\bh ?\.?264\b/g, ' h264 ')
    .replace(/\buhd\b/g, ' 2160p ');
}

const STRIP_TOKENS = [
  '2160p', '4k', 'uhd', '1080p', '720p', '480p', '2160', '1080', '720', '480',
  '10bit', '12bit', '8bit', 'hdr10+', 'hdr10', 'hdrplus', 'hdr', 'dolby vision', 'dolby', 'dv', 'hlg',
  'remux', 'bdremux', 'bd remux', 'bluray', 'bdrip', 'brrip', 'web-dl', 'webrip', 'web', 'hdtv', 'dvdrip',
  'amzn', 'max', 'netflix', 'hulu', 'disney', 'atvp', 'appletv', 'itunes', 'disney+',
  'x264', 'x265', 'h264', 'h265', 'hevc', 'av1', 'xvid', 'divx',
  'ddp5', 'ddp2', 'ddp', 'dd5', 'dd2', 'dd', 'dts-hd', 'dtshd', 'dts', 'truehd', 'atmos',
  'ac3', 'eac3', 'aac', 'flac', 'mp3', 'opus', 'pcm', 'ma5', 'ma',
  'dts hd ma', 'dts hd', 'hd ma', 'ma 5 1', 'ma 7 1', 'ddp5 1', 'ddp2 0', 'dd 5 1', 'dd 2 0',
  '5.1', '7.1', '2.0', '6.1', '5 1', '7 1', '2 0', '6 1', '51', '71', '61', '20', 'hd',
  '448kbps', '224kbps', '640kbps', '768kbps', '1500kbps', '1536kbps', '192kbps', '320kbps', 'kbps',
  'proper', 'repack', 'repackage', 'internal', 'uncut', 'unrated', 'extended', 'remastered',
  'directors cut', 'director s cut', 'theatrical', 'open matte', 'hybrid', 'upscale', 'multi',
  'dual audio', 'dual', 'esub', 'subtitle', 'subs', 'q22', 'joy', 'fps', '60fps', 'hq', 'uh',
  'english', 'hindi', 'spanish', 'french', 'german', 'italian', 'portuguese', 'dutch',
  'latin', 'latino', 'castellano', 'eng', 'esp', 'fre', 'ger', 'ita', 'dut', 'por', 'spa', 'lat',
  'rus', 'rum', 'cze', 'hun', 'pol', 'swe', 'nor', 'dan', 'fin', 'tur', 'ara', 'chi', 'kor', 'jpn',
  'hin', 'mal', 'tam', 'tel', 'vostfr', 'vff', 'vfq', 'sub', '999mb', '8gb', '10gb',
  'en', 'fr', 'es', 'de', 'it', 'pt', 'nl', 'pl', 'sv', 'no', 'da', 'fi', 'tr', 'ru', 'ar',
  'zh', 'ja', 'ko', 'hi', 'cs', 'hu', 'ro', 'hr', 'sk', 'sl', 'bg', 'uk', 'et', 'lt', 'lv',
  'vi', 'id', 'el', 'he', 'th',
  '3d', 'sbs', '2d',
  'max', 'amzn', 'hulu', 'atv',
].filter((t) => t.length > 0);

const STRIP_RE = new RegExp(`\\b(?:${STRIP_TOKENS.join('|')})\\b`, 'gi');

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractGroup(title: string): string | null {
  const bracket = /\[([^\]]+)\]\s*$/.exec(title);
  if (bracket) return bracket[1]!.trim();
  const dash = /[-_]([A-Za-z0-9]{2,}(?:\.[A-Za-z0-9]{2,})*)\s*$/.exec(title.trim());
  if (dash) return dash[1]!;
  const words = title.trim().split(/\s+/);
  const last = words[words.length - 1];
  if (
    last &&
    /^[A-Za-z0-9]{2,}$/.test(last) &&
    !/^\d{4}$/.test(last) &&
    !KNOWN_TAIL_TOKENS.has(last.toLowerCase())
  ) {
    return last;
  }
  return null;
}

const KNOWN_TAIL_TOKENS: ReadonlySet<string> = new Set(
  STRIP_TOKENS.map((t) => t.toLowerCase()),
);

function buildCleanTitle(title: string, group: string | null): string {
  let t = normalizeTitle(title);
  if (group) {
    t = t.replace(new RegExp(`[\\[\\]()]?${escapeRegExp(group.toLowerCase())}[\\[\\]()]?`, 'g'), ' ');
  }
  t = t
    .replace(STRIP_RE, ' ')
    .replace(/[()[\]]/g, ' ')
    .replace(/-/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\b\d{4}\b/g, ' ')
    .replace(/\b\d\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return t;
}

export function parseReleaseTitle(title: string): ParsedRelease {
  const norm = normalizeTitle(title);

  let resolution: ReleaseResolution | null = null;
  if (/\b2160p\b/.test(norm) || /\b4k\b/.test(norm)) resolution = '2160p';
  else if (/\b1080p\b/.test(norm)) resolution = '1080p';
  else if (/\b720p\b/.test(norm)) resolution = '720p';
  else if (/\b480p\b/.test(norm)) resolution = '480p';

  let source: ReleaseSource | null = null;
  if (/\b(remux|bdremux)\b/.test(norm)) source = 'REMUX';
  else if (/\bbluray\b/.test(norm)) source = 'BluRay';
  else if (
    /\bweb-dl\b/.test(norm) ||
    /\b(amzn|max|netflix|hulu|disney|atvp|appletv|itunes)\b/.test(norm)
  ) {
    source = 'WEB-DL';
  } else if (/\bwebrip\b/.test(norm)) source = 'WEBRip';
  else if (/\bbdrip\b/.test(norm)) source = 'BDRip';
  else if (/\bbrrip\b/.test(norm)) source = 'BRRip';
  else if (/\bhdtv\b/.test(norm)) source = 'HDTV';
  else if (/\bdvdrip\b/.test(norm)) source = 'DVDRip';

  let codec: ReleaseCodec | null = null;
  if (/\bav1\b/.test(norm)) codec = 'AV1';
  else if (/\b(x264|h264)\b/.test(norm)) codec = 'x264';
  else if (/\b(x265|h265|hevc)\b/.test(norm)) codec = 'x265';
  else if (/\bxvid\b/.test(norm)) codec = 'XviD';
  else if (/\bdivx\b/.test(norm)) codec = 'DivX';

  const isDolbyVision = /\bdolby ?vision\b/.test(norm) || /\bdv\b/.test(norm);
  const hdr =
    isDolbyVision ||
    /\bhdr\b/.test(norm) ||
    /\bhdr10(?:\+)?\b/.test(norm) ||
    /\bhdrplus\b/.test(norm) ||
    /\bhlg\b/.test(norm);

  const group = extractGroup(title);
  const cleanTitle = buildCleanTitle(title, group);
  const audioCodec = detectAudioCodec(norm);
  const { lang: audioLang, mode: audioMode } = detectAudioFlags(norm);

  return { resolution, source, codec, hdr, isDolbyVision, group, cleanTitle, audioCodec, audioLang, audioMode, coverage: parseCoverage(norm) };
}
