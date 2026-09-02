import { useState } from 'react';
import type { Source } from '../types';
import { humanSize } from '../api';

interface SourceRowProps {
  source: Source;
  variants?: Source[];
  onDownload: (source: Source) => void;
  disabled?: boolean;
}

function chipClass(kind: string): string {
  return `chip chip-${kind}`;
}

function QualityChips({ source }: { source: Source }) {
  const chips: Array<{ text: string; cls: string }> = [];
  if (source.resolution) chips.push({ text: source.resolution, cls: 'res' });
  if (source.source) chips.push({ text: source.source, cls: 'src' });
  if (source.codec) chips.push({ text: source.codec, cls: 'codec' });
  if (source.isDolbyVision) chips.push({ text: 'DoVi', cls: 'hdr' });
  else if (source.hdr) chips.push({ text: 'HDR', cls: 'hdr' });
  if (chips.length === 0) return null;
  return (
    <span className="source-chips">
      {chips.map((c) => (
        <span key={c.text} className={chipClass(c.cls)}>
          {c.text}
        </span>
      ))}
    </span>
  );
}

export function SourceRow({ source, variants, onDownload, disabled }: SourceRowProps) {
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
        <QualityChips source={selected} />
        <div className="source-row-meta">
          {multi ? (
            <select
              className="indexer-select"
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
            <span className="source-indexer">{selected.indexer || 'unknown'}</span>
          )}
          <span>{humanSize(selected.sizeBytes)}</span>
          <span className="source-seeds">
            <span className="seed-icon">▲</span> {selected.seeders}
            <span className="leech-icon">▼</span> {selected.leechers}
          </span>
          {selected.group && <span className="source-group">{selected.group}</span>}
        </div>
      </div>
      <button
        type="button"
        className="btn btn-primary"
        onClick={() => onDownload(selected)}
        disabled={disabled}
      >
        Download
      </button>
    </li>
  );
}
