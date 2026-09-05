interface DownloadQualityChipsProps {
  resolution?: string | null;
  source?: string | null;
  codec?: string | null;
  hdr: boolean;
  isDolbyVision: boolean;
}

export function DownloadQualityChips({
  resolution,
  source,
  codec,
  hdr,
  isDolbyVision,
}: DownloadQualityChipsProps) {
  const chips: string[] = [];
  if (resolution) chips.push(resolution);
  if (source) chips.push(source);
  if (codec) chips.push(codec);
  if (isDolbyVision) chips.push('DoVi');
  else if (hdr) chips.push('HDR');
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
