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

  return { resolution, source, codec, hdr, isDolbyVision, group, cleanTitle };
}
