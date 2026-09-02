import { useParams } from 'react-router-dom';
import { useDownloadsStore } from '../store/downloadsStore';
import { streamUrl, fileUrl } from '../api';

export function WatchPage() {
  const { infoHash = '' } = useParams();
  const downloads = useDownloadsStore((s) => s.downloads);
  const download = downloads.find((d) => d.infoHash === infoHash.toLowerCase());

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

  return (
    <div className="watch-page">
      <video
        className="watch-video"
        src={streamUrl(download.infoHash)}
        controls
        autoPlay
        playsInline
      />
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
        <a className="btn btn-ghost" href={fileUrl(download.infoHash)}>
          Download file
        </a>
      </div>
    </div>
  );
}
