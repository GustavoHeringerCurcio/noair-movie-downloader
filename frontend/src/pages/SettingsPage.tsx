import { useDownloadsStore } from '@/store/downloadsStore';

const CONFIG_KEYS: Array<{ key: string; description: string }> = [
  { key: 'TMDB_API_KEY', description: 'Metadata & images provider' },
  { key: 'PROWLARR_URL', description: 'Torrent indexer aggregator base URL' },
  { key: 'PROWLARR_API_KEY', description: 'Prowlarr API key' },
  { key: 'QBITTORRENT_URL', description: 'qBittorrent Web UI URL' },
  { key: 'QBITTORRENT_USER / QBITTORRENT_PASS', description: 'qBittorrent credentials' },
  { key: 'DOWNLOAD_DIR', description: 'Shared download/stream volume' },
];

export function SettingsPage() {
  const connected = useDownloadsStore((s) => s.connected);

  return (
    <div className="settings-page">
      <div className="settings-page-head">
        <h1 className="home-title">Settings</h1>
        <p className="home-tagline">System status and configuration reference.</p>
      </div>

      <section className="settings-card">
        <h2 className="rail-title">System</h2>
        <dl className="settings-list">
          <div className="settings-row">
            <dt>Backend (REST + Socket.IO)</dt>
            <dd>
              <span className={`conn-dot ${connected ? 'conn-on' : 'conn-off'}`} aria-hidden="true" />
              {connected ? 'Connected' : 'Offline'}
            </dd>
          </div>
          <div className="settings-row">
            <dt>Download updates</dt>
            <dd>Live — pushed every 2 seconds while connected</dd>
          </div>
        </dl>
      </section>

      <section className="settings-card">
        <h2 className="rail-title">Configuration</h2>
        <p className="settings-note">
          Credentials are managed outside the UI for safety. Edit <code>.env</code> at the repo root
          and restart with <code>docker compose up -d --build</code>.
        </p>
        <dl className="settings-list">
          {CONFIG_KEYS.map(({ key, description }) => (
            <div className="settings-row" key={key}>
              <dt>
                <code>{key}</code>
              </dt>
              <dd>{description}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="settings-card">
        <h2 className="rail-title">About</h2>
        <dl className="settings-list">
          <div className="settings-row">
            <dt>Movie Downloader</dt>
            <dd>Self-hosted search · download · stream</dd>
          </div>
          <div className="settings-row">
            <dt>Services</dt>
            <dd>TMDB · Prowlarr · qBittorrent · PostgreSQL</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
