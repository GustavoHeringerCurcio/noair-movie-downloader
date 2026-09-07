import { useState } from 'react';
import { useDownloadsStore } from '@/store/downloadsStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useFriendlyPickStore, FRIENDLY_PICK_OPTIONS } from '@/store/friendlyPickStore';
import { useToastStore } from '@/store/toastStore';
import type { AudioLang, FriendlyPickMode } from '@/types';
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
  { key: 'TMDB_API_KEY', description: 'Metadata provider (TMDB)' },
  { key: 'OMDB_API_KEY', description: 'Portrait-poster provider (OMDb)' },
  { key: 'PROWLARR_URL', description: 'Torrent indexer aggregator base URL' },
  { key: 'PROWLARR_API_KEY', description: 'Prowlarr API key' },
  { key: 'QBITTORRENT_URL', description: 'qBittorrent Web UI URL' },
  { key: 'QBITTORRENT_USER / QBITTORRENT_PASS', description: 'qBittorrent credentials' },
  { key: 'DOWNLOAD_DIR', description: 'Shared download/stream volume' },
];

function diagnostics(): string {
  const connected = useDownloadsStore.getState().connected;
  return `noAir · backend ${connected ? 'connected' : 'offline'} · browser ${typeof navigator !== 'undefined' ? navigator.userAgent : '?'}`;
}

export function SettingsPage() {
  const connected = useDownloadsStore((s) => s.connected);
  const audio = useSettingsStore((s) => s.audio);
  const ready = useSettingsStore((s) => s.ready);
  const saving = useSettingsStore((s) => s.saving);
  const loadSettings = useSettingsStore((s) => s.load);
  const saveAudio = useSettingsStore((s) => s.saveAudio);
  const friendlyPickMode = useFriendlyPickStore((s) => s.mode);
  const setFriendlyPickMode = useFriendlyPickStore((s) => s.setMode);
  const toast = useToastStore((s) => s.toast);
  const setupOs = detectOs();
  const setupChoices = playerChoicesFor(setupOs);
  const isLinuxSetup = setupOs === 'linux';
  const [player, setPlayer] = useState<string>(() => {
    const pref = readPlayerPreference();
    return pref && setupChoices.some((c) => c.id === pref) ? pref : (setupChoices[0]?.id ?? 'vlc');
  });

  if (!ready) void loadSettings();

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

  async function changeAudio(next: AudioLang): Promise<void> {
    if (next === audio || saving) return;
    try {
      await saveAudio(next);
      toast(`Audio language: ${audioLanguageLabel(next)}`, 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Save failed', 'error');
    }
  }

  function changeFriendlyPick(next: FriendlyPickMode): void {
    if (next === friendlyPickMode) return;
    setFriendlyPickMode(next);
    toast(`Friendly download: ${FRIENDLY_PICK_OPTIONS.find((o) => o.value === next)?.label ?? next}`, 'info');
  }

  function copyDiagnostics(): void {
    void navigator.clipboard.writeText(diagnostics()).then(
      () => undefined,
      () => undefined,
    );
  }

  return (
    <div className="page">
      <h1 className="page-title">Settings</h1>
      <p className="page-sub">System status and configuration reference.</p>

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
        <h2>Friendly download</h2>
        <p className="settings-note">
          The one-click <strong>Download</strong> button on Detail pages picks a release for you.
          Choose what “friendly” should optimise for: the release with the most seeders (whatever
          its codec), or a release this web app can actually play in-browser — x264/AV1, SDR, up
          to 1080p — falling back to most-seeded only when nothing qualifies. The Advanced picker
          always shows every release either way.
        </p>
        <div className="artwork-options" role="group" aria-label="Friendly download pick">
          {FRIENDLY_PICK_OPTIONS.map((option) => {
            const active = friendlyPickMode === option.value;
            return (
              <button
                key={option.value}
                type="button"
                className={`btn ${active ? 'btn-white' : 'btn-outline'} artwork-option`}
                aria-pressed={active}
                onClick={() => changeFriendlyPick(option.value)}
              >
                <span className="artwork-option-label">{option.label}</span>
                <span className="artwork-option-hint">{option.hint}</span>
              </button>
            );
          })}
        </div>
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
          <dt>noAir</dt>
          <dd>Self-hosted search · download · local watch</dd>
        </dl>
        <dl className="settings-row">
          <dt>Services</dt>
          <dd>TMDB · OMDb · Prowlarr · qBittorrent · PostgreSQL</dd>
        </dl>
      </section>
    </div>
  );
}
