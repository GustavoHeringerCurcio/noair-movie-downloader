import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useDownloadsStore } from '../store/downloadsStore';
import { useToastStore } from '../store/toastStore';
import { compatStreamUrl, fileUrl, streamUrl } from '../api';

type PlayMode = 'native' | 'compat';

const UNSUPPORTED_AUDIO_RE = /(ddp|eac3|ac3|dts|truehd|atmos|dd ?5 ?1|dd ?plus)/i;

export function WatchPage() {
  const { infoHash = '' } = useParams();
  const downloads = useDownloadsStore((s) => s.downloads);
  const toast = useToastStore((s) => s.toast);
  const download = downloads.find((d) => d.infoHash === infoHash.toLowerCase());
  const [mode, setMode] = useState<PlayMode>('native');

  if (!download) {
    return (
      <div className="page-state">
        <p>Unknown download</p>
        <a className="btn" href="/">
          Back
        </a>
      </div>
    );
  }

  if (!download.streamable) {
    return (
      <div className="page-state">
        <p className="empty-state">No playable file yet</p>
        <div className="page-actions">
          <a className="btn btn-primary" href={fileUrl(download.infoHash)}>
            Download file
          </a>
          <a className="btn" href="/">
            Back
          </a>
        </div>
      </div>
    );
  }

  const incomplete = download.progress < 1;
  const src = mode === 'compat' ? compatStreamUrl(download.infoHash) : streamUrl(download.infoHash);
  const likelyUnsupportedAudio = UNSUPPORTED_AUDIO_RE.test(download.torrentName ?? '');
  const likelyHevc = /(x265|hevc|h ?265|10bit)/i.test(download.torrentName ?? '');
  const streamHash = download.infoHash;

  async function copyExternalUrl(): Promise<void> {
    const url = `${window.location.origin}${streamUrl(streamHash)}`;
    try {
      await navigator.clipboard.writeText(url);
      toast('Stream URL copied — open it in VLC / MPC-HC (Media → Open network stream)', 'success');
    } catch {
      window.prompt('Open this URL in your player (VLC / MPC-HC → Open network stream):', url);
    }
  }

  return (
    <div className="watch-page">
      <video key={src} className="watch-video" src={src} controls autoPlay playsInline />

      {mode === 'compat' && (
        <div className="watch-note">
          Compatible audio stream — audio is re-encoded to AAC on the fly. Seeking is disabled.
        </div>
      )}
      {mode === 'native' && (likelyUnsupportedAudio || likelyHevc) && (
        <div className="watch-note watch-note-warn">
          {likelyUnsupportedAudio && (
            <>
              This release&apos;s audio (
              {download.torrentName.match(UNSUPPORTED_AUDIO_RE)?.[0]}) usually isn&apos;t supported by
              browsers — no sound is expected. Use <strong>Compatible audio</strong> below for sound (no
              seeking).
            </>
          )}
          {likelyHevc && (
            <>
              {' '}
              This is an HEVC/x265 encode — Chrome can&apos;t decode it (no picture). Use{' '}
              <strong>Open in external player</strong> or Edge/Safari.
            </>
          )}
        </div>
      )}
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
        <button
          type="button"
          className="btn"
          onClick={() => setMode((m) => (m === 'compat' ? 'native' : 'compat'))}
          aria-pressed={mode === 'compat'}
        >
          {mode === 'compat' ? '↩ Original stream (seekable)' : '🔊 Compatible audio (fix sound)'}
        </button>
        <button type="button" className="btn" onClick={() => void copyExternalUrl()}>
          ↗ Open in external player
        </button>
        <a className="btn btn-ghost" href={fileUrl(download.infoHash)}>
          Download file
        </a>
      </div>
    </div>
  );
}
