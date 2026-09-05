import { useCallback, useEffect, useRef, useState, type SyntheticEvent as ReactSyntheticEvent } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, FileDown, Play, RotateCw } from 'lucide-react';
import { useDownloadsStore } from '../store/downloadsStore';
import { useRecentsStore } from '../store/recentsStore';
import { usePlaybackStore } from '../store/playbackStore';
import { downloadFiles, fileUrl, humanSize, playInfo } from '../api';
import type { PlayInfo, StreamFileInfo } from '../types';
import { episodeKeyFromFilename, parseEpisodeToken } from '../lib/episode';

function externalLink(play: PlayInfo): string {
  const httpUrl = `${window.location.origin}${play.playUrl}`;
  return `movie://${httpUrl}`;
}

function baseName(relative: string): string {
  return relative.split('/').pop() ?? relative;
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
      art: download.art ?? null,
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
  }, [infoHash, episodeKey, requestedFile, resolveFile, getPosition]);

  const openFile = useCallback(
    (file: string | null) => {
      let cancelled = false;
      setState('loading');
      setPlay(null);
      setSelectedFile(file);
      setResumeSeconds(null);
      setStartAt(null);
      playInfo(infoHash, file ?? undefined)
        .then((info) => {
          if (cancelled) return;
          setPlay(info);
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

  const incomplete = download != null && download.progress < 1;

  function onTimeUpdate(e: ReactSyntheticEvent<HTMLVideoElement>): void {
    const video = e.currentTarget;
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

  function onPlaying(): void {
    setStall(false);
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
    return (
      <div className="page-state">
        <p className="empty-state">No playable file yet.</p>
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

  if (play.mode === 'player-required') {
    return (
      <div className="page-state">
        <p className="empty-state">
          This is a 4K/UHD release that can’t be streamed in the browser. Open it in VLC:
        </p>
        <ol className="guide-steps">
          <li className="guide-step">Install VLC once</li>
          <li className="guide-step">Click “Open in VLC”</li>
          <li className="guide-step">Done</li>
        </ol>
        <div className="page-state" style={{ minHeight: 'auto', flexDirection: 'row' }}>
          <a className="btn btn-white" href={externalLink(play)}>
            <Play size={18} fill="currentColor" /> Open in VLC
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

      {resumeSeconds == null && (
        <video
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
      )}

      {incomplete && (
        <div className="watch-overlay">
          <span className="spinner spinner-sm" aria-hidden="true" />
          <span>
            Streaming while downloading — {Math.round(download.progress * 100)}%
          </span>
        </div>
      )}
      {stall && (
        <div className="watch-overlay">
          <span>Stream stalled.</span>
          <button
            type="button"
            className="btn btn-white btn-sm"
            onClick={() => {
              setStall(false);
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
