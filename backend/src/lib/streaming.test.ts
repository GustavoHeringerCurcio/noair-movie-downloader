import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  isInsideDirectory,
  mimeForFile,
  relativeToDownloadDir,
  resolveInside,
  resolveStreamFile,
  resolveStreamForServing,
} from './streaming.js';

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeFile(dir: string, name: string, sizeBytes: number): void {
  fs.writeFileSync(path.join(dir, name), Buffer.alloc(sizeBytes));
}

describe('mimeForFile', () => {
  it('maps known extensions and strips .!qb', () => {
    expect(mimeForFile('a.mkv')).toBe('video/x-matroska');
    expect(mimeForFile('a.mp4')).toBe('video/mp4');
    expect(mimeForFile('a.webm')).toBe('video/webm');
    expect(mimeForFile('a.ts')).toBe('video/mp2t');
    expect(mimeForFile('a.mkv.!qb')).toBe('video/x-matroska');
    expect(mimeForFile('a.txt')).toBe('application/octet-stream');
  });
});

describe('resolveStreamFile', () => {
  it('prefers .mkv over equal-size .mp4', () => {
    const downloadDir = makeTempDir('dl-');
    const contentPath = path.join(downloadDir, 'movie');
    fs.mkdirSync(contentPath);
    writeFile(contentPath, 'a.mp4', 1000);
    writeFile(contentPath, 'b.mkv', 1000);
    const result = resolveStreamFile(contentPath, downloadDir);
    expect(result).not.toBeNull();
    expect(path.basename(result!.absolutePath)).toBe('b.mkv');
    expect(result!.mime).toBe('video/x-matroska');
  });

  it('prefers the complete file over its .!qb twin', () => {
    const downloadDir = makeTempDir('dl-');
    const contentPath = path.join(downloadDir, 'movie');
    fs.mkdirSync(contentPath);
    writeFile(contentPath, 'a.mkv', 500);
    writeFile(contentPath, 'a.mkv.!qb', 800);
    const result = resolveStreamFile(contentPath, downloadDir);
    expect(path.basename(result!.absolutePath)).toBe('a.mkv');
  });

  it('falls back to the .!qb twin when incomplete only', () => {
    const downloadDir = makeTempDir('dl-');
    const contentPath = path.join(downloadDir, 'movie');
    fs.mkdirSync(contentPath);
    writeFile(contentPath, 'a.mkv.!qb', 800);
    const result = resolveStreamFile(contentPath, downloadDir);
    expect(path.basename(result!.absolutePath)).toBe('a.mkv.!qb');
    expect(result!.mime).toBe('video/x-matroska');
  });

  it('handles a single-file contentPath', () => {
    const downloadDir = makeTempDir('dl-');
    writeFile(downloadDir, 'movie.mkv', 1000);
    const result = resolveStreamFile(path.join(downloadDir, 'movie.mkv'), downloadDir);
    expect(path.basename(result!.absolutePath)).toBe('movie.mkv');
  });

  it('returns null for non-video content', () => {
    const downloadDir = makeTempDir('dl-');
    writeFile(downloadDir, 'readme.txt', 1000);
    expect(resolveStreamFile(path.join(downloadDir, 'readme.txt'), downloadDir)).toBeNull();
  });

  it('rejects a path escaping the download dir', () => {
    const downloadDir = makeTempDir('dl-');
    const outside = makeTempDir('outside-');
    writeFile(outside, 'evil.mkv', 1000);
    const result = resolveStreamFile(path.join(outside, 'evil.mkv'), downloadDir);
    expect(result).toBeNull();
  });
});

describe('resolveStreamForServing', () => {
  it('refreshes when the stored path is stale (renamed after completion)', () => {
    const downloadDir = makeTempDir('dl-');
    const contentPath = path.join(downloadDir, 'movie');
    fs.mkdirSync(contentPath);
    writeFile(contentPath, 'a.mkv', 1000);
    const result = resolveStreamForServing(downloadDir, contentPath, 'movie/a.mkv.!qb');
    expect(result).not.toBeNull();
    expect(result!.relative).toBe('movie/a.mkv');
    expect(result!.mime).toBe('video/x-matroska');
  });

  it('keeps the stored path when it still exists', () => {
    const downloadDir = makeTempDir('dl-');
    const contentPath = path.join(downloadDir, 'movie');
    fs.mkdirSync(contentPath);
    writeFile(contentPath, 'a.mkv.!qb', 1000);
    const result = resolveStreamForServing(downloadDir, contentPath, 'movie/a.mkv.!qb');
    expect(result!.relative).toBe('movie/a.mkv.!qb');
  });

  it('returns null when no content path is known', () => {
    expect(resolveStreamForServing('/downloads', null, null)).toBeNull();
  });
});

describe('path utilities', () => {
  it('resolves inside and rejects escapes', () => {
    const downloadDir = '/downloads';
    expect(isInsideDirectory(downloadDir, '/downloads/movie/a.mkv')).toBe(true);
    expect(isInsideDirectory(downloadDir, '/downloads/../etc/passwd')).toBe(false);
  });

  it('resolveInside normalizes', () => {
    expect(resolveInside('/downloads', 'movie/../x.mkv')).toBe(path.resolve('/downloads/x.mkv'));
  });

  it('relativeToDownloadDir produces forward-slash relative paths', () => {
    expect(relativeToDownloadDir('/downloads', '/downloads/movie/a.mkv')).toBe('movie/a.mkv');
  });
});
