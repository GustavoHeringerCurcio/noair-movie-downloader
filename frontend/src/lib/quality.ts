import type { MaxResolution } from '../types';

export interface MaxResolutionOption {
  value: MaxResolution;
  label: string;
  hint: string;
}

/** Ceilings offered in Settings → Download quality. `2160p` = no ceiling. */
export const MAX_RESOLUTION_OPTIONS: readonly MaxResolutionOption[] = [
  {
    value: '720p',
    label: '720p',
    hint: 'Smallest files — for slow links or limited storage.',
  },
  {
    value: '1080p',
    label: '1080p',
    hint: 'Default — the sweet spot for streaming on any screen.',
  },
  {
    value: '2160p',
    label: '4K UHD',
    hint: 'Show every release, including very large 4K files.',
  },
];

const VALID: ReadonlySet<string> = new Set(['2160p', '1080p', '720p']);

export function isMaxResolution(value: unknown): value is MaxResolution {
  return typeof value === 'string' && VALID.has(value);
}

export function maxResolutionLabel(value: MaxResolution): string {
  return MAX_RESOLUTION_OPTIONS.find((o) => o.value === value)?.label ?? value;
}
