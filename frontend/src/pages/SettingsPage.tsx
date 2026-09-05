import { useEffect, type ReactNode } from 'react';
import { useDownloadsStore } from '@/store/downloadsStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useToastStore } from '@/store/toastStore';
import type { ImageProvider } from '@/types';

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
  const fanartConfigured = useSettingsStore((s) => s.fanartConfigured);
  const ready = useSettingsStore((s) => s.ready);
  const saving = useSettingsStore((s) => s.saving);
  const loadSettings = useSettingsStore((s) => s.load);
  const saveProvider = useSettingsStore((s) => s.saveProvider);
  const toast = useToastStore((s) => s.toast);

  useEffect(() => {
    if (!ready) void loadSettings();
  }, [ready, loadSettings]);

  async function changeProvider(next: ImageProvider): Promise<void> {
    if (next === provider || saving) return;
    try {
      await saveProvider(next);
      toast('Artwork source updated', 'success');
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
          {artworkButton(
            'tmdb',
            'TMDB',
            'Backdrops and posters from TMDB (requires TMDB_API_KEY)',
          )}
          {artworkButton(
            'fanart',
            'FanArt.tv',
            'Key art and logos from FanArt.tv',
            !fanartConfigured,
          )}
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
