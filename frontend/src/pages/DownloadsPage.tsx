import { useNavigate } from 'react-router-dom';
import { useDownloadsStore } from '@/store/downloadsStore';
import { useToastStore } from '@/store/toastStore';
import {
  removeDownload,
  pauseDownload,
  resumeDownload,
  fileUrl,
  humanSpeed,
  humanEta,
  posterUrl,
} from '@/api';
import { StateBadge } from '@/components/StateBadge';
import type { DownloadRecord } from '@/types';

export function DownloadsPage() {
  const downloads = useDownloadsStore((s) => s.downloads);
  const removeLocal = useDownloadsStore((s) => s.removeLocal);
  const toast = useToastStore((s) => s.toast);
  const navigate = useNavigate();

  const active = downloads.filter((d) => !(d.progress >= 1 || d.state === 'seeding')).length;
  const completed = downloads.length - active;

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

  const ordered = [...downloads].sort((a, b) =>
    (b.completedAt ?? b.createdAt).localeCompare(a.completedAt ?? a.createdAt),
  );

  return (
    <div className="downloads-page">
      <div className="downloads-page-head">
        <h1 className="home-title">Downloads</h1>
        <p className="home-tagline">
          {downloads.length === 0
            ? 'Your downloaded movies will appear here.'
            : `${completed} completed · ${active} in progress · ${downloads.length} total`}
        </p>
      </div>

      {downloads.length === 0 ? (
        <div className="empty-state">Nothing downloaded yet. Search and start a download to begin.</div>
      ) : (
        <ul className="downloads-list">
          {ordered.map((d) => (
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
                  {d.etaSeconds != null && <span>ETA {humanEta(d.etaSeconds)}</span>}
                </div>
                <div className="progress-track" aria-label={`${Math.round(d.progress * 100)}%`}>
                  <div className="progress-fill" style={{ width: `${Math.round(d.progress * 100)}%` }} />
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
    </div>
  );
}
