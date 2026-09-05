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
  type ImageProvider,
} from '../lib/enrich.js';

function toProvider(value: unknown): ImageProvider | null {
  return value === 'tmdb' || value === 'fanart' ? value : null;
}

export function createSettingsRouter(deps: AppDeps): Router {
  const router = Router();

  async function settingsBody() {
    const provider = await resolveImageProvider(deps);
    const audio = await loadAudioPreference(deps);
    return { artwork: { provider, fanartConfigured: deps.fanart != null }, language: { audio } };
  }

  router.get('/settings', async (_req, res) => {
    res.json(await settingsBody());
  });

  router.put('/settings', async (req, res) => {
    const body = (req.body ?? {}) as { artwork?: { provider?: unknown }; language?: { audio?: unknown } };

    const providerRaw = body?.artwork?.provider ?? null;
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
    if (audioRaw !== null) {
      if (!isAudioLang(audioRaw)) {
        res.status(400).json({ error: 'language.audio must be "en", "pt", "es", "fr", "de" or "it"' });
        return;
      }
      await saveAudioPreference(deps, audioRaw);
    }
    if (providerRaw === null && audioRaw === null) {
      res.status(400).json({ error: 'nothing to update (artwork.provider or language.audio expected)' });
      return;
    }
    res.json(await settingsBody());
  });

  return router;
}
