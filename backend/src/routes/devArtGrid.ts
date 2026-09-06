import { Router } from 'express';
import type { AppDeps } from '../deps.js';
import type { MediaItem, MediaType } from '../types.js';

/**
 * DEV-ONLY visual comparison spike (ART_GRID=1). Do not ship.
 *
 * `/api/dev/artgrid` renders one self-contained HTML page. For a sample of real
 * titles it shows every "horizontal poster" candidate we can source side by
 * side in uniform 16:9 tiles, labeled REAL vs DERIVED, so a human can pick the
 * winning artwork treatment. A coverage table shows how often each source
 * returns art at all. Deleted once the decision is made.
 */

interface Sample {
  id: number;
  mediaType: MediaType;
  title: string;
  year: number | null;
  posterPath: string | null;
  backdropPath: string | null;
  origin: string;
}

interface Candidate {
  caption: string;
  derived: boolean;
  render: 'fill' | 'coverTop' | 'coverCenter' | 'frame';
  url: string | null;
}

function esc(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function proxy(path: string | null, size: 'w780' | 'w1280'): string | null {
  return path ? `/api/images/tmdb/${size}${path}` : null;
}

function yearOf(date: string | null | undefined): number | null {
  if (!date) return null;
  const year = parseInt(date.slice(0, 4), 10);
  return Number.isFinite(year) ? year : null;
}

export function createDevArtGridRouter(deps: AppDeps): Router {
  const router = Router();
  const { config } = deps;

  async function discoverObscureMovies(): Promise<Sample[]> {
    const url = `${config.tmdbBaseUrl}/discover/movie?language=en-US&sort_by=popularity.asc&vote_count.gte=40&page=1&api_key=${encodeURIComponent(config.tmdbApiKey)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return [];
    const data = (await res.json()) as { results?: Array<Record<string, unknown>> };
    return (data.results ?? []).map((r) => ({
      id: r.id as number,
      mediaType: 'movie' as const,
      title: String(r.title ?? ''),
      year: yearOf(r.release_date as string | null),
      posterPath: (r.poster_path as string | null) ?? null,
      backdropPath: (r.backdrop_path as string | null) ?? null,
      origin: 'obscure',
    }));
  }

  async function collect(): Promise<Sample[]> {
    const out = new Map<string, Sample>();
    const addSample = (sample: Sample): void => {
      const key = `${sample.mediaType}:${sample.id}`;
      if (!out.has(key)) out.set(key, sample);
    };
    const addMediaItems = (items: MediaItem[], origin: string): void => {
      for (const item of items) {
        addSample({
          id: item.tmdbId,
          mediaType: item.mediaType,
          title: item.title,
          year: item.year,
          posterPath: item.posterPath,
          backdropPath: item.backdropPath,
          origin,
        });
      }
    };
    try {
      addMediaItems((await deps.tmdb.browse('trending-week')).slice(0, 8), 'trending');
    } catch (error) {
      console.warn('[art-grid] trending failed', error);
    }
    try {
      addMediaItems((await deps.tmdb.browse('best-movies')).slice(0, 6), 'best-movies');
    } catch (error) {
      console.warn('[art-grid] best failed', error);
    }
    for (const sample of await discoverObscureMovies().catch(() => [])) addSample(sample);
    return Array.from(out.values());
  }

  async function rankedBackdrops(sample: Sample, limit: number): Promise<Array<{ caption: string; path: string | null }>> {
    const url = `${config.tmdbBaseUrl}/${sample.mediaType}/${sample.id}/images?language=en-US&include_image_language=en,null&api_key=${encodeURIComponent(config.tmdbApiKey)}`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) return [];
      const data = (await res.json()) as {
        backdrops?: Array<{ file_path?: string; aspect_ratio?: number; iso_639_1?: string | null; vote_average?: number }>;
      };
      const picks = (data.backdrops ?? [])
        .filter((b) => {
          const ratio = b.aspect_ratio ?? 0;
          return ratio >= 1.5 && ratio <= 2.6 && b.file_path;
        })
        .sort((a, b) => {
          const aLang = a.iso_639_1 ? 1 : 0;
          const bLang = b.iso_639_1 ? 1 : 0;
          if (aLang !== bLang) return aLang - bLang;
          return (b.vote_average ?? 0) - (a.vote_average ?? 0);
        })
        .slice(0, limit)
        .map((b) => ({ path: (b.file_path as string) ?? null }));
      return picks.map((p, i) => ({ caption: `TMDB ranked backdrop #${i + 1} (real)`, path: p.path }));
    } catch {
      return [];
    }
  }

  function tileHtml(title: string, candidate: Candidate): string {
    const badge = candidate.derived ? 'derived' : 'real';
    let inner: string;
    if (!candidate.url) {
      inner = '<div class="none">no image</div>';
    } else if (candidate.render === 'fill') {
      inner = `<img loading="lazy" src="${esc(candidate.url)}" alt="" class="fill" data-title="${esc(title)}">`;
    } else if (candidate.render === 'coverTop' || candidate.render === 'coverCenter') {
      const pos = candidate.render === 'coverTop' ? 'top center' : 'center';
      inner = `<img loading="lazy" src="${esc(candidate.url)}" alt="" class="fill" style="object-position:${pos}" data-title="${esc(title)}">`;
    } else {
      inner = `<img loading="lazy" src="${esc(candidate.url)}" alt="" class="fill blur" data-title="${esc(title)}"><img loading="lazy" src="${esc(candidate.url)}" alt="" class="poster" data-title="${esc(title)}">`;
    }
    return `<figure class="tile ${badge}" data-title="${esc(title)}">
      <div class="stage">${inner}</div>
      <figcaption>${esc(candidate.caption)}</figcaption>
    </figure>`;
  }

  async function candidatesFor(sample: Sample): Promise<Candidate[]> {
    const out: Candidate[] = [];
    const defaultBd = proxy(sample.backdropPath, 'w1280');
    if (defaultBd) {
      out.push({ caption: 'TMDB default backdrop (real)', derived: false, render: 'fill', url: defaultBd });
    } else {
      out.push({ caption: 'TMDB default backdrop (real)', derived: false, render: 'fill', url: null });
    }
    for (const ranked of await rankedBackdrops(sample, 2)) {
      out.push({ caption: ranked.caption, derived: false, render: 'fill', url: proxy(ranked.path, 'w1280') });
    }

    const fanart =
      deps.fanart != null
        ? await deps.art.resolveOne({ tmdbId: sample.id, mediaType: sample.mediaType }, 15_000).catch(() => null)
        : null;
    if (deps.fanart == null) {
      out.push({ caption: 'Fanart key art (real) — no FANART_API_KEY', derived: false, render: 'fill', url: null });
    } else {
      out.push({ caption: 'Fanart 16:9 thumb (real)', derived: false, render: 'fill', url: fanart?.thumbUrl ?? null });
      out.push({ caption: 'Fanart HD background (real)', derived: false, render: 'fill', url: fanart?.backgroundUrl ?? null });
    }

    const poster = proxy(sample.posterPath, 'w780');
    out.push({ caption: 'Poster fills tile — crop top (derived)', derived: true, render: 'coverTop', url: poster });
    out.push({ caption: 'Poster fills tile — crop center (derived)', derived: true, render: 'coverCenter', url: poster });
    out.push({ caption: 'Poster in frame on blurred ground (derived)', derived: true, render: 'frame', url: poster });
    return out;
  }

  router.get('/dev/artgrid', async (_req, res) => {
    const samples = await collect();
    let rowsHtml = '';
    let coverageTotal = 0;
    const coverageByCaption = new Map<string, number>();
    for (const sample of samples) {
      const candidates = await candidatesFor(sample);
      const header = `<h2>${esc(sample.title)}${sample.year ? ` (${sample.year})` : ''} <span class="origin">${esc(sample.origin)} · ${sample.mediaType}</span></h2>`;
      rowsHtml += `<section>${header}<div class="row">${candidates
        .map((c) => tileHtml(sample.title, c))
        .join('')}</div></section>`;
      coverageTotal += 1;
      for (const candidate of candidates) {
        if (candidate.derived || !candidate.url) continue;
        coverageByCaption.set(candidate.caption, (coverageByCaption.get(candidate.caption) ?? 0) + 1);
      }
    }
    const coverageLine = Array.from(coverageByCaption.entries())
      .map(([caption, count]) => `${esc(caption)}: ${count}/${coverageTotal}`)
      .join(' · ');

    const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Artwork comparison grid (DEV spike)</title>
<style>
  body { background:#0b0b0f; color:#e8e8ee; font:14px/1.5 system-ui, sans-serif; margin:0; padding:24px; }
  h1 { font-size:20px; } h2 { font-size:16px; margin:26px 0 10px; }
  h2 .origin { color:#8b8b98; font-weight:400; font-size:13px; margin-left:8px; }
  .stats { background:#14141b; border:1px solid #2a2a34; border-radius:10px; padding:12px 16px; margin-bottom:8px; color:#c9c9d4; }
  .row { display:flex; flex-wrap:wrap; gap:12px; }
  .tile { margin:0; width:300px; }
  .stage { position:relative; width:300px; aspect-ratio:16/9; border-radius:10px; overflow:hidden; background:#1b1b24; }
  .stage .none { display:flex; align-items:center; justify-content:center; height:100%; color:#70707e; font-size:13px; }
  .fill { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; }
  .blur { filter: blur(20px) brightness(.5); transform: scale(1.1); }
  .poster { position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); height:92%; aspect-ratio:2/3; object-fit:contain; }
  figcaption { margin-top:6px; color:#a9a9b6; font-size:12px; }
  .tile.real figcaption::before { content:"● "; color:#57d38c; }
  .tile.derived figcaption::before { content:"▲ "; color:#e2b04a; }
</style>
</head>
<body>
<h1>Horizontal "poster" candidates — pick the winner</h1>
<p class="stats">Sample: ${coverageTotal} titles (trending · best movies · obscure). Sources marked <b>● real</b> are untouched artwork from TMDB/Fanart; <b>▲ derived</b> are built from the poster. Obscure rows have little/no Fanart art, so they show the real coverage gap. This page can take ~30s (Fanart is rate-limited).</p>
<p class="stats">Real-art coverage: ${coverageLine}</p>
${rowsHtml}
<script>
  addEventListener('error', (e) => {
    const img = e.target;
    if (img && img.tagName === 'IMG') {
      const stage = img.parentElement;
      if (stage) stage.innerHTML = '<div class="none">no image</div>';
    }
  }, true);
</script>
</body>
</html>`;
    res.type('html').send(html);
  });

  return router;
}
