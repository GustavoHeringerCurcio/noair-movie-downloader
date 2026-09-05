import { useDownloadsStore } from '../store/downloadsStore';

export function StatusBanner() {
  const connected = useDownloadsStore((s) => s.connected);
  const connect = useDownloadsStore((s) => s.connect);

  if (connected) return null;

  return (
    <div className="status-banner" role="status">
      <span>Backend offline — downloads paused until we reconnect.</span>
      <span className="spacer" />
      <button type="button" onClick={() => connect()}>
        Retry now
      </button>
    </div>
  );
}
