import type { Source, SourceFilters, SourceGroup, SourceSortKey } from '../types';

const RESOLUTION_ORDER: Record<string, number> = { '2160p': 0, '1080p': 1, '720p': 2, '480p': 3 };

function emptyFilters(): SourceFilters {
  return {
    indexers: [],
    resolutions: [],
    sources: [],
    codecs: [],
    minSeeders: null,
    minSizeGB: null,
    maxSizeGB: null,
    regex: '',
  };
}

function matchesRegex(source: Source, pattern: string): boolean {
  const trimmed = pattern.trim();
  if (!trimmed) return true;
  try {
    return new RegExp(trimmed, 'i').test(source.title);
  } catch {
    return true;
  }
}

export function filterSources(sources: Source[], filters: Partial<SourceFilters>): Source[] {
  const f = { ...emptyFilters(), ...filters };
  return sources.filter((s) => {
    if (f.indexers.length > 0 && !f.indexers.includes(s.indexer)) return false;
    if (f.resolutions.length > 0 && !f.resolutions.includes(s.resolution ?? '')) return false;
    if (f.sources.length > 0 && !f.sources.includes(s.source ?? '')) return false;
    if (f.codecs.length > 0 && !f.codecs.includes(s.codec ?? '')) return false;
    if (f.minSeeders != null && s.seeders < f.minSeeders) return false;
    if (f.minSizeGB != null && s.sizeBytes < f.minSizeGB * 1024 ** 3) return false;
    if (f.maxSizeGB != null && s.sizeBytes > f.maxSizeGB * 1024 ** 3) return false;
    return matchesRegex(s, f.regex);
  });
}

export function sortSources(sources: Source[], key: SourceSortKey): Source[] {
  const arr = [...sources];
  switch (key) {
    case 'size':
      return arr.sort((a, b) => b.sizeBytes - a.sizeBytes);
    case 'age':
      return arr.sort((a, b) => (a.ageHours ?? Infinity) - (b.ageHours ?? Infinity));
    case 'resolution':
      return arr.sort(
        (a, b) =>
          (RESOLUTION_ORDER[b.resolution ?? ''] ?? 99) - (RESOLUTION_ORDER[a.resolution ?? ''] ?? 99) ||
          b.seeders - a.seeders,
      );
    case 'sizePerSeeder':
      return arr.sort((a, b) => {
        const aRatio = a.seeders > 0 ? a.sizeBytes / a.seeders : Infinity;
        const bRatio = b.seeders > 0 ? b.sizeBytes / b.seeders : Infinity;
        return aRatio - bRatio;
      });
    case 'seeders':
    default:
      return arr.sort((a, b) => b.seeders - a.seeders);
  }
}

export function groupKey(source: Source): string {
  const hdr = source.hdr ? 'hdr' : 'sdr';
  return `${source.cleanTitle}|${source.resolution ?? '?'}|${source.source ?? '?'}|${source.codec ?? '?'}|${hdr}`;
}

export function groupSources(sources: Source[]): SourceGroup[] {
  const map = new Map<string, SourceGroup>();
  for (const source of sources) {
    const key = groupKey(source);
    let group = map.get(key);
    if (!group) {
      group = {
        key,
        cleanTitle: source.cleanTitle,
        resolution: source.resolution,
        source: source.source,
        codec: source.codec,
        hdr: source.hdr,
        isDolbyVision: source.isDolbyVision,
        variants: [],
        best: source,
      };
      map.set(key, group);
    }
    group.variants.push(source);
    group.best = group.variants.reduce((best, s) => (s.seeders > best.seeders ? s : best), group.best);
  }
  return [...map.values()].sort((a, b) => b.best.seeders - a.best.seeders);
}

export function activeFilterCount(filters: Partial<SourceFilters>): number {
  const f = { ...emptyFilters(), ...filters };
  return (
    f.indexers.length +
    f.resolutions.length +
    f.sources.length +
    f.codecs.length +
    (f.minSeeders != null ? 1 : 0) +
    (f.minSizeGB != null ? 1 : 0) +
    (f.maxSizeGB != null ? 1 : 0) +
    (f.regex.trim() ? 1 : 0)
  );
}
