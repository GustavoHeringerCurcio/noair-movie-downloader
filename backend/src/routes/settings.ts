import { Router } from 'express';
import type { AppDeps } from '../deps.js';
import { isAudioLang } from '../lib/language.js';
import {
  loadAudioPreference,
  saveAudioPreference,
} from '../lib/language.js';
import {
  resolveImageProvider,
  setImageProvider,
  resolveArtPreference,
  saveArtPreference,
  type ImageProvider,
} from '../lib/enrich.js';

function toProvider(value: unknown): ImageProvider | null {
  return value === 'tmdb' || value === 'fanart' ? value : null;
}

export function createSettingsRouter(deps: AppDeps): Router {
  const router = Router();

  async function settingsBody() {
    const provider = await resolveImageProvider(deps);
    const preference = await resolveArtPreference(deps);
    const audio = await loadAudioPreference(deps);
    return {
      artwork: { provider, fanartConfigured: deps.fanart != null, preference },
      language: { audio },
    };
  }

  router.get('/settings', async (_req, res) => {
    res.json(await settingsBody());
  });

  router.get('/settings/artwork-preview', async (req, res) => {
    const mediaTypeRaw = req.query.type;
    const tmdbIdRaw = req.query.tmdbId;
    const mediaType = mediaTypeRaw === 'tv' ? 'tv' : mediaTypeRaw === 'movie' ? 'movie' : null;
    const tmdbId = Number(tmdbIdRaw);
    if (!mediaType || !Number.isInteger(tmdbId) || tmdbId <= 0) {
      res.status(400).json({ error: 'type (movie|tv) and tmdbId required' });
      return;
    }
    try {
      const detail = await deps.tmdb.details(tmdbId, mediaType);
      const fanart =
        deps.fanart != null
          ? await deps.art.resolveOne({ tmdbId, mediaType })
          : null;
      res.json({
        title: detail.title,
        year: detail.year,
        mediaType,
        tmdbId,
        tmdb: { posterPath: detail.posterPath, backdropPath: detail.backdropPath },
        fanart: fanart
          ? {
              thumbUrl: fanart.thumbUrl,
              backgroundUrl: fanart.backgroundUrl ?? null,
              posterUrl: fanart.posterUrl ?? null,
              logoUrl: fanart.logoUrl,
            }
          : null,
      });
    } catch (error) {
      console.error('artwork preview failed', error);
      res.status(502).json({ error: 'artwork preview unavailable' });
    }
  });

  router.put('/settings', async (req, res) => {
    const body = (req.body ?? {}) as {
      artwork?: { provider?: unknown; preference?: { tmdb?: unknown; fanart?: unknown } };
      language?: { audio?: unknown };
    };

    const providerRaw = body?.artwork?.provider ?? null;
    const preferenceRaw = body?.artwork?.preference ?? null;
    const audioRaw = body?.language?.audio ?? null;
    if (providerRaw !== null) {
      const provider = toProvider(providerRaw);
      if (!provider) {
        res.status(400).json({ error: 'artwork.provider must be "tmdb" or "fanart"' });
        return;
      }
      if (provider === 'fanart' && deps.fanart == null) {
        res.status(400).json({ error: 'FanArt.tv is not configured — set FANART_API_KEY in .env' });
        return;
      }
      await setImageProvider(deps, provider);
    }
    if (preferenceRaw !== null) {
      try {
        await saveArtPreference(deps, preferenceRaw);
      } catch (error) {
        res.status(400).json({ error: error instanceof Error ? error.message : 'invalid artwork.preference' });
        return;
      }
    }
    if (audioRaw !== null) {
      if (!isAudioLang(audioRaw)) {
        res.status(400).json({ error: 'language.audio must be "en", "pt", "es", "fr", "de" or "it"' });
        return;
      }
      await saveAudioPreference(deps, audioRaw);
    }
    if (providerRaw === null && preferenceRaw === null && audioRaw === null) {
      res.status(400).json({ error: 'nothing to update (artwork.provider, artwork.preference or language.audio expected)' });
      return;
    }
    res.json(await settingsBody());
  });

  return router;
}
