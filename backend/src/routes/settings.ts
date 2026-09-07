import { Router } from 'express';
import type { AppDeps } from '../deps.js';
import { isAudioLang, loadAudioPreference, saveAudioPreference } from '../lib/language.js';
import {
  isMaxResolution,
  loadMaxResolutionPreference,
  saveMaxResolutionPreference,
} from '../lib/quality.js';

export function createSettingsRouter(deps: AppDeps): Router {
  const router = Router();

  async function settingsBody() {
    const [audio, maxResolution] = await Promise.all([
      loadAudioPreference(deps),
      loadMaxResolutionPreference(deps),
    ]);
    return {
      language: { audio },
      quality: { maxResolution },
    };
  }

  router.get('/settings', async (_req, res) => {
    res.json(await settingsBody());
  });

  router.put('/settings', async (req, res) => {
    const body = (req.body ?? {}) as {
      language?: { audio?: unknown };
      quality?: { maxResolution?: unknown };
    };

    const audioRaw = body?.language?.audio ?? null;
    const maxResolutionRaw = body?.quality?.maxResolution ?? null;
    if (audioRaw === null && maxResolutionRaw === null) {
      res.status(400).json({ error: 'nothing to update (language.audio or quality.maxResolution expected)' });
      return;
    }
    if (audioRaw !== null && !isAudioLang(audioRaw)) {
      res.status(400).json({ error: 'language.audio must be "en", "pt", "es", "fr", "de" or "it"' });
      return;
    }
    if (maxResolutionRaw !== null && !isMaxResolution(maxResolutionRaw)) {
      res.status(400).json({ error: 'quality.maxResolution must be "720p", "1080p" or "2160p"' });
      return;
    }
    if (audioRaw !== null) await saveAudioPreference(deps, audioRaw);
    if (maxResolutionRaw !== null) await saveMaxResolutionPreference(deps, maxResolutionRaw);
    res.json(await settingsBody());
  });

  return router;
}
