import { useEffect, useState } from 'react';
import { useDownloadsStore } from '@/store/downloadsStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useFriendlyPickStore, FRIENDLY_PICK_OPTIONS } from '@/store/friendlyPickStore';
import { useToastStore } from '@/store/toastStore';
import { usePosterStyleStore, type PosterStyle } from '@/store/posterStyleStore';
import { usePosterImdbStore } from '@/store/posterImdbStore';
import { useTranscode4kStore } from '@/store/transcode4kStore';
import { remoteStatus, type RemoteStatus } from '@/api';
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
} from '@/lib/openerInstaller';
import { AUDIO_LANGUAGE_OPTIONS, audioLanguageLabel } from '@/lib/audio';

const CONFIG_KEYS: Array<{ key: string; description: string }> = [
  { key: 'TMDB_API_KEY', description: 'Metadata provider (TMDB)' },
  { key: 'OMDB_API_KEY', description: 'IMDb-rating provider (OMDb, optional)' },
  { key: 'FANART_API_KEY', description: 'Horizontal key-art provider (fanart.tv)' },
  { key: 'PROWLARR_URL', description: 'Torrent indexer aggregator base URL' },
  { key: 'PROWLARR_API_KEY', description: 'Prowlarr API key' },
  { key: 'QBITTORRENT_URL', description: 'qBittorrent Web UI URL' },
  { key: 'QBITTORRENT_USER / QBITTORRENT_PASS', description: 'qBittorrent credentials' },
  { key: 'DOWNLOAD_DIR', description: 'Shared download/stream volume' },
];

const POSTER_STYLE_OPTIONS: Array<{ id: PosterStyle; label: string; hint: string }> = [
  {
    id: 'vertical',
    label: 'Vertical 2:3',
    hint: 'Classic poster cards using TMDB poster art (default)',
  },
  {
    id: 'horizontal',
    label: 'Horizontal',
    hint: 'Wide 16:9 poster cards with key-art thumbnails',
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
  const showImdb = usePosterImdbStore((s) => s.show);
  const setShowImdb = usePosterImdbStore((s) => s.setShow);
  const transcode4k = useTranscode4kStore((s) => s.enabled);
  const setTranscode4k = useTranscode4kStore((s) => s.setEnabled);
  const [remote, setRemote] = useState<RemoteStatus | null>(null);
  const setupOs = detectOs();
  const setupChoices = playerChoicesFor(setupOs);
  const isLinuxSetup = setupOs === 'linux';
  const setupSupported = setupOs === 'linux' || setupOs === 'windows';
  const [player] = useState<string>(() => {
    const pref = readPlayerPreference();
    return pref && setupChoices.some((c) => c.id === pref) ? pref : (setupChoices[0]?.id ?? 'vlc');
  });
  const [setupDone, setSetupDone] = useState<boolean>(() => isOpenerSetupDone());

  useEffect(() => {
    let cancelled = false;
    remoteStatus()
      .then((r) => {
        if (!cancelled) setRemote(r);
      })
      .catch(() => {
        if (!cancelled) setRemote(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
      toast('Couldn’t access the clipboard — use “Download setup file” instead.', 'error');
    }
  }

  function installerName(): string {
    return isLinuxSetup ? 'install-movie-player.sh' : 'install-movie-player.cmd';
  }
  function installerText(): string {
    return isLinuxSetup ? buildLinuxInstallerSh(player) : buildOpenerCmd(player);
  }

  function confirmSetup(done: boolean): void {
    setSetupDone(done);
    markOpenerSetupDone(done);
    if (done) toast('Local player connected — Player buttons now open your player.', 'success');
    else toast('Marked as not connected — run the setup file once and Player buttons will open your player.', 'info');
  }

  function changePosterStyle(style: PosterStyle): void {
    if (style === posterStyle) return;
    setPosterStyle(style);
    toast(`Poster style: ${POSTER_STYLE_OPTIONS.find((o) => o.id === style)?.label ?? style}`, 'info');
  }

  function changeShowImdb(next: boolean): void {
    if (next === showImdb) return;
    setShowImdb(next);
    toast(next ? 'IMDb ratings: shown on posters' : 'IMDb ratings: hidden on posters', 'info');
  }

  function changeTranscode4k(next: boolean): void {
    if (next === transcode4k) return;
    setTranscode4k(next);
    toast(next ? '4K → 1080p web copy: enabled' : '4K → 1080p web copy: disabled', 'info');
  }

  function refreshRemote(): void {
    setRemote(null);
    remoteStatus()
      .then((r) => setRemote(r))
      .catch(() => setRemote(null));
  }

  function copyRemoteUrl(url: string): void {
    void navigator.clipboard
      .writeText(url)
      .then(() => toast('Remote URL copied — open it on your TV or another device.', 'success'))
      .catch(() => toast('Couldn’t access the clipboard.', 'error'));
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
          The <strong>Player</strong> buttons on a title, on Watch and on Downloads open the video in
          a player app installed on this computer — VLC, MPV, MPC-HC or PotPlayer. You connect your
          player once below; after that, the buttons just open it.
        </p>

        {!setupSupported ? (
          <p className="settings-note settings-note-warn">
            This computer can’t hand a video to a desktop app on its own, so the Player buttons
            aren’t available here. Use the “Download file” button on the video instead, then open it
            in any player you like.
          </p>
        ) : (
          <>
            <h3 className="player-heading">
              Get a player <span className="player-heading-note">— only if you don’t have one yet</span>
            </h3>
            <p className="settings-note">
              Watching in the browser needs no extra apps. If you’d rather watch in a dedicated
              player, pick one from its official website — nothing here installs anything by itself.
            </p>
            <div className="player-cards" aria-label="Get a player">
              {setupChoices.map((choice) => (
                <a
                  key={choice.id}
                  className={`player-card${choice.recommended ? ' player-card-rec' : ''}`}
                  href={choice.siteUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  <span className="player-card-top">
                    <span className="player-card-label">{choice.label}</span>
                    {choice.recommended && <span className="player-card-tag">Recommended</span>}
                  </span>
                  <span className="player-card-hint">{choice.hint}</span>
                  <span className="player-card-link">Official download ↗</span>
                </a>
              ))}
            </div>

            <h3 className="player-heading">Connect your player</h3>
            <p className="settings-note">
              Browsers can’t launch desktop apps by themselves, so this computer needs one tiny setup
              file to know to hand the video to your player. Download it and double-click it once —
              that’s the whole setup.
            </p>
            <div className="settings-actions">
              <button type="button" className="btn btn-white btn-sm" onClick={() => downloadScript(installerName(), installerText())}>
                Download setup file ({isLinuxSetup ? '.sh' : '.cmd'})
              </button>
            </div>
            <p className="setup-status" aria-live="polite">
              Status:{' '}
              {setupDone ? (
                <span className="setup-ok">Connected — Player buttons open your player</span>
              ) : (
                <span className="setup-off">Not connected yet</span>
              )}
            </p>
            <div className="settings-actions">
              {setupDone ? (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => confirmSetup(false)}>
                  Not working? Mark as not connected
                </button>
              ) : (
                <button type="button" className="btn btn-outline btn-sm" onClick={() => confirmSetup(true)}>
                  I’ve run the file — connected
                </button>
              )}
            </div>

            <details className="setup-details">
              <summary>What this file does (technical)</summary>
              <p className="settings-note">
                Your Player buttons already try to open your player — this file just registers the
                tiny launcher that hands the video over. Re-running it is safe: it simply overwrites
                the launcher.
              </p>
              <ul className="setup-list">
                {isLinuxSetup ? (
                  <>
                    <li>
                      Finds your installed player — <strong>{setupChoices.find((c) => c.id === player)?.label}</strong> first —
                      and prints where.
                    </li>
                    <li>
                      Writes a small launcher: <code>~/.local/share/movie-downloader/movie-open.sh</code>.
                    </li>
                    <li>
                      Registers it as the <code>movie://</code> handler via a desktop entry +{' '}
                      <code>xdg-mime</code>, then verifies it.
                    </li>
                  </>
                ) : (
                  <>
                    <li>
                      Finds your installed player — <strong>{setupChoices.find((c) => c.id === player)?.label}</strong> first —
                      and prints where.
                    </li>
                    <li>
                      Writes a small launcher: <code>%LOCALAPPDATA%\MovieDownloader\movie-open.ps1</code>.
                    </li>
                    <li>
                      Registers it as the <code>movie://</code> handler for your user only (no admin),
                      then verifies it.
                    </li>
                  </>
                )}
              </ul>
              <p className="settings-note">
                Run the downloaded file once. Windows: double-click it — a console window prints what
                it found. Linux: <code>bash ~/Downloads/install-movie-player.sh</code>.
              </p>
              <div className="settings-actions">
                <button type="button" className="btn btn-outline btn-sm" onClick={() => void copyScript(installerText(), 'Setup file')}>
                  Copy setup file
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
            </details>
          </>
        )}
      </section>

      <section className="settings-card">
        <h2>Poster style</h2>
        <p className="settings-note">
          How every Home and Search card is framed. Vertical 2:3 is the default view — classic
          poster cards using the raw TMDB poster. Switch to Horizontal for wide 16:9 key-art
          thumbnails; titles without one fall back to a backdrop with the studio logo overlaid.
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
        <h2>IMDb ratings on posters</h2>
        <p className="settings-note">
          Show the title's true IMDb score as a small badge in the bottom-left corner of every
          poster card. The score comes from the cached poster-pipeline data and only appears for
          titles it has resolved — titles without a score never show an empty badge.
        </p>
        <label className="toggle-row">
          <span className="toggle-label">Show IMDb rating badge on posters</span>
          <span className="toggle-control">
            <input
              type="checkbox"
              className="toggle-input"
              checked={showImdb}
              onChange={(e) => changeShowImdb(e.target.checked)}
              aria-label="Show IMDb rating badge on posters"
            />
            <span className="toggle-track" aria-hidden="true">
              <span className="toggle-thumb" />
            </span>
          </span>
        </label>
        <p className="settings-note">
          Saved on this device only — each browser keeps its own preference. The IMDb chips on the
          hover card and Detail page are unaffected.
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
        <h2>Web playback</h2>
        <p className="settings-note">
          Most titles already play in-browser, and HEVC/x265 ≤1080p files automatically build a
          cached H.264 copy. 4K/UHD files don't decode in any browser, so by default they stay
          bit-perfect in your local player. Enable the option below to instead build a cached
          1080p copy for 4K files — it's slow (up to a couple of hours) and uses ~4 GB per title,
          but then those play in-browser too.
        </p>
        <label className="toggle-row">
          <span className="toggle-label">Build a 1080p copy for 4K/UHD files</span>
          <span className="toggle-control">
            <input
              type="checkbox"
              className="toggle-input"
              checked={transcode4k}
              onChange={(e) => changeTranscode4k(e.target.checked)}
              aria-label="Build a 1080p copy for 4K/UHD files"
            />
            <span className="toggle-track" aria-hidden="true">
              <span className="toggle-thumb" />
            </span>
          </span>
        </label>
        <p className="settings-note">
          Saved on this device only — each browser keeps its own preference.
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
        <h2>Remote access</h2>
        <p className="settings-note">
          Watch from anywhere — your TV, another computer or your phone — by exposing this app over
          a Cloudflare tunnel while your machine stays on. The tunnel is always on: open the URL
          below on another device to watch there.
        </p>
        {remote == null ? (
          <p className="settings-note">Checking…</p>
        ) : remote.url ? (
          <div className="settings-row">
            <span className="toggle-label">
              {remote.mode === 'named' ? 'Your domain' : 'Public URL (changes on restart)'}
            </span>
            <span className="remote-url" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <code style={{ wordBreak: 'break-all' }}>{remote.url}</code>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => copyRemoteUrl(remote.url!)}>
                Copy
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={refreshRemote}>
                Refresh
              </button>
            </span>
          </div>
        ) : (
          <p className="settings-note">
            Tunnel starting — a URL appears here once cloudflared connects (this can take a few
            seconds).
          </p>
        )}
        <p className="settings-note settings-note-warn">
          There is no login. Anyone with the URL can search, download and delete — treat the URL
          like a password and don't share it. A token gate is planned for later.
        </p>
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
