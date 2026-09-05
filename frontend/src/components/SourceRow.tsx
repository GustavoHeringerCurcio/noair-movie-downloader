import { useState } from 'react';
import type { Source } from '../types';
import { humanSize } from '../api';

interface SourceRowProps {
  source: Source;
  variants?: Source[];
  onDownload: (source: Source) => void;
  disabled?: boolean;
  disabledLabel?: string;
}

function QualityChips({ source }: { source: Source }) {
  const chips: string[] = [];
  if (source.resolution) chips.push(source.resolution);
  if (source.source) chips.push(source.source);
  if (source.codec) chips.push(source.codec);
  if (source.isDolbyVision) chips.push('DoVi');
  else if (source.hdr) chips.push('HDR');
  if (chips.length === 0) return null;
  return (
    <>
      {chips.map((text) => (
        <span key={text} className="chip">
          {text}
        </span>
      ))}
    </>
  );
}

export function SourceRow({ source, variants, onDownload, disabled, disabledLabel }: SourceRowProps) {
  const [selectedIndexer, setSelectedIndexer] = useState<string | null>(null);
  const multi = variants && variants.length > 1;
  const selected = multi
    ? (variants!.find((v) => v.indexer === selectedIndexer) ?? source)
    : source;

  return (
    <li className="source-row">
      <div className="source-row-main">
        <div className="source-row-title" title={selected.title}>
          {selected.title}
        </div>
        <div className="source-row-meta">
          <QualityChips source={selected} />
          {multi ? (
            <select
              className="sort-select"
              value={selected.indexer}
              onChange={(e) => setSelectedIndexer(e.target.value)}
              aria-label="Choose indexer"
            >
              {variants!.map((v) => (
                <option key={v.infoHash} value={v.indexer}>
                  {v.indexer} · {humanSize(v.sizeBytes)} · {v.seeders} seeds
                </option>
              ))}
            </select>
          ) : (
            <span>{selected.indexer || 'unknown'}</span>
          )}
          <span>{humanSize(selected.sizeBytes)}</span>
          <span>
            <span className="seed-up">▲ {selected.seeders}</span>
            <span className="leech-dn"> ▼ {selected.leechers}</span>
          </span>
          {selected.ageHours != null && <span>{Math.max(1, Math.round(selected.ageHours / 24))}d</span>}
        </div>
      </div>
      <button
        type="button"
        className="btn btn-outline btn-sm"
        onClick={() => onDownload(selected)}
        disabled={disabled}
        title={disabled && disabledLabel ? disabledLabel : undefined}
      >
        {disabled && disabledLabel ? disabledLabel : 'Download'}
      </button>
    </li>
  );
}
