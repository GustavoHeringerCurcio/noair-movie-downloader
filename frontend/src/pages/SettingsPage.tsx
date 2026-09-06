import { useEffect, useState, type ReactNode } from 'react';
import { useDownloadsStore } from '@/store/downloadsStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useToastStore } from '@/store/toastStore';
import type {
  AudioLang,
  CardStyle,
  FanartArtKind,
  ImageProvider,
  MediaType,
  TmdbArtKind,
} from '@/types';
import {
  artworkPreview,
  backdropUrl,
  fanartArtKindLabel,
  posterUrl,
  tmdbArtKindLabel,
  type ArtworkPreview,
} from '@/api';
import {
  buildLinuxInstallerSh,
  buildLinuxUninstallerSh,
  buildOpenerCmd,
  buildUninstallerCmd,
  detectOs,
  playerChoicesFor,
  readPlayerPreference,
  savePlayerPreference,
} from '@/lib/openerInstaller';
import { AUDIO_LANGUAGE_OPTIONS, audioLanguageLabel } from '@/lib/audio';

const CONFIG_KEYS: Array<{ key: string; description: string }> = [
  { key: 'TMDB_API_KEY', description: 'Metadata & images provider' },
  { key: 'PROWLARR_URL', description: 'Torrent indexer aggregator base URL' },
  { key: 'PROWLARR_API_KEY', description: 'Prowlarr API key' },
  { key: 'QBITTORRENT_URL', description: 'qBittorrent Web UI URL' },
  { key: 'QBITTORRENT_USER / QBITTORRENT_PASS', description: 'qBittorrent credentials' },
  { key: 'DOWNLOAD_DIR', description: 'Shared download/stream volume' },
];

function diagnostics(): string {
  const connected = useDownloadsStore.getState().connected;
  return `Movie Downloader · backend ${connected ? 'connected' : 'offline'} · browser ${typeof navigator !== 'undefined' ? navigator.userAgent : '?'}`;
}

export function SettingsPage() {
  const connected = useDownloadsStore((s) => s.connected);
  const provider = useSettingsStore((s) => s.provider);
  const preference = useSettingsStore((s) => s.preference);
  const style = useSettingsStore((s) => s.style);
  const fanartConfigured = useSettingsStore((s) => s.fanartConfigured);
  const audio = useSettingsStore((s) => s.audio);
  const ready = useSettingsStore((s) => s.ready);
  const saving = useSettingsStore((s) => s.saving);
  const loadSettings = useSettingsStore((s) => s.load);
  const saveProvider = useSettingsStore((s) => s.saveProvider);
  const saveTmdbKind = useSettingsStore((s) => s.saveTmdbKind);
  const saveFanartKind = useSettingsStore((s) => s.saveFanartKind);
  const saveStyle = useSettingsStore((s) => s.saveStyle);
  const saveAudio = useSettingsStore((s) => s.saveAudio);
  const toast = useToastStore((s) => s.toast);
  const setupOs = detectOs();
  const setupChoices = playerChoicesFor(setupOs);
  const isLinuxSetup = setupOs === 'linux';
  const [player, setPlayer] = useState<string>(() => {
    const pref = readPlayerPreference();
    return pref && setupChoices.some((c) => c.id === pref) ? pref : (setupChoices[0]?.id ?? 'vlc');
  });

  // Manual artwork tester state.
  const [previewType, setPreviewType] = useState<MediaType>('movie');
  const [previewId, setPreviewId] = useState<number | null>(null);
  const [preview, setPreview] = useState<ArtworkPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewRequested, setPreviewRequested] = useState(false);
  const [customPreviewId, setCustomPreviewId] = useState('');

  useEffect(() => {
    if (!ready) void loadSettings();
  }, [ready, loadSettings]);

  const samplePreviewId = previewId ?? (previewType === 'movie' ? 603 : 1396);

  async function loadArtworkPreview(): Promise<void> {
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      setPreview(await artworkPreview(samplePreviewId, previewType));
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : 'Preview unavailable');
      setPreview(null);
    } finally {
      setPreviewLoading(false);
    }
  }

  // Fetch a sample only after the user asks for one (or switches provider while a
  // sample is already showing). Never fires on a cold settings load.
  useEffect(() => {
    if (!previewRequested || !ready) return;
    void loadArtworkPreview();
  }, [previewRequested, ready, provider, fanartConfigured, previewType, previewId]);

  function selectPreviewType(type: MediaType): void {
    setPreviewType(type);
    setPreviewId(null);
    setPreviewRequested(true);
  }

  function loadCustomPreviewId(): void {
    const parsed = Number(customPreviewId.trim());
    if (!Number.isInteger(parsed) || parsed <= 0) return;
    setPreviewId(parsed);
    setPreviewRequested(true);
  }

  function downloadScript(name: string, text: string): void {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  function changePlayer(id: string): void {
    if (id === player) return;
    setPlayer(id);
    savePlayerPreference(id);
    toast(`Local player: ${setupChoices.find((p) => p.id === id)?.label ?? id}`, 'info');
  }

  async function changeProvider(next: ImageProvider): Promise<void> {
    if (next === provider || saving) return;
    try {
      await saveProvider(next);
      toast('Artwork source updated', 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Save failed', 'error');
    }
  }

  async function changeTmdbKind(kind: TmdbArtKind): Promise<void> {
    if (preference.tmdb === kind || saving) return;
    try {
      await saveTmdbKind(kind);
      toast(`TMDB artwork: ${tmdbArtKindLabel(kind)}`, 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Save failed', 'error');
    }
  }

  async function changeFanartKind(kind: FanartArtKind): Promise<void> {
    if (preference.fanart === kind || saving) return;
    try {
      await saveFanartKind(kind);
      toast(`FanArt.tv artwork: ${fanartArtKindLabel(kind)}`, 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Save failed', 'error');
    }
  }

  async function changeStyle(next: CardStyle): Promise<void> {
    if (next === style || saving) return;
    try {
      await saveStyle(next);
      toast(next === 'poster' ? 'Card style: poster-first' : 'Card style: backdrop tile', 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Save failed', 'error');
    }
  }

  async function changeAudio(next: AudioLang): Promise<void> {
    if (next === audio || saving) return;
    try {
      await saveAudio(next);
      toast(`Audio language: ${audioLanguageLabel(next)}`, 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Save failed', 'error');
    }
  }

  function artworkButton(option: ImageProvider, label: string, hint: string, disabled = false): ReactNode {
    const active = provider === option && !disabled;
    return (
      <button
        type="button"
        className={`btn ${active ? 'btn-white' : 'btn-outline'} artwork-option`}
        aria-pressed={active}
        disabled={disabled || saving}
        onClick={() => void changeProvider(option)}
      >
        <span className="artwork-option-label">{label}</span>
        <span className="artwork-option-hint">{hint}</span>
      </button>
    );
  }

  function copyDiagnostics(): void {
    void navigator.clipboard.writeText(diagnostics()).then(
      () => undefined,
      () => undefined,
    );
  }

  const previewFanart = preview?.fanart ?? null;

  const fanartSizeOptions: FanartArtKind[] = ['thumb', 'background', 'poster'];
  const tmdbSizeOptions: TmdbArtKind[] = ['backdrop', 'poster'];

  function fanartPreviewSrc(kind: FanartArtKind): string | null {
    if (!previewFanart) return null;
    switch (kind) {
      case 'thumb':
        return previewFanart.thumbUrl;
      case 'background':
        return previewFanart.backgroundUrl;
      case 'poster':
        return previewFanart.posterUrl;
    }
  }

  function tmdbPreviewSrc(kind: TmdbArtKind): string | null {
    if (!preview) return null;
    return kind === 'backdrop' ? backdropUrl(preview.tmdb.backdropPath) : posterUrl(preview.tmdb.posterPath);
  }

  function sizeOptionButton<T extends string>({
    key,
    label,
    src,
    active,
    disabled,
    onClick,
    previewLabel,
  }: {
    key: T;
    label: string;
    src: string | null;
    active: boolean;
    disabled: boolean;
    onClick: () => void;
    previewLabel: string;
  }): ReactNode {
    return (
      <button
        key={key}
        type="button"
        className={`artwork-size-option ${active ? 'selected' : ''}`}
        aria-pressed={active}
        disabled={disabled}
        onClick={onClick}
      >
        <span className="artwork-size-preview" aria-hidden="true">
          {src ? <img src={src} alt="" loading="lazy" /> : <span className="artwork-size-empty">{previewLabel}</span>}
        </span>
        <span className="artwork-size-label">{label}</span>
      </button>
    );
  }

  const showPreview = true;

  return (
    <div className="page">
      <h1 className="page-title">Settings</h1>
      <p className="page-sub">System status and configuration reference.</p>

      <section className="settings-card">
        <h2>Artwork source</h2>
        <p className="settings-note">
          Titles load artwork only from the selected provider — nothing silently falls back to the
          other one. Titles the provider has no art for simply show a placeholder.
        </p>
        {!fanartConfigured && (
          <p className="settings-note settings-note-warn">
            FanArt.tv needs a key: add <code>FANART_API_KEY</code> to <code>.env</code> and restart.
          </p>
        )}
        <div className="artwork-options" role="group" aria-label="Artwork source">
          {artworkButton('tmdb', 'TMDB', 'Backdrops and posters from TMDB (requires TMDB_API_KEY)')}
          {artworkButton('fanart', 'FanArt.tv', 'Key art and logos from FanArt.tv', !fanartConfigured)}
        </div>

        {provider === 'fanart' ? (
          <div className="artwork-size-group">
            <h3 className="artwork-size-title">Preferred FanArt.tv size</h3>
            <p className="settings-note">
              Pick which FanArt.tv image a card should try first. FanArt only ever falls back to
              other FanArt.tv sizes — it never borrows TMDB artwork.
            </p>
            <div className="artwork-options" role="group" aria-label="Preferred FanArt size">
              {fanartSizeOptions.map((kind) =>
                sizeOptionButton({
                  key: kind,
                  label: fanartArtKindLabel(kind),
                  src: fanartPreviewSrc(kind),
                  active: preference.fanart === kind,
                  disabled: !fanartConfigured || saving,
                  onClick: () => void changeFanartKind(kind),
                  previewLabel: 'FanArt has no\nimage for sample',
                }),
              )}
            </div>
          </div>
        ) : (
          <div className="artwork-size-group">
            <h3 className="artwork-size-title">Preferred TMDB size</h3>
            <p className="settings-note">
              Pick which TMDB image a card should try first. TMDB only ever falls back to the other
              TMDB size — it never borrows FanArt.tv artwork.
            </p>
            <div className="artwork-options" role="group" aria-label="Preferred TMDB size">
              {tmdbSizeOptions.map((kind) =>
                sizeOptionButton({
                  key: kind,
                  label: tmdbArtKindLabel(kind),
                  src: tmdbPreviewSrc(kind),
                  active: preference.tmdb === kind,
                  disabled: saving,
                  onClick: () => void changeTmdbKind(kind),
                  previewLabel: 'TMDB has no\nimage for sample',
                }),
              )}
            </div>
          </div>
        )}

        {showPreview && (
          <div className="artwork-tester">
            <h3 className="artwork-size-title">Test on a title</h3>
            <p className="settings-note">
              Preview how each size looks on a real title before choosing. Samples load from the
              active provider only.
            </p>
            <div className="artwork-options" role="group" aria-label="Preview sample">
              <button
                type="button"
                className={`btn ${previewType === 'movie' ? 'btn-white' : 'btn-outline'} artwork-option`}
                aria-pressed={previewType === 'movie'}
                disabled={previewLoading}
                onClick={() => selectPreviewType('movie')}
              >
                <span className="artwork-option-label">Movie</span>
                <span className="artwork-option-hint">The Matrix (603)</span>
              </button>
              <button
                type="button"
                className={`btn ${previewType === 'tv' ? 'btn-white' : 'btn-outline'} artwork-option`}
                aria-pressed={previewType === 'tv'}
                disabled={previewLoading}
                onClick={() => selectPreviewType('tv')}
              >
                <span className="artwork-option-label">TV Show</span>
                <span className="artwork-option-hint">Breaking Bad (1396)</span>
              </button>
              <button
                type="button"
                className="btn btn-outline artwork-option"
                disabled={previewLoading || !previewRequested}
                onClick={() => void loadArtworkPreview()}
              >
                <span className="artwork-option-label">Reload</span>
                <span className="artwork-option-hint">Re-fetch this sample</span>
              </button>
            </div>
            <div className="settings-row artwork-tester-custom">
              <label htmlFor="artwork-test-id">TMDB ID</label>
              <span className="artwork-tester-custom-input">
                <input
                  id="artwork-test-id"
                  className="sort-select"
                  type="number"
                  min={1}
                  placeholder={previewType === 'movie' ? 'e.g. 603 (The Matrix)' : 'e.g. 1396 (Breaking Bad)'}
                  value={customPreviewId}
                  onChange={(e) => setCustomPreviewId(e.target.value)}
                />
                <button
                  type="button"
                  className="btn btn-white btn-sm"
                  disabled={previewLoading}
                  onClick={loadCustomPreviewId}
                >
                  Test this ID
                </button>
              </span>
            </div>
            {preview && (
              <p className="settings-note artwork-tester-sample">
                Showing: {preview.title} ({preview.year ?? '—'}) · {preview.mediaType}
              </p>
            )}
            {previewLoading && <p className="settings-note">Loading sample art…</p>}
            {previewError && <p className="settings-note settings-note-warn">{previewError}</p>}
            {previewFanart == null && provider === 'fanart' && !previewLoading && !previewError && previewRequested && (
              <p className="settings-note settings-note-warn">
                No FanArt.tv art returned for this sample — the size previews above will look empty.
              </p>
            )}
          </div>
        )}
      </section>

      <section className="settings-card">
        <h2>Card style</h2>
        <p className="settings-note">
          Temporary A/B while the poster-first artwork pipeline is being compared (D17). Pick which
          look the 16:9 home/download tiles use; the loser gets removed.
        </p>
        <div className="artwork-options" role="group" aria-label="Card style">
          {(
            [
              { value: 'backdrop', label: 'Backdrop tile', hint: 'Current — full-bleed artwork' },
              { value: 'poster', label: 'Poster-first', hint: 'New — poster as the identity' },
            ] as const
          ).map((option) => {
            const active = style === option.value;
            return (
              <button
                key={option.value}
                type="button"
                className={`btn ${active ? 'btn-white' : 'btn-outline'} artwork-option`}
                aria-pressed={active}
                disabled={saving || !ready}
                onClick={() => void changeStyle(option.value)}
              >
                <span className="artwork-option-label">{option.label}</span>
                <span className="artwork-option-hint">{option.hint}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="settings-card">
        <h2>Local player</h2>
        <p className="settings-note">
          Browsers can’t launch desktop apps by themselves. The “Player” buttons on the Watch and
          Downloads pages use a <code>movie://</code> link your machine has to know how to open — a
          one-time setup. Pick which of your installed players to use (what you already have is
          auto-detected), then download and run the installer once on this computer.
        </p>
        <div className="artwork-options" role="group" aria-label="Local player">
          {setupChoices.map((choice) => {
            const active = player === choice.id;
            return (
              <button
                key={choice.id}
                type="button"
                className={`btn ${active ? 'btn-white' : 'btn-outline'} artwork-option`}
                aria-pressed={active}
                onClick={() => changePlayer(choice.id)}
              >
                <span className="artwork-option-label">{choice.label}</span>
                <span className="artwork-option-hint">{choice.hint}</span>
              </button>
            );
          })}
        </div>
        <div className="settings-actions" style={{ display: 'flex', gap: '10px', marginTop: '12px', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-white btn-sm"
            onClick={() =>
              downloadScript(
                isLinuxSetup ? 'install-movie-player.sh' : 'install-movie-player.cmd',
                isLinuxSetup ? buildLinuxInstallerSh(player) : buildOpenerCmd(player),
              )
            }
          >
            {isLinuxSetup ? 'Download installer (.sh)' : 'Download installer (.cmd)'}
          </button>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={() =>
              downloadScript(
                isLinuxSetup ? 'uninstall-movie-player.sh' : 'uninstall-movie-player.cmd',
                isLinuxSetup ? buildLinuxUninstallerSh() : buildUninstallerCmd(),
              )
            }
          >
            Download uninstaller
          </button>
        </div>
        <p className="settings-note">
          {isLinuxSetup ? (
            <>
              Then run it once in a terminal: <code>bash ~/Downloads/install-movie-player.sh</code> — it
              finds your installed player (MPV, VLC) and registers the <code>movie://</code> handler.
            </>
          ) : (
            <>
              Then run the downloaded <code>.cmd</code> once on this computer (Windows) — it finds your
              installed player and registers the <code>movie://</code> handler.
            </>
          )}
        </p>
      </section>

      <section className="settings-card">
        <h2>Audio language</h2>
        <p className="settings-note">
          Pick the audio your viewers expect. English is the default and shows every release.
          Other languages filter strictly to matching audio (dubbed, dual or tagged releases)
          and only fall back to English results after you confirm, if nothing was found.
        </p>
        <div className="settings-row">
          <label htmlFor="audio-lang">Preferred audio</label>
          <select
            id="audio-lang"
            className="sort-select"
            value={audio}
            disabled={saving || !ready}
            onChange={(e) => void changeAudio(e.target.value as AudioLang)}
          >
            {AUDIO_LANGUAGE_OPTIONS.map((option) => (
              <option key={option.code} value={option.code}>
                {option.label} — {option.hint}
              </option>
            ))}
          </select>
        </div>
        <p className="settings-note">
          Tip: for results in a specific language, add matching indexers (e.g. Brazilian private
          trackers) in Prowlarr — the app auto-detects them and uses them for that language.
        </p>
      </section>

      <section className="settings-card">
        <h2>System</h2>
        <dl className="settings-row">
          <dt>Backend (REST + Socket.IO)</dt>
          <dd>
            <span className={`conn-dot ${connected ? 'conn-on' : 'conn-off'}`} aria-hidden="true" />
            {connected ? 'Connected' : 'Offline'}
          </dd>
        </dl>
        <dl className="settings-row">
          <dt>Download updates</dt>
          <dd>Live — pushed every 2 seconds while connected</dd>
        </dl>
        <button type="button" className="btn btn-outline btn-sm" onClick={copyDiagnostics}>
          Copy diagnostics
        </button>
      </section>

      <section className="settings-card">
        <h2>Configuration</h2>
        <p className="settings-note">
          Credentials are managed outside the UI for safety. Edit <code>.env</code> at the repo root
          and restart with <code>docker compose up -d --build</code>.
        </p>
        {CONFIG_KEYS.map(({ key, description }) => (
          <dl className="settings-row" key={key}>
            <dt>
              <code>{key}</code>
            </dt>
            <dd>{description}</dd>
          </dl>
        ))}
      </section>

      <section className="settings-card">
        <h2>About</h2>
        <dl className="settings-row">
          <dt>Movie Downloader</dt>
          <dd>Self-hosted search · download · stream</dd>
        </dl>
        <dl className="settings-row">
          <dt>Services</dt>
          <dd>TMDB · Prowlarr · qBittorrent · PostgreSQL</dd>
        </dl>
      </section>
    </div>
  );
}
