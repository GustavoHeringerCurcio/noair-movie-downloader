import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';

const execFileAsync = promisify(execFile);

export interface MediaProbe {
  videoCodec: string | null;
  audioCodec: string | null;
  height: number | null;
}

const cache = new Map<string, MediaProbe | null>();

function cacheKey(filePath: string): string {
  try {
    const stat = fs.statSync(filePath);
    return `${filePath}|${stat.size}|${stat.mtimeMs}`;
  } catch {
    return `${filePath}|?`;
  }
}

interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  height?: number;
}

export async function probeMedia(filePath: string): Promise<MediaProbe | null> {
  const key = cacheKey(filePath);
  if (cache.has(key)) return cache.get(key) ?? null;

  let probe: MediaProbe | null = null;
  try {
    const { stdout } = await execFileAsync(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,height', '-of', 'json', filePath],
      { timeout: 20000, maxBuffer: 2 * 1024 * 1024 },
    );
    const data = JSON.parse(stdout) as { streams?: FfprobeStream[] };
    const streams = data.streams ?? [];
    const video = streams.find((s) => s.codec_type === 'video');
    const audio = streams.find((s) => s.codec_type === 'audio');
    probe = {
      videoCodec: video?.codec_name ?? null,
      audioCodec: audio?.codec_name ?? null,
      height: video?.height ?? null,
    };
  } catch (error) {
    console.error(`ffprobe failed for ${filePath}`, error);
    probe = null;
  }
  cache.set(key, probe);
  return probe;
}
