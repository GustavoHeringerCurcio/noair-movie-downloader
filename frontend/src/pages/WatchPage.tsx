import { useCallback, useEffect, useRef, useState, type SyntheticEvent as ReactSyntheticEvent } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, FileDown, MonitorPlay, Play, RotateCw } from 'lucide-react';
import { useDownloadsStore } from '../store/downloadsStore';
import { useRecentsStore } from '../store/recentsStore';
import { usePlaybackStore } from '../store/playbackStore';
import {
  clearPackage,
  downloadFiles,
  externalPlayerUrl,
  fileUrl,
  humanSize,
  packageStatus,
  playInfo,
} from '../api';
import type { PlayInfo, StreamFileInfo } from '../types';
import { episodeKeyFromFilename, parseEpisodeToken } from '../lib/episode';
import { ShakaPlayer } from '../components/ShakaPlayer';

function baseName(relative: string): string {
  return relative.split('/').pop() ?? relative;
}

type PackagePhase = 'idle' | 'packaging' | 'ready' | 'failed';

/**
 * Preflight before any HLS packaging starts: if the browser's MSE cannot decode
 * the rendition's video codec (playinfo carries candidate `MediaSource` type
 * strings), skip the package build and go straight to the local-player screen.
 */
function canPlayHlsInBrowser(play: PlayInfo): boolean {
  if (play.mode !== 'hls' || play.mseProbe == null) return true;
  try {
    if (typeof window === 'undefined' || typeof MediaSource === 'undefined') return true;
    return play.mseProbe.some((type) => MediaSource.isTypeSupported(type));
  } catch {
    return true;
  }
}

export function WatchPage() {
  const { infoHash = '' } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const downloads = useDownloadsStore((s) => s.downloads);
  const download = downloads.find((d) => d.infoHash === infoHash.toLowerCase());
  const recordRecent = useRecentsStore((s) => s.record);
  const recents = useRecentsStore((s) => s.recents);
  const getPosition = usePlaybackStore((s) => s.getPosition);
  const setPosition = usePlaybackStore((s) => s.setPosition);
  const clearPosition = usePlaybackStore((s) => s.clearPosition);

  const [play, setPlay] = useState<PlayInfo | null>(null);
  const [files, setFiles] = useState<StreamFileInfo[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'notfound' | 'error'>('loading');
  const [resumeSeconds, setResumeSeconds] = useState<number | null>(null);
  const [startAt, setStartAt] = useState<number | null>(null);
  const [stall, setStall] = useState(false);
  const [pkgPhase, setPkgPhase] = useState<PackagePhase>('idle');
  const [pkgProgress, setPkgProgress] = useState(0);
  const [pkgFailed, setPkgFailed] = useState(false);
  const [pkgError, setPkgError] = useState<string | null>(null);
  const [pkgTick, setPkgTick] = useState(0);
  const [codecUnsupported, setCodecUnsupported] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);
  const lastSave = useRef(0);
  const stallTimer = useRef<number | undefined>(undefined);

  const episodeToken = searchParams.get('episode');
  const requestedFile = searchParams.get('file');
  const episodeKey = episodeToken ? parseEpisodeToken(episodeToken) : null;

  const resolveFile = useCallback(
    (list: StreamFileInfo[]): string | null => {
      if (requestedFile) return list.find((f) => f.relative === requestedFile)?.relative ?? null;
      if (episodeKey) {
        const byTags = list.find(
          (f) => f.seasonNumber === episodeKey.season && f.episodeNumber === episodeKey.episode,
        );
        if (byTags) return byTags.relative;
        const byName = list.find((f) => {
          const key = episodeKeyFromFilename(baseName(f.relative));
          return key?.season === episodeKey.season && key?.episode === episodeKey.episode;
        });
        return byName ? byName.relative : null;
      }
      return null;
    },
    [requestedFile, episodeKey],
  );

  useEffect(() => {
    if (!download || !download.tmdbId || !download.mediaType) return;
    const first = recents[0];
    if (
      first &&
      first.item.tmdbId === download.tmdbId &&
      first.item.mediaType === download.mediaType &&
      Date.now() - first.viewedAt < 5000
    ) {
      return;
    }
    recordRecent({
      tmdbId: download.tmdbId,
      mediaType: download.mediaType,
      title: download.title ?? download.torrentName,
      year: download.year,
      posterPath: download.posterPath,
      backdropPath: download.backdropPath,
      overview: '',
      voteAverage: 0,
    });
  }, [download, recents, recordRecent]);

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    setPlay(null);
    setSelectedFile(null);
    setFiles([]);
    setResumeSeconds(null);
    setStartAt(null);
    setPkgPhase('idle');
    setPkgFailed(false);
    setPkgError(null);
    setPkgProgress(0);
    setCodecUnsupported(false);

    async function load(): Promise<void> {
      try {
        const filesRes = await downloadFiles(infoHash);
        if (cancelled) return;
        setFiles(filesRes.files);

        const target = resolveFile(filesRes.files);
        if (filesRes.files.length > 1 && !target) {
          setState('ok');
          return;
        }

        const info = await playInfo(infoHash, target ?? undefined);
        if (cancelled) return;
        if (target) setSelectedFile(target);
        setPlay(info);
        setCodecUnsupported(!canPlayHlsInBrowser(info));
        const saved = getPosition(infoHash, target ?? null);
        if (saved > 15) setResumeSeconds(saved);
        setState('ok');
      } catch {
        if (cancelled) return;
        setState('notfound');
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [infoHash, episodeKey, requestedFile, resolveFile, getPosition, download?.streamable]);

  const openFile = useCallback(
    (file: string | null) => {
      let cancelled = false;
      setState('loading');
      setPlay(null);
      setSelectedFile(file);
      setResumeSeconds(null);
      setStartAt(null);
      setPkgPhase('idle');
      setPkgFailed(false);
      setPkgError(null);
      setPkgProgress(0);
      setCodecUnsupported(false);
      playInfo(infoHash, file ?? undefined)
        .then((info) => {
          if (cancelled) return;
          setPlay(info);
          setCodecUnsupported(!canPlayHlsInBrowser(info));
          const saved = getPosition(infoHash, file);
          if (saved > 15) setResumeSeconds(saved);
          setState('ok');
        })
        .catch(() => {
          if (cancelled) return;
          setState('notfound');
        });
      return () => {
        cancelled = true;
      };
    },
    [infoHash, getPosition],
  );

  useEffect(() => () => window.clearTimeout(stallTimer.current), []);

  function saveProgress(video: HTMLVideoElement): void {
    const now = Date.now();
    if (now - lastSave.current < 5000) return;
    lastSave.current = now;
    const key = selectedFile;
    setPosition(infoHash, key, video.currentTime);
    if (Number.isFinite(video.duration) && video.duration > 0 && video.duration - video.currentTime < 5) {
      clearPosition(infoHash, key);
    }
    window.clearTimeout(stallTimer.current);
    stallTimer.current = window.setTimeout(() => {
      if (video && !video.paused && video.readyState >= 3) setStall(true);
    }, 20000);
  }

  function onTimeUpdate(e: ReactSyntheticEvent<HTMLVideoElement>): void {
    saveProgress(e.currentTarget);
  }

  function onPlaying(): void {
    setStall(false);
  }

  const isHls = play != null && play.mode === 'hls' && !codecUnsupported;
  const needsPlayer = play != null && (play.mode === 'player-required' || (play.mode === 'hls' && codecUnsupported));

  useEffect(() => {
    if (!isHls) return;
    let cancelled = false;
    let timer: number | undefined;
    setPkgFailed(false);
    setPkgError(null);
    const poll = async (): Promise<void> => {
      try {
        const status = await packageStatus(infoHash, selectedFile ?? undefined);
        if (cancelled) return;
        if (status.phase === 'ready') {
          setPkgPhase('ready');
          setPkgProgress(1);
        } else if (status.phase === 'failed') {
          setPkgPhase('failed');
          setPkgFailed(true);
          setPkgError(status.error);
        } else {
          setPkgPhase('packaging');
          setPkgProgress(status.progress);
          timer = window.setTimeout(poll, 2000);
        }
      } catch {
        if (!cancelled) {
          setPkgPhase('failed');
          setPkgFailed(true);
          setPkgError('Couldn’t check the packaging status. Is the backend still running?');
        }
      }
    };
    void poll();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [isHls, infoHash, selectedFile, pkgTick]);

  function retryHls(): void {
    void clearPackage(infoHash, selectedFile ?? undefined)
      .catch(() => undefined)
      .then(() => setPkgTick((t) => t + 1));
  }

  if (state === 'loading') {
    return (
      <div className="page-state">
        <span className="spinner" aria-hidden="true" />
        <p>Preparing player…</p>
      </div>
    );
  }

  if (state === 'notfound' || (files.length <= 1 && !play)) {
    const waiting = download != null && !download.streamable;
    return (
      <div className="page-state">
        <p className="empty-state">
          {waiting
            ? 'This download isn’t finished yet. It becomes playable here once the file has fully downloaded.'
            : 'No playable file yet.'}
        </p>
        {waiting && (
          <p className="empty-state" style={{ marginTop: 0 }}>
            Progress {Math.round((download?.progress ?? 0) * 100)}%
          </p>
        )}
        <button type="button" className="btn btn-white" onClick={() => navigate(-1)}>
          Back
        </button>
      </div>
    );
  }

  if (files.length > 1 && !play) {
    return (
      <div className="watch-page">
        <div className="watch-topbar">
          <button type="button" className="btn btn-outline btn-sm" onClick={() => navigate(-1)}>
            <ArrowLeft size={16} /> Back
          </button>
          <span className="watch-file-name">This download contains {files.length} videos</span>
        </div>
        <div className="episode-picker">
          <ul className="episode-list">
            {files.map((file) => (
              <li key={file.relative} className="episode-row">
                <button type="button" className="btn btn-white btn-sm" onClick={() => openFile(file.relative)}>
                  <Play size={14} fill="currentColor" /> Play
                </button>
                <span className="er-title" title={file.relative}>
                  {baseName(file.relative)}
                </span>
                <span className="er-duration">
                  {file.seasonNumber != null && file.episodeNumber != null
                    ? `S${String(file.seasonNumber).padStart(2, '0')}E${String(file.episodeNumber).padStart(2, '0')}`
                    : ''}
                  {!file.complete ? ' · partial' : ''}
                </span>
                <span className="er-duration">{humanSize(file.size)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  if (!play) {
    return (
      <div className="page-state">
        <p className="empty-state">No playable file yet.</p>
        <button type="button" className="btn btn-white" onClick={() => navigate(-1)}>
          Back
        </button>
      </div>
    );
  }

  if (needsPlayer) {
    const codecLabel =
      play.mode === 'hls'
        ? [play.video?.codec, play.video?.profile].filter(Boolean).join(' ')
        : null;
    return (
      <div className="page-state">
        <p className="empty-state">
          {codecLabel
            ? `This release uses ${codecLabel} video, which this browser can't decode in a web player.`
            : "This release can't be decoded in the browser."}{' '}
          Play it bit-perfect in your own player (VLC, MPV, …) instead:
        </p>
        <ol className="guide-steps">
          <li className="guide-step">Set up your local player once (Settings → Local player)</li>
          <li className="guide-step">Click “Open in your player”</li>
          <li className="guide-step">Done</li>
        </ol>
        <div className="page-state" style={{ minHeight: 'auto', flexDirection: 'row' }}>
          <a className="btn btn-white" href={externalPlayerUrl(infoHash, selectedFile ?? undefined)}>
            <MonitorPlay size={18} /> Open in your player
          </a>
          <a className="btn btn-outline" href={fileUrl(infoHash, selectedFile ?? undefined)}>
            <FileDown size={18} /> Download file
          </a>
          <button type="button" className="btn btn-ghost" onClick={() => navigate(-1)}>
            Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="watch-page">
      <div className="watch-topbar">
        <div className="watch-title-line">
          <button type="button" className="btn btn-outline btn-sm" onClick={() => navigate(-1)}>
            <ArrowLeft size={16} /> Back
          </button>
          <span className="watch-file-name">{baseName(selectedFile ?? play.streamUrl)}</span>
        </div>
        <div className="watch-topbar-actions">
          <a
            className="btn btn-outline btn-sm"
            href={externalPlayerUrl(infoHash, selectedFile ?? undefined)}
            title="Play this file in your local player (VLC / MPV) — requires one-time setup in Settings"
          >
            <MonitorPlay size={15} /> Player
          </a>
          {files.length > 1 && (
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => {
                setPlay(null);
                setSelectedFile(null);
              }}
            >
              All {files.length} files
            </button>
          )}
        </div>
      </div>

      {resumeSeconds != null && startAt === null && (
        <div className="resume-bar">
          <span>Resume from {Math.floor(resumeSeconds / 60)}:{String(Math.floor(resumeSeconds % 60)).padStart(2, '0')}?</span>
          <button type="button" className="btn btn-white btn-sm" onClick={() => { setStartAt(resumeSeconds); setResumeSeconds(null); }}>
            <Play size={14} fill="currentColor" /> Resume
          </button>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => { setStartAt(0); setResumeSeconds(null); }}>
            Restart
          </button>
        </div>
      )}

      {resumeSeconds == null &&
        (isHls ? (
          pkgPhase === 'ready' && !pkgFailed ? (
            <ShakaPlayer
              key={`${play.manifestUrl ?? 'hls'}::${reloadNonce}`}
              manifestUrl={play.manifestUrl ?? ''}
              resumeAt={startAt}
              onTick={(video) => saveProgress(video)}
              onPlayback={onPlaying}
              onStarted={() => setStartAt(null)}
              onError={(message) => {
                setPkgFailed(true);
                setPkgError(message);
              }}
            />
          ) : pkgPhase === 'failed' || pkgFailed ? (
            <div className="watch-overlay watch-overlay-fail">
              <p className="watch-overlay-msg">Couldn’t prepare a browser-playable copy.</p>
              {pkgError && (
                <p className="watch-overlay-detail" title={pkgError}>
                  {pkgError}
                </p>
              )}
              <div className="watch-overlay-actions">
                <button type="button" className="btn btn-white btn-sm" onClick={retryHls}>
                  <RotateCw size={14} /> Retry
                </button>
                <a className="btn btn-outline btn-sm" href={externalPlayerUrl(infoHash, selectedFile ?? undefined)}>
                  <MonitorPlay size={15} /> Open in your player
                </a>
                <a className="btn btn-outline btn-sm" href={fileUrl(infoHash, selectedFile ?? undefined)}>
                  <FileDown size={15} /> Download file
                </a>
              </div>
            </div>
          ) : (
            <div className="watch-overlay">
              <span className="spinner spinner-sm" aria-hidden="true" />
              <span>
                Preparing a browser-friendly copy… {Math.round(pkgProgress * 100)}% (one-time, then
                cached)
              </span>
            </div>
          )
        ) : (
          <video
            key={reloadNonce}
            className="watch-video"
            src={play.streamUrl}
            controls
            autoPlay
            playsInline
            onLoadedMetadata={(e) => {
              if (startAt != null && startAt > 0) {
                const v = e.currentTarget;
                if (Number.isFinite(v.duration) && startAt < v.duration) v.currentTime = startAt;
              }
              setStartAt(null);
            }}
            onTimeUpdate={onTimeUpdate}
            onPlaying={onPlaying}
          />
        ))}

      {stall && (
        <div className="watch-overlay">
          <span>Stream stalled.</span>
          <button
            type="button"
            className="btn btn-white btn-sm"
            onClick={() => {
              setStall(false);
              setReloadNonce((n) => n + 1);
              if (play) {
                void playInfo(infoHash, selectedFile ?? undefined)
                  .then((p) => setPlay(p))
                  .catch(() => setState('notfound'));
              }
            }}
          >
            <RotateCw size={14} /> Retry stream
          </button>
        </div>
      )}
    </div>
  );
}
