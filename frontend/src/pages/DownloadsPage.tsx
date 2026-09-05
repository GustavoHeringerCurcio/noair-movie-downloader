import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Play, Pause, Trash2, FileDown, Download } from 'lucide-react';
import { useDownloadsStore } from '../store/downloadsStore';
import { useToastStore } from '../store/toastStore';
import {
  removeDownload,
  pauseDownload,
  resumeDownload,
  fileUrl,
  humanSpeed,
  humanEta,
} from '../api';
import { StateBadge } from '../components/StateBadge';
import { DownloadQualityChips } from '../components/DownloadQualityChips';
import { EmptyState } from '../components/EmptyState';
import type { DownloadRecord } from '../types';

type Tab = 'all' | 'downloading' | 'ready';

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'downloading', label: 'Downloading' },
  { key: 'ready', label: 'Ready to watch' },
];

function titleLabel(d: DownloadRecord): string {
  const base = d.title ?? d.torrentName;
  if (d.seasonNumber == null) return base;
  const se = `S${String(d.seasonNumber).padStart(2, '0')}${d.episodeNumber != null ? `E${String(d.episodeNumber).padStart(2, '0')}` : ''}`;
  return `${base} · ${se}`;
}

export function DownloadsPage() {
  const downloads = useDownloadsStore((s) => s.downloads);
  const removeLocal = useDownloadsStore((s) => s.removeLocal);
  const toast = useToastStore((s) => s.toast);
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('all');

  const ordered = useMemo(
    () =>
      [...downloads].sort((a, b) => (b.completedAt ?? b.createdAt).localeCompare(a.completedAt ?? a.createdAt)),
    [downloads],
  );

  const visible = ordered.filter((d) => {
    if (tab === 'downloading') return !(d.progress >= 1 || d.state === 'seeding');
    if (tab === 'ready') return d.progress >= 1 || d.state === 'seeding';
    return true;
  });

  const active = ordered.filter((d) => !(d.progress >= 1 || d.state === 'seeding')).length;
  const ready = ordered.length - active;

  async function handleRemove(d: DownloadRecord): Promise<void> {
    const ok = window.confirm(`Remove "${d.torrentName}" and delete its files? This cannot be undone.`);
    if (!ok) return;
    try {
      await removeDownload(d.infoHash, true);
      removeLocal(d.infoHash);
      toast('Removed download', 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Remove failed', 'error');
    }
  }

  async function handlePause(d: DownloadRecord): Promise<void> {
    try {
      await pauseDownload(d.infoHash);
      toast('Paused', 'info');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Pause failed', 'error');
    }
  }

  async function handleResume(d: DownloadRecord): Promise<void> {
    try {
      await resumeDownload(d.infoHash);
      toast('Resumed', 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Resume failed', 'error');
    }
  }

  return (
    <div className="page">
      <h1 className="page-title">Downloads</h1>
      <p className="page-sub">
        {ordered.length === 0
          ? 'Your downloaded titles will appear here.'
          : `${ready} ready to watch · ${active} downloading · ${ordered.length} total`}
      </p>

      <div className="tabbar" role="tablist" aria-label="Filter downloads">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className={`tab ${tab === t.key ? 'active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {ordered.length === 0 ? (
        <EmptyState
          title="Nothing downloaded yet"
          hint="Search for a movie or show, pick the release you want, and it will appear here with live progress — ready to stream before it finishes."
          steps={['1 · Search', '2 · Download', '3 · Watch']}
          icon={<Download size={24} />}
          actionLabel="Browse movies"
          onAction={() => navigate('/')}
        />
      ) : visible.length === 0 ? (
        <p className="empty-state">No downloads match this filter.</p>
      ) : (
        <ul className="downloads-list">
          {visible.map((d) => (
            <li key={d.infoHash} className="download-row">
              {d.backdropPath || d.posterPath ? (
                <img
                  className="download-thumb"
                  src={
                    d.backdropPath
                      ? `/api/images/tmdb/w1280${d.backdropPath}`
                      : `/api/images/tmdb/w500${d.posterPath}`
                  }
                  alt=""
                  loading="lazy"
                />
              ) : (
                <div className="download-thumb skeleton" aria-hidden="true" />
              )}

              <div className="download-info">
                <div>
                  <div className="download-title" title={d.torrentName}>
                    {titleLabel(d)}
                  </div>
                  <div className="download-meta">
                    <DownloadQualityChips
                      resolution={d.resolution}
                      source={d.source}
                      codec={d.codec}
                      hdr={d.hdr}
                      isDolbyVision={d.isDolbyVision}
                    />
                    <StateBadge state={d.state} />
                    <span title={d.torrentName}>{d.torrentName}</span>
                  </div>
                </div>

                <div className="progress-track" aria-label={`${Math.round(d.progress * 100)}%`}>
                  <div className="progress-fill" style={{ width: `${Math.round(d.progress * 100)}%` }} />
                </div>

                <div className="download-actions">
                  <button
                    type="button"
                    className="btn btn-white btn-sm"
                    disabled={!d.streamable}
                    onClick={() => navigate(`/watch/${d.infoHash}`)}
                  >
                    <Play size={15} fill="currentColor" /> Watch
                  </button>
                  {d.state === 'paused' ? (
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => handleResume(d)}>
                      <Play size={14} fill="currentColor" /> Resume
                    </button>
                  ) : d.progress < 1 ? (
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => handlePause(d)}>
                      <Pause size={14} /> Pause
                    </button>
                  ) : null}
                  {d.progress < 1 && (
                    <span className="download-meta" style={{ margin: 0 }}>
                      {humanSpeed(d.downloadSpeed)} · ETA {humanEta(d.etaSeconds)}
                    </span>
                  )}
                  <a className="btn btn-outline btn-sm" href={fileUrl(d.infoHash)} download>
                    <FileDown size={14} /> File
                  </a>
                  <button
                    type="button"
                    className="btn btn-danger-outline btn-sm"
                    onClick={() => handleRemove(d)}
                  >
                    <Trash2 size={14} /> Remove
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
