import fs from 'node:fs';
import path from 'node:path';

export const VIDEO_EXTENSIONS = ['mkv', 'mp4', 'avi', 'webm', 'mov', 'm4v', 'ts'] as const;

export const EXTENSION_PRIORITY: Record<string, number> = {
  mkv: 0,
  webm: 1,
  ts: 2,
  mp4: 3,
  mov: 4,
  m4v: 5,
  avi: 6,
};

const MIME_BY_EXT: Record<string, string> = {
  mkv: 'video/x-matroska',
  mp4: 'video/mp4',
  webm: 'video/webm',
  ts: 'video/mp2t',
};

export interface ResolvedStreamFile {
  absolutePath: string;
  mime: string;
}

export interface StreamableFileInfo {
  relative: string;
  mime: string;
  size: number;
  complete: boolean;
}

function stripIncompleteSuffix(name: string): string {
  return name.endsWith('.!qb') ? name.slice(0, -4) : name;
}

export function extensionOf(filePath: string): string {
  return path.extname(stripIncompleteSuffix(filePath)).slice(1).toLowerCase();
}

export function isVideoFileName(name: string): boolean {
  const stripped = stripIncompleteSuffix(name);
  const ext = path.extname(stripped).slice(1).toLowerCase();
  return (VIDEO_EXTENSIONS as readonly string[]).includes(ext);
}

export function mimeForFile(filePath: string): string {
  return MIME_BY_EXT[extensionOf(filePath)] ?? 'application/octet-stream';
}

export function resolveInside(downloadDir: string, relativePath: string): string {
  return path.resolve(downloadDir, relativePath);
}

export function isInsideDirectory(downloadDir: string, absolutePath: string): boolean {
  const root = path.resolve(downloadDir) + path.sep;
  const resolved = path.resolve(absolutePath);
  return resolved.startsWith(root);
}

interface Candidate {
  absolutePath: string;
  size: number;
  baseName: string;
  complete: boolean;
}

function listCandidates(contentPath: string): Candidate[] {
  const stat = fs.statSync(contentPath);
  if (stat.isFile()) {
    if (isVideoFileName(contentPath)) {
      return [{ absolutePath: contentPath, size: stat.size, baseName: contentPath, complete: !contentPath.endsWith('.!qb') }];
    }
    return [];
  }

  const candidates: Candidate[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && isVideoFileName(entry.name)) {
        candidates.push({
          absolutePath: full,
          size: fs.statSync(full).size,
          baseName: stripIncompleteSuffix(entry.name),
          complete: !entry.name.endsWith('.!qb'),
        });
      }
    }
  };
  walk(contentPath);
  return candidates;
}

function preferCompleteOverIncomplete(candidates: Candidate[]): Candidate[] {
  const completeByBase = new Map<string, Candidate>();
  for (const c of candidates) {
    if (c.complete && c.size > 0) completeByBase.set(c.baseName, c);
  }
  return candidates.filter((c) => {
    const completeTwin = completeByBase.get(c.baseName);
    return !completeTwin || c.complete;
  });
}

function chooseBest(candidates: Candidate[]): Candidate | null {
  if (candidates.length === 0) return null;
  return candidates.reduce((best, current) => {
    const bestExt = extensionOf(best.absolutePath);
    const curExt = extensionOf(current.absolutePath);
    const bestPriority = EXTENSION_PRIORITY[bestExt] ?? 99;
    const curPriority = EXTENSION_PRIORITY[curExt] ?? 99;
    if (current.size !== best.size) return current.size > best.size ? current : best;
    return curPriority < bestPriority ? current : best;
  });
}

function resolveCandidates(contentPath: string): Candidate[] | null {
  if (!contentPath) return null;
  let candidates: Candidate[];
  try {
    candidates = listCandidates(contentPath);
  } catch {
    return null;
  }
  return preferCompleteOverIncomplete(candidates);
}

export function listStreamableFiles(downloadDir: string, contentPath: string): StreamableFileInfo[] {
  const candidates = resolveCandidates(contentPath) ?? [];
  const base = path.resolve(downloadDir);
  return candidates
    .filter((c) => isInsideDirectory(downloadDir, c.absolutePath))
    .map((c) => ({
      relative: path.relative(base, c.absolutePath).split(path.sep).join('/'),
      mime: mimeForFile(c.absolutePath),
      size: c.size,
      complete: c.complete,
    }))
    .sort((a, b) => a.relative.localeCompare(b.relative, undefined, { numeric: true }));
}

export function resolveStreamFile(contentPath: string, downloadDir: string): ResolvedStreamFile | null {
  const candidates = resolveCandidates(contentPath);
  if (!candidates) return null;
  const best = chooseBest(candidates);
  if (!best) return null;
  if (!isInsideDirectory(downloadDir, best.absolutePath)) return null;
  return { absolutePath: best.absolutePath, mime: mimeForFile(best.absolutePath) };
}

export function existsOnDisk(absolutePath: string): boolean {
  try {
    return fs.statSync(absolutePath).isFile();
  } catch {
    return false;
  }
}

export function relativeToDownloadDir(downloadDir: string, absolutePath: string): string {
  return path.relative(path.resolve(downloadDir), path.resolve(absolutePath)).split(path.sep).join('/');
}

export interface StreamServingResult {
  relative: string;
  mime: string;
}

export function resolveStreamForServing(
  downloadDir: string,
  contentPath: string | null,
  storedStreamFilePath: string | null,
): StreamServingResult | null {
  if (!contentPath) return null;
  if (storedStreamFilePath && existsOnDisk(resolveInside(downloadDir, storedStreamFilePath))) {
    return { relative: storedStreamFilePath, mime: mimeForFile(storedStreamFilePath) };
  }
  const resolved = resolveStreamFile(contentPath, downloadDir);
  if (!resolved) return null;
  return { relative: relativeToDownloadDir(downloadDir, resolved.absolutePath), mime: resolved.mime };
}

/**
 * Resolves a specific file (episode) inside a torrent, chosen by its relative
 * path. The path must belong to the torrent's own streamable file list so a
 * caller cannot serve arbitrary files from elsewhere under the download dir.
 */
/**
 * Resolves the file to serve for a torrent. An explicit episode choice (its
 * relative path) is honored only if it belongs to the torrent's own file list;
 * an invalid choice returns null (404) instead of silently falling back. When
 * no choice is given, the stored/largest stream file is used.
 */
export function resolvePlaybackFile(
  downloadDir: string,
  contentPath: string | null,
  storedStreamFilePath: string | null,
  chosenRelative: string | null,
): StreamServingResult | null {
  if (!contentPath) return null;
  if (chosenRelative) {
    return resolveChosenStreamFile(downloadDir, contentPath, chosenRelative);
  }
  return resolveStreamForServing(downloadDir, contentPath, storedStreamFilePath);
}

export function resolveChosenStreamFile(
  downloadDir: string,
  contentPath: string,
  chosenRelative: string,
): StreamServingResult | null {
  const normalized = chosenRelative.split(path.sep).join('/');
  if (!isInsideDirectory(downloadDir, resolveInside(downloadDir, normalized))) return null;
  const file = listStreamableFiles(downloadDir, contentPath).find((f) => f.relative === normalized);
  if (!file) return null;
  if (!existsOnDisk(resolveInside(downloadDir, file.relative))) return null;
  return { relative: file.relative, mime: file.mime };
}
