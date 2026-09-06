interface DownloadQualityChipsProps {
  resolution?: string | null;
  source?: string | null;
  codec?: string | null;
  hdr: boolean;
  isDolbyVision: boolean;
  audioLang?: string | null;
  audioMode?: string | null;
}

export function DownloadQualityChips({
  resolution,
  source,
  codec,
  hdr,
  isDolbyVision,
  audioLang,
  audioMode,
}: DownloadQualityChipsProps) {
  const chips: string[] = [];
  if (audioLang || audioMode) {
    const lang = audioLang ? audioLang.toUpperCase() : null;
    const mode = audioMode
      ? audioMode === 'multi'
        ? 'MULTi'
        : audioMode === 'dual'
          ? 'Dual'
          : 'Dub'
      : null;
    chips.push([lang, mode].filter(Boolean).join(' '));
  }
  if (resolution) chips.push(resolution);
  if (source) chips.push(source);
  if (codec) chips.push(codec);
  if (isDolbyVision) chips.push('DoVi');
  else if (hdr) chips.push('HDR');
  if (chips.length === 0) return null;
  return (
    <>
      {chips.map((text, i) => (
        <span key={`${text}-${i}`} className={`chip ${audioLang || audioMode ? (i === 0 ? 'chip-audio' : '') : ''}`}>
          {text}
        </span>
      ))}
    </>
  );
}
