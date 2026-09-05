import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useDownloadsStore } from '../store/downloadsStore';
import { useRecentsStore } from '../store/recentsStore';
import { downloadFiles, fileUrl, playInfo, humanSize } from '../api';
import type { PlayInfo, StreamFileInfo } from '../types';

function externalLink(play: PlayInfo): string {
  const httpUrl = `${window.location.origin}${play.playUrl}`;
  return `movie://${httpUrl}`;
}

function baseName(relative: string): string {
  return relative.split('/').pop() ?? relative;
}

export function WatchPage() {
  const { infoHash = '' } = useParams();
  const downloads = useDownloadsStore((s) => s.downloads);
  const download = downloads.find((d) => d.infoHash === infoHash.toLowerCase());
  const recordRecent = useRecentsStore((s) => s.record);
  const recents = useRecentsStore((s) => s.recents);

  const [play, setPlay] = useState<PlayInfo | null>(null);
  const [files, setFiles] = useState<StreamFileInfo[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'notfound' | 'error'>('loading');

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
      backdropPath: null,
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
    async function load(): Promise<void> {
      try {
        const filesRes = await downloadFiles(infoHash);
        if (cancelled) return;
        setFiles(filesRes.files);
        if (filesRes.files.length <= 1) {
          const info = await playInfo(infoHash);
          if (cancelled) return;
          setPlay(info);
          setState('ok');
        } else {
          setState('ok');
        }
      } catch {
        if (cancelled) return;
        setState('notfound');
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [infoHash]);

  const openFile = useCallback(
    (file: string | null) => {
      let cancelled = false;
      setState('loading');
      setPlay(null);
      setSelectedFile(file);
      playInfo(infoHash, file ?? undefined)
        .then((info) => {
          if (cancelled) return;
          setPlay(info);
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
    [infoHash],
  );

  if (state === 'loading') {
    return (
      <div className="page-state">
        <p>Preparing player…</p>
      </div>
    );
  }

  if (state === 'notfound' || (files.length <= 1 && !play)) {
    return (
      <div className="page-state">
        <p className="empty-state">No playable file yet</p>
        <div className="page-actions">
          <a className="btn" href="/">
            Back
          </a>
        </div>
      </div>
    );
  }

  const incomplete = download != null && download.progress < 1;

  if (files.length > 1 && !play) {
    return (
      <div className="watch-page">
        <div className="episode-picker">
          <h2 className="rail-title">Choose what to play</h2>
          <p className="episode-picker-subtitle">
            This download contains {files.length} video files{files.length > 2 ? ' (e.g. a season pack)' : ''}.
          </p>
          <ul className="episode-list">
            {files.map((file) => (
              <li key={file.relative}>
                <button type="button" className="episode-row" onClick={() => openFile(file.relative)}>
                  <span className="episode-name">{baseName(file.relative)}</span>
                  <span className="episode-size">{humanSize(file.size)}</span>
                  {!file.complete && <span className="episode-incomplete">partial</span>}
                </button>
              </li>
            ))}
          </ul>
          <div className="watch-footer">
            <a className="btn" href="/">
              ← Back
            </a>
          </div>
        </div>
      </div>
    );
  }

  if (!play) {
    return (
      <div className="page-state">
        <p className="empty-state">No playable file yet</p>
        <div className="page-actions">
          <a className="btn" href="/">
            Back
          </a>
        </div>
      </div>
    );
  }

  if (play.mode === 'player-required') {
    return (
      <div className="page-state">
        <p className="empty-state">
          This is a 4K/UHD release that can&apos;t be streamed in the browser. Open it in VLC for
          the best playback.
        </p>
        <div className="page-actions">
          <a className="btn btn-primary" href={externalLink(play)}>
            ▶ Open in VLC
          </a>
          <a className="btn" href={fileUrl(infoHash, selectedFile ?? undefined)}>
            Download file
          </a>
          <a className="btn" href="/">
            Back
          </a>
        </div>
        <p className="hint">First time? Run the one-time VLC setup once (see README).</p>
      </div>
    );
  }

  return (
    <div className="watch-page">
      {files.length > 1 && (
        <div className="watch-file-bar">
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => {
              setPlay(null);
              setSelectedFile(null);
            }}
          >
            ← {files.length} files
          </button>
          <span className="watch-file-name">{selectedFile ? baseName(selectedFile) : ''}</span>
        </div>
      )}
      <video className="watch-video" src={play.streamUrl} controls autoPlay playsInline />
      {incomplete && (
        <div className="watch-overlay">
          <div className="watch-overlay-inner">
            <span className="spinner" aria-hidden="true" />
            <span>Buffering — download in progress ({Math.round(download.progress * 100)}%)</span>
          </div>
        </div>
      )}
      <div className="watch-footer">
        <a className="btn" href="/">
          ← Back
        </a>
        <a className="btn btn-ghost" href={fileUrl(infoHash, selectedFile ?? undefined)}>
          Download file
        </a>
      </div>
    </div>
  );
}
