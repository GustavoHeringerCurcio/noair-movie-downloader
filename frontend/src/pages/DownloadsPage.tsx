import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Play, Pause, Trash2, FileDown, Download, MonitorPlay } from 'lucide-react';
import { useDownloadsStore } from '../store/downloadsStore';
import { useToastStore } from '../store/toastStore';
import {
  removeDownload,
  pauseDownload,
  resumeDownload,
  optimizeDownload,
  externalPlayerUrl,
  fileUrl,
  posterUrl,
  humanSpeed,
  humanEta,
} from '../api';
import { StateBadge } from '../components/StateBadge';
import { DownloadQualityChips } from '../components/DownloadQualityChips';
import { EmptyState } from '../components/EmptyState';
import { ExternalPlayerLink } from '../components/ExternalPlayerLink';
import { movieGroupKey, versionLabel } from '../lib/versions';
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

/** Key of a standalone title (movie; TV stays one row per season/episode). */
function movieTitleKey(d: DownloadRecord): string | null {
  return movieGroupKey(d);
}

/**
 * 2:3 poster thumb for a download row. Art comes from the TMDB poster path via
 * the key-less S8 proxy (single TMDB key app-wide); a row with no poster art
 * (or one whose image fails to load) degrades to a letter monogram — never a
 * broken `<img>` or an endless skeleton.
 */
function DownloadThumb({ d }: { d: DownloadRecord }): JSX.Element {
  const src = d.posterPath ? posterUrl(d.posterPath, 'w500') : null;
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [src]);
  const initial = (d.title ?? d.torrentName ?? '?').trim().charAt(0).toUpperCase() || '?';
  if (!src || failed) {
    return (
      <div className="download-thumb mono" title={d.title ?? d.torrentName} aria-hidden="true">
        {initial}
      </div>
    );
  }
  return <img className="download-thumb" src={src} alt="" loading="lazy" onError={() => setFailed(true)} />;
}

interface GroupHead {
  kind: 'head';
  key: string;
  label: string;
  count: number;
}
interface GroupRow {
  kind: 'row';
  d: DownloadRecord;
  /** True when this row is one of several copies of the same movie title. */
  grouped: boolean;
}
type ListEntry = GroupHead | GroupRow;

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

  const entries = useMemo<ListEntry[]>(() => {
    const versionCounts = new Map<string, number>();
    for (const d of visible) {
      const k = movieTitleKey(d);
      if (k) versionCounts.set(k, (versionCounts.get(k) ?? 0) + 1);
    }
    const seen = new Set<string>();
    const out: ListEntry[] = [];
    for (const d of visible) {
      const k = movieTitleKey(d);
      const multi = k ? (versionCounts.get(k) ?? 0) > 1 : false;
      if (k && multi && !seen.has(k)) {
        seen.add(k);
        out.push({
          kind: 'head',
          key: k,
          label: d.title ?? d.torrentName,
          count: versionCounts.get(k) ?? 0,
        });
      }
      out.push({ kind: 'row', d, grouped: multi });
    }
    return out;
  }, [visible]);

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

  async function handleOptimize(d: DownloadRecord): Promise<void> {
    try {
      const result = await optimizeDownload(d.infoHash);
      if (result.status === 'started') toast('Optimizing — you can keep browsing.', 'info');
      else toast('Browser copy ready or already on the way.', 'info');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Optimize failed', 'error');
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
          hint="Search for a movie or show and start a download — it becomes watchable here once the file has fully downloaded."
          steps={['1 · Search', '2 · Download', '3 · Watch']}
          icon={<Download size={22} />}
          actionLabel="Browse movies"
          onAction={() => navigate('/')}
          compact
        />
      ) : visible.length === 0 ? (
        <p className="empty-state">No downloads match this filter.</p>
      ) : (
        <ul className="downloads-list">
          {entries.map((entry) => {
            if (entry.kind === 'head') {
              return (
                <li key={entry.key} className="download-grouphead">
                  <span className="download-group-title">{entry.label}</span>
                  <span className="download-group-count">{entry.count} versions</span>
                </li>
              );
            }
            const d = entry.d;
            return (
              <li key={d.infoHash} className="download-row">
                <DownloadThumb d={d} />

              <div className="download-info">
                <div>
                  <div className="download-title" title={d.torrentName}>
                    {entry.grouped ? versionLabel(d) : titleLabel(d)}
                  </div>
                  <div className="download-meta">
                    <DownloadQualityChips
                      resolution={d.resolution}
                      source={d.source}
                      codec={d.codec}
                      hdr={d.hdr}
                      isDolbyVision={d.isDolbyVision}
                      audioLang={d.audioLang ?? null}
                      audioMode={d.audioMode ?? null}
                    />
                    {d.optimize != null && d.optimize.status !== 'ready' && (
                      <span className="download-meta" style={{ margin: 0 }}>
                        {d.optimize.status === 'converting'
                          ? `Optimizing for instant playback… ${Math.round(d.optimize.progress * 100)}%${
                              d.optimize.etaSeconds != null ? ` (~${humanEta(d.optimize.etaSeconds)} left)` : ''
                            }`
                          : 'Optimization failed — retry below.'}
                      </span>
                    )}
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
                  {d.streamable && (
                    <ExternalPlayerLink
                      className="btn btn-outline btn-sm"
                      href={externalPlayerUrl(d.infoHash)}
                      title="Open in your local player (VLC / MPV, …)"
                    >
                      <MonitorPlay size={14} /> Player
                    </ExternalPlayerLink>
                  )}
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
                  {d.progress >= 1 && d.mediaType === 'movie' && d.optimize == null && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => handleOptimize(d)}
                      title="Build a browser-playable copy in the background for instant Watch"
                    >
                      Optimize
                    </button>
                  )}
                  {d.optimize?.status === 'failed' && (
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => handleOptimize(d)}>
                      Retry optimize
                    </button>
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
            );
          })}
        </ul>
      )}
    </div>
  );
}
