import { Router } from 'express';
import type { AppDeps } from '../deps.js';
import { isAudioLang, loadAudioPreference, saveAudioPreference } from '../lib/language.js';

export function createSettingsRouter(deps: AppDeps): Router {
  const router = Router();

  async function settingsBody() {
    const audio = await loadAudioPreference(deps);
    return {
      language: { audio },
    };
  }

  router.get('/settings', async (_req, res) => {
    res.json(await settingsBody());
  });

  router.put('/settings', async (req, res) => {
    const body = (req.body ?? {}) as {
      language?: { audio?: unknown };
    };

    const audioRaw = body?.language?.audio ?? null;
    if (audioRaw === null) {
      res.status(400).json({ error: 'nothing to update (language.audio expected)' });
      return;
    }
    if (!isAudioLang(audioRaw)) {
      res.status(400).json({ error: 'language.audio must be "en", "pt", "es", "fr", "de" or "it"' });
      return;
    }
    await saveAudioPreference(deps, audioRaw);
    res.json(await settingsBody());
  });

  return router;
}
