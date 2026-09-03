import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useDownloadsStore } from '../store/downloadsStore';
import { useRecentsStore } from '../store/recentsStore';
import { fileUrl, playInfo } from '../api';
import type { PlayInfo } from '../types';

function externalLink(play: PlayInfo): string {
  const httpUrl = `${window.location.origin}${play.playUrl}`;
  return `movie://${httpUrl}`;
}

export function WatchPage() {
  const { infoHash = '' } = useParams();
  const downloads = useDownloadsStore((s) => s.downloads);
  const download = downloads.find((d) => d.infoHash === infoHash.toLowerCase());
  const recordRecent = useRecentsStore((s) => s.record);
  const recents = useRecentsStore((s) => s.recents);

  const [play, setPlay] = useState<PlayInfo | null>(null);
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
    playInfo(infoHash)
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
  }, [infoHash]);

  if (state === 'loading') {
    return (
      <div className="page-state">
        <p>Preparing player…</p>
      </div>
    );
  }

  if (state === 'notfound' || !play) {
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
          <a className="btn" href={fileUrl(infoHash)}>
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
        <a className="btn btn-ghost" href={fileUrl(infoHash)}>
          Download file
        </a>
      </div>
    </div>
  );
}
