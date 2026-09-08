import { Router } from 'express';
import type { AppDeps } from '../deps.js';
import { isAudioLang, loadAudioPreference, saveAudioPreference } from '../lib/language.js';
import {
  isMaxResolution,
  loadMaxResolutionPreference,
  saveMaxResolutionPreference,
} from '../lib/quality.js';
import {
  isReleaseCatalogMode,
  loadReleaseCatalogPreference,
  saveReleaseCatalogPreference,
} from '../lib/catalog.js';
import {
  loadAutoConvertPreference,
  saveAutoConvertPreference,
} from '../lib/autoConvert.js';
import { probeEngineProfile } from '../lib/engine.js';

export function createSettingsRouter(deps: AppDeps): Router {
  const router = Router();

  async function settingsBody() {
    const [audio, maxResolution, catalog, autoConvertMovies] = await Promise.all([
      loadAudioPreference(deps),
      loadMaxResolutionPreference(deps),
      loadReleaseCatalogPreference(deps),
      loadAutoConvertPreference(deps),
    ]);
    return {
      language: { audio },
      quality: { maxResolution },
      catalog: { mode: catalog },
      optimize: { autoConvertMovies },
    };
  }

  router.get('/settings', async (_req, res) => {
    res.json(await settingsBody());
  });

  // Conversion engine readout (Settings → advanced / diagnostics). Probed and
  // cached at boot, so this is cheap after startup.
  router.get('/settings/engine', (_req, res) => {
    try {
      const engine = probeEngineProfile();
      res.json({
        encoder: engine.encoder,
        hardware: engine.hardware,
        note: engine.note,
        speedX: engine.speedX,
        cores: engine.cores,
        threads: engine.threads,
        driDevice: engine.driDevice,
      });
    } catch {
      res.json({ encoder: 'libx264', hardware: false, speedX: null, cores: 0 });
    }
  });

  router.put('/settings', async (req, res) => {
    const body = (req.body ?? {}) as {
      language?: { audio?: unknown };
      quality?: { maxResolution?: unknown };
      catalog?: { mode?: unknown };
      optimize?: { autoConvertMovies?: unknown };
    };

    const audioRaw = body?.language?.audio ?? null;
    const maxResolutionRaw = body?.quality?.maxResolution ?? null;
    const catalogRaw = body?.catalog?.mode ?? null;
    const autoRaw = body?.optimize?.autoConvertMovies ?? null;
    if (audioRaw === null && maxResolutionRaw === null && catalogRaw === null && autoRaw === null) {
      res.status(400).json({
        error:
          'nothing to update (language.audio, quality.maxResolution, catalog.mode or optimize.autoConvertMovies expected)',
      });
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
    if (catalogRaw !== null && !isReleaseCatalogMode(catalogRaw)) {
      res.status(400).json({ error: 'catalog.mode must be "browser-friendly" or "all"' });
      return;
    }
    if (autoRaw !== null && typeof autoRaw !== 'boolean') {
      res.status(400).json({ error: 'optimize.autoConvertMovies must be a boolean' });
      return;
    }
    if (audioRaw !== null) await saveAudioPreference(deps, audioRaw);
    if (maxResolutionRaw !== null) await saveMaxResolutionPreference(deps, maxResolutionRaw);
    if (catalogRaw !== null) await saveReleaseCatalogPreference(deps, catalogRaw);
    if (autoRaw !== null) await saveAutoConvertPreference(deps, autoRaw);
    res.json(await settingsBody());
  });

  return router;
}
