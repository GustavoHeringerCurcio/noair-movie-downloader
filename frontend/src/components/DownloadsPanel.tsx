import { useNavigate } from 'react-router-dom';
import { useDownloadsStore } from '../store/downloadsStore';
import { useToastStore } from '../store/toastStore';
import { removeDownload, pauseDownload, resumeDownload, fileUrl, humanSpeed, humanEta, posterUrl } from '../api';
import { StateBadge } from './StateBadge';
import type { DownloadRecord } from '../types';

interface DownloadsPanelProps {
  open: boolean;
  onClose: () => void;
}

export function DownloadsPanel({ open, onClose }: DownloadsPanelProps) {
  const downloads = useDownloadsStore((s) => s.downloads);
  const removeLocal = useDownloadsStore((s) => s.removeLocal);
  const toast = useToastStore((s) => s.toast);
  const navigate = useNavigate();

  if (!open) return null;

  async function handleRemove(download: DownloadRecord): Promise<void> {
    const confirmed = window.confirm(
      `Remove "${download.torrentName}" and delete its files? This cannot be undone.`,
    );
    if (!confirmed) return;
    try {
      await removeDownload(download.infoHash, true);
      removeLocal(download.infoHash);
      toast('Removed download', 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Remove failed', 'error');
    }
  }

  function handleDownloadFile(download: DownloadRecord): void {
    window.location.href = fileUrl(download.infoHash);
  }

  async function handlePause(download: DownloadRecord): Promise<void> {
    try {
      await pauseDownload(download.infoHash);
      toast('Paused', 'info');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Pause failed', 'error');
    }
  }

  async function handleResume(download: DownloadRecord): Promise<void> {
    try {
      await resumeDownload(download.infoHash);
      toast('Resumed', 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Resume failed', 'error');
    }
  }

  return (
    <>
      <div className="panel-backdrop" onClick={onClose} aria-hidden="true" />
      <aside className="downloads-panel" role="dialog" aria-label="Downloads">
        <header className="panel-header">
          <h2>Downloads</h2>
          <button type="button" className="btn btn-ghost" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        {downloads.length === 0 ? (
          <div className="panel-empty">No downloads yet</div>
        ) : (
          <ul className="downloads-list">
            {downloads.map((d) => (
              <li key={d.infoHash} className="download-row">
                {d.posterPath ? (
                  <img
                    className="download-poster"
                    src={posterUrl(d.posterPath) ?? ''}
                    alt=""
                    loading="lazy"
                  />
                ) : (
                  <div className="download-poster placeholder" aria-hidden="true" />
                )}
                <div className="download-info">
                  <div className="download-title" title={d.torrentName}>
                    {d.title ?? d.torrentName}
                  </div>
                  <div className="download-meta">
                    <StateBadge state={d.state} />
                    <span>{humanSpeed(d.downloadSpeed)}</span>
                    <span>ETA {humanEta(d.etaSeconds)}</span>
                  </div>
                  <div className="progress-track" aria-label={`${Math.round(d.progress * 100)}%`}>
                    <div
                      className="progress-fill"
                      style={{ width: `${Math.round(d.progress * 100)}%` }}
                    />
                  </div>
                  <div className="download-actions">
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={!d.streamable}
                      onClick={() => navigate(`/watch/${d.infoHash}`)}
                    >
                      Watch
                    </button>
                    {d.state === 'paused' ? (
                      <button type="button" className="btn btn-sm" onClick={() => handleResume(d)}>
                        Resume
                      </button>
                    ) : (
                      <button type="button" className="btn btn-sm" onClick={() => handlePause(d)}>
                        Pause
                      </button>
                    )}
                    <button type="button" className="btn btn-sm" onClick={() => handleDownloadFile(d)}>
                      Download file
                    </button>
                    <button type="button" className="btn btn-sm btn-danger" onClick={() => handleRemove(d)}>
                      Remove
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </>
  );
}
