import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Play, Pause, Trash2, FileDown, MonitorPlay } from 'lucide-react';
import {
  externalPlayerUrl,
  fileUrl,
  humanEta,
  humanSpeed,
  optimizeDownload,
  pauseDownload,
  posterUrl,
  removeDownload,
  resumeDownload,
} from '../api';
import { useDownloadsStore } from '../store/downloadsStore';
import { useToastStore } from '../store/toastStore';
import { StateBadge } from './StateBadge';
import { DownloadQualityChips } from './DownloadQualityChips';
import { ExternalPlayerLink } from './ExternalPlayerLink';
import type { DownloadRecord } from '../types';

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

/**
 * One full download row — poster thumb, quality chips, live progress bar,
 * speed/ETA while arriving, and every control (Watch, Player, Pause/Resume,
 * Optimize, File, Remove). Shared by the Downloads page and the per-title
 * "Downloads" section on a media detail page so both surfaces behave the same.
 */
export function DownloadListItem({ d, label }: { d: DownloadRecord; label: string }): JSX.Element {
  const navigate = useNavigate();
  const removeLocal = useDownloadsStore((s) => s.removeLocal);
  const toast = useToastStore((s) => s.toast);

  async function handleRemove(): Promise<void> {
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

  async function handlePause(): Promise<void> {
    try {
      await pauseDownload(d.infoHash);
      toast('Paused', 'info');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Pause failed', 'error');
    }
  }

  async function handleResume(): Promise<void> {
    try {
      await resumeDownload(d.infoHash);
      toast('Resumed', 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Resume failed', 'error');
    }
  }

  async function handleOptimize(): Promise<void> {
    try {
      const result = await optimizeDownload(d.infoHash);
      if (result.status === 'started') toast('Optimizing — you can keep browsing.', 'info');
      else toast('Browser copy ready or already on the way.', 'info');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Optimize failed', 'error');
    }
  }

  return (
    <li className="download-row">
      <DownloadThumb d={d} />
      <div className="download-info">
        <div>
          <div className="download-title" title={d.torrentName}>
            {label}
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
            <button type="button" className="btn btn-outline btn-sm" onClick={() => void handleResume()}>
              <Play size={14} fill="currentColor" /> Resume
            </button>
          ) : d.progress < 1 ? (
            <button type="button" className="btn btn-outline btn-sm" onClick={() => void handlePause()}>
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
              onClick={() => void handleOptimize()}
              title="Build a browser-playable copy in the background for instant Watch"
            >
              Optimize
            </button>
          )}
          {d.optimize?.status === 'failed' && (
            <button type="button" className="btn btn-outline btn-sm" onClick={() => void handleOptimize()}>
              Retry optimize
            </button>
          )}
          <a className="btn btn-outline btn-sm" href={fileUrl(d.infoHash)} download>
            <FileDown size={14} /> File
          </a>
          <button type="button" className="btn btn-danger-outline btn-sm" onClick={() => void handleRemove()}>
            <Trash2 size={14} /> Remove
          </button>
        </div>
      </div>
    </li>
  );
}
