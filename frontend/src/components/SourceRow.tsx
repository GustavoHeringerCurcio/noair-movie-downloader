import type { Source } from '../types';
import { humanSize } from '../api';

interface SourceRowProps {
  source: Source;
  onDownload: (source: Source) => void;
  disabled?: boolean;
}

export function SourceRow({ source, onDownload, disabled }: SourceRowProps) {
  return (
    <li className="source-row">
      <div className="source-row-main">
        <div className="source-row-title" title={source.title}>
          {source.title}
        </div>
        <div className="source-row-meta">
          <span className="source-indexer">{source.indexer || 'unknown'}</span>
          <span>{humanSize(source.sizeBytes)}</span>
          <span className="source-seeds">
            <span className="seed-icon">▲</span> {source.seeders}
            <span className="leech-icon">▼</span> {source.leechers}
          </span>
        </div>
      </div>
      <button
        type="button"
        className="btn btn-primary"
        onClick={() => onDownload(source)}
        disabled={disabled}
      >
        Download
      </button>
    </li>
  );
}
