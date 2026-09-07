import { useState } from 'react';
import { useDownloadsStore } from '@/store/downloadsStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useFriendlyPickStore, FRIENDLY_PICK_OPTIONS } from '@/store/friendlyPickStore';
import { useToastStore } from '@/store/toastStore';
import { usePosterStyleStore, type PosterStyle } from '@/store/posterStyleStore';
import type { AudioLang, FriendlyPickMode } from '@/types';
import {
  buildLinuxInstallerSh,
  buildLinuxUninstallerSh,
  buildOpenerCmd,
  buildUninstallerCmd,
  detectOs,
  isOpenerSetupDone,
  markOpenerSetupDone,
  playerChoicesFor,
  readPlayerPreference,
  savePlayerPreference,
} from '@/lib/openerInstaller';
import { AUDIO_LANGUAGE_OPTIONS, audioLanguageLabel } from '@/lib/audio';

const CONFIG_KEYS: Array<{ key: string; description: string }> = [
  { key: 'TMDB_API_KEY', description: 'Metadata provider (TMDB)' },
  { key: 'OMDB_API_KEY', description: 'Portrait-poster provider (OMDb)' },
  { key: 'FANART_API_KEY', description: 'Horizontal key-art provider (fanart.tv)' },
  { key: 'PROWLARR_URL', description: 'Torrent indexer aggregator base URL' },
  { key: 'PROWLARR_API_KEY', description: 'Prowlarr API key' },
  { key: 'QBITTORRENT_URL', description: 'qBittorrent Web UI URL' },
  { key: 'QBITTORRENT_USER / QBITTORRENT_PASS', description: 'qBittorrent credentials' },
  { key: 'DOWNLOAD_DIR', description: 'Shared download/stream volume' },
];

const POSTER_STYLE_OPTIONS: Array<{ id: PosterStyle; label: string; hint: string }> = [
  {
    id: 'horizontal',
    label: 'Horizontal',
    hint: 'Wide 16:9 poster cards with key-art thumbnails (default)',
  },
  {
    id: 'vertical',
    label: 'Vertical 2:3',
    hint: 'Classic poster cards using TMDB poster art',
  },
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
  const posterStyle = usePosterStyleStore((s) => s.style);
  const setPosterStyle = usePosterStyleStore((s) => s.setStyle);
  const setupOs = detectOs();
  const setupChoices = playerChoicesFor(setupOs);
  const isLinuxSetup = setupOs === 'linux';
  const setupSupported = setupOs === 'linux' || setupOs === 'windows';
  const [player, setPlayer] = useState<string>(() => {
    const pref = readPlayerPreference();
    return pref && setupChoices.some((c) => c.id === pref) ? pref : (setupChoices[0]?.id ?? 'vlc');
  });
  const [setupDone, setSetupDone] = useState<boolean>(() => isOpenerSetupDone());

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

  async function copyScript(text: string, label: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      toast(`${label} copied — save it and run it on this computer.`, 'success');
    } catch {
      toast('Couldn’t access the clipboard — use “Download installer” instead.', 'error');
    }
  }

  function installerName(): string {
    return isLinuxSetup ? 'install-movie-player.sh' : 'install-movie-player.cmd';
  }
  function installerText(): string {
    return isLinuxSetup ? buildLinuxInstallerSh(player) : buildOpenerCmd(player);
  }

  function changePlayer(id: string): void {
    if (id === player) return;
    setPlayer(id);
    savePlayerPreference(id);
    if (setupDone) {
      // The registered handler is bound to the previously installed player —
      // switching requires one re-run, so drop the "registered" confirmation.
      setSetupDone(false);
      markOpenerSetupDone(false);
      toast(`Local player: ${setupChoices.find((p) => p.id === id)?.label ?? id} — re-run the installer for it to take effect.`, 'info');
    } else {
      toast(`Local player: ${setupChoices.find((p) => p.id === id)?.label ?? id}`, 'info');
    }
  }

  function confirmSetup(done: boolean): void {
    setSetupDone(done);
    markOpenerSetupDone(done);
    if (done) toast('Local player confirmed — Player buttons now open files in your player.', 'success');
  }

  function changePosterStyle(style: PosterStyle): void {
    if (style === posterStyle) return;
    setPosterStyle(style);
    toast(`Poster style: ${POSTER_STYLE_OPTIONS.find((o) => o.id === style)?.label ?? style}`, 'info');
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
          The “Player” buttons on Watch, Downloads and Detail open the video in an app on this
          computer. Browsers can’t launch desktop apps by themselves, so your machine has to know the{' '}
          <code>movie://</code> link once — that’s the one-time setup below. Which player opens is
          decided here (your pick is auto-detected first when the installer runs).
        </p>

        {!setupSupported ? (
          <p className="settings-note settings-note-warn">
            Local-player setup is supported on Windows and Linux. On this system, use the “Download
            file” button instead and open the file in any player you like.
          </p>
        ) : (
          <>
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

            <div className="setup-box">
              <h3 className="setup-title">
                {isLinuxSetup ? 'What the Linux installer does (nothing hidden)' : 'What the Windows installer does (nothing hidden)'}
              </h3>
              <ul className="setup-list">
                {isLinuxSetup ? (
                  <>
                    <li>
                      Detects an installed player — <strong>{setupChoices.find((c) => c.id === player)?.label}</strong> first,
                      then the other. Prints what it finds, e.g. <code>Found: VLC (/usr/bin/vlc)</code>.
                    </li>
                    <li>
                      Writes a small launcher: <code>~/.local/share/movie-downloader/movie-open.sh</code>.
                    </li>
                    <li>
                      Registers it as the <code>movie://</code> handler via a desktop entry +{' '}
                      <code>xdg-mime</code>, then verifies and prints the result.
                    </li>
                  </>
                ) : (
                  <>
                    <li>
                      Detects an installed player among VLC / MPV / MPC-HC / PotPlayer —{' '}
                      <strong>{setupChoices.find((c) => c.id === player)?.label}</strong> first — and prints
                      where it found it.
                    </li>
                    <li>
                      Writes a small launcher: <code>%LOCALAPPDATA%\MovieDownloader\movie-open.ps1</code>.
                    </li>
                    <li>
                      Registers it as the <code>movie://</code> handler under{' '}
                      <code>HKCU:\Software\Classes\movie</code> (current user only, no admin), then
                      verifies and prints the result.
                    </li>
                  </>
                )}
              </ul>
              <p className="settings-note">
                That’s the whole change: two small files (one is the launcher, one the registration)
                and nothing else is touched. Re-running the installer is safe — it simply overwrites
                them.
              </p>
              <p className="setup-status" aria-live="polite">
                Status:{' '}
                {setupDone ? (
                  <span className="setup-ok">movie:// registered — confirmed by you</span>
                ) : (
                  <span className="setup-off">Not registered yet</span>
                )}
              </p>
              <div className="settings-actions" style={{ display: 'flex', gap: '10px', marginTop: '12px', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn btn-white btn-sm"
                  onClick={() => downloadScript(installerName(), installerText())}
                >
                  Download installer ({isLinuxSetup ? '.sh' : '.cmd'})
                </button>
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={() => void copyScript(installerText(), 'Installer')}
                >
                  Copy installer
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
                    Run it once in a terminal:{' '}
                    <code>bash ~/Downloads/install-movie-player.sh</code> — it prints{' '}
                    <code>Found: …</code>, then <code>Verified: movie:// links now open …</code>.
                  </>
                ) : (
                  <>
                    Double-click the downloaded <code>install-movie-player.cmd</code> once — a console
                    window prints what it found and that <code>movie://</code> is registered.
                  </>
                )}
              </p>
              <div className="settings-actions" style={{ display: 'flex', gap: '10px', marginTop: '8px', alignItems: 'center' }}>
                {setupDone ? (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => confirmSetup(false)}>
                    Mark as not set up
                  </button>
                ) : (
                  <button type="button" className="btn btn-white btn-sm" onClick={() => confirmSetup(true)}>
                    I ran it — movie:// works
                  </button>
                )}
                <span className="settings-note">
                  {setupDone
                    ? 'Player buttons on Watch / Downloads / Detail open your player directly.'
                    : 'Until you confirm, the Player buttons route here instead of failing silently.'}
                </span>
              </div>
            </div>
          </>
        )}
      </section>

      <section className="settings-card">
        <h2>Poster style</h2>
        <p className="settings-note">
          How every Home and Search card is framed. Horizontal (default) shows real 16:9 key-art
          thumbnails — titles without one fall back to a backdrop with the studio logo overlaid.
          Vertical 2:3 narrows and tallens the cards and uses the raw TMDB poster instead.
        </p>
        <div className="artwork-options" role="group" aria-label="Poster style">
          {POSTER_STYLE_OPTIONS.map((option) => {
            const active = posterStyle === option.id;
            return (
              <button
                key={option.id}
                type="button"
                className={`btn ${active ? 'btn-white' : 'btn-outline'} artwork-option`}
                aria-pressed={active}
                onClick={() => changePosterStyle(option.id)}
              >
                <span className="artwork-option-label">{option.label}</span>
                <span className="artwork-option-hint">{option.hint}</span>
              </button>
            );
          })}
        </div>
        <p className="settings-note">
          Saved on this device only — each browser keeps its own preference.
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
          <dd>TMDB · OMDb · fanart.tv · Prowlarr · qBittorrent · PostgreSQL</dd>
        </dl>
      </section>
    </div>
  );
}
