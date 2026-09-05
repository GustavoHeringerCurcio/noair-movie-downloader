interface DownloadQualityChipsProps {
  resolution?: string | null;
  source?: string | null;
  codec?: string | null;
  hdr: boolean;
  isDolbyVision: boolean;
}

function chipClass(kind: string): string {
  return `chip chip-${kind}`;
}

export function DownloadQualityChips({
  resolution,
  source,
  codec,
  hdr,
  isDolbyVision,
}: DownloadQualityChipsProps) {
  const chips: Array<{ text: string; cls: string }> = [];
  if (resolution) chips.push({ text: resolution, cls: 'res' });
  if (source) chips.push({ text: source, cls: 'src' });
  if (codec) chips.push({ text: codec, cls: 'codec' });
  if (isDolbyVision) chips.push({ text: 'DoVi', cls: 'hdr' });
  else if (hdr) chips.push({ text: 'HDR', cls: 'hdr' });
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
