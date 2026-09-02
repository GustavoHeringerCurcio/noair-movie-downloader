import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { MediaDetail, MediaType, Source, SourceFilters, SourceGroup, SourceSortKey } from '../types';
import { backdropUrl, createDownload, mediaDetails, sources } from '../api';
import { SourceRow } from '../components/SourceRow';
import { Spinner } from '../components/Spinner';
import { activeFilterCount, filterSources, groupSources, sortSources } from '../lib/release';
import { useDownloadsStore } from '../store/downloadsStore';
import { useToastStore } from '../store/toastStore';
import { useUiStore } from '../store/uiStore';

const PAGE_SIZE = 30;

const RESOLUTIONS = ['2160p', '1080p', '720p', '480p'];
const SOURCES = ['REMUX', 'BluRay', 'WEB-DL', 'WEBRip', 'BDRip', 'BRRip', 'HDTV', 'DVDRip'];
const CODECS = ['x264', 'x265', 'AV1', 'XviD', 'DivX'];

const emptyFilters: SourceFilters = {
  indexers: [],
  resolutions: [],
  sources: [],
  codecs: [],
  minSeeders: null,
  minSizeGB: null,
  maxSizeGB: null,
  regex: '',
};

function toggleValue(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

function parseNum(value: string): number | null {
  if (value === '' || value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function DetailPage() {
  const { id: idParam } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const id = parseInt(idParam ?? '', 10);
  const mediaType: MediaType = searchParams.get('type') === 'tv' ? 'tv' : 'movie';

  const [detail, setDetail] = useState<MediaDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [allSources, setAllSources] = useState<Source[]>([]);
  const [sourcesUnreachable, setSourcesUnreachable] = useState(false);
  const [sourcesAuthError, setSourcesAuthError] = useState(false);
  const [loadingSources, setLoadingSources] = useState(false);
  const [filters, setFilters] = useState<SourceFilters>(emptyFilters);
  const [sortKey, setSortKey] = useState<SourceSortKey>('seeders');
  const [showDuplicates, setShowDuplicates] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const downloads = useDownloadsStore((s) => s.downloads);
  const toast = useToastStore((s) => s.toast);
  const setPanelOpen = useUiStore((s) => s.setPanelOpen);

  useEffect(() => {
    if (!Number.isFinite(id) || id <= 0) {
      setDetailError('Invalid media id');
      return;
    }
    let cancelled = false;
    setDetailError(null);
    setDetail(null);
    setAllSources([]);
    setSourcesUnreachable(false);
    setSourcesAuthError(false);
    setFilters(emptyFilters);
    setVisibleCount(PAGE_SIZE);

    async function load(): Promise<void> {
      try {
        const media = await mediaDetails(id, mediaType);
        if (cancelled) return;
        setDetail(media);
      } catch (e) {
        if (cancelled) return;
        setDetailError(e instanceof Error ? e.message : 'Failed to load details');
        return;
      }
      setLoadingSources(true);
      try {
        const res = await sources(id, mediaType);
        if (cancelled) return;
        setAllSources(res.sources);
        setSourcesUnreachable(res.unreachable === true);
        setSourcesAuthError(res.authError === true);
      } catch {
        if (cancelled) return;
        setAllSources([]);
        setSourcesUnreachable(true);
      } finally {
        if (!cancelled) setLoadingSources(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [id, mediaType]);

  const activeDownload = useMemo(
    () => downloads.find((d) => d.tmdbId === id && d.mediaType === mediaType),
    [downloads, id, mediaType],
  );

  const indexers = useMemo(
    () => [...new Set(allSources.map((s) => s.indexer).filter(Boolean))].sort(),
    [allSources],
  );

  const regexInvalid = useMemo(() => {
    const t = filters.regex.trim();
    if (!t) return false;
    try {
      new RegExp(t, 'i');
      return false;
    } catch {
      return true;
    }
  }, [filters.regex]);

  const filteredRaw = useMemo(() => filterSources(allSources, filters), [allSources, filters]);
  const sortedRaw = useMemo(() => sortSources(filteredRaw, sortKey), [filteredRaw, sortKey]);
  const grouped = useMemo(
    () => (showDuplicates ? null : groupSources(sortedRaw)),
    [sortedRaw, showDuplicates],
  );
  const total = grouped ? grouped.length : sortedRaw.length;
  const visible: Array<Source | SourceGroup> = (grouped ?? sortedRaw).slice(0, visibleCount);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [filters, sortKey, showDuplicates]);

  function patchFilters(patch: Partial<SourceFilters>): void {
    setFilters((prev) => ({ ...prev, ...patch }));
  }

  function resetFilters(): void {
    setFilters(emptyFilters);
  }

  async function handleDownload(source: Source): Promise<void> {
    if (!detail) return;
    try {
      await createDownload({
        tmdbId: detail.tmdbId,
        mediaType: detail.mediaType,
        title: detail.title,
        year: detail.year,
        posterPath: detail.posterPath,
        infoHash: source.infoHash,
        magnetUri: source.magnetUri,
        torrentName: source.title,
        indexer: source.indexer,
      });
      toast('Added to downloads', 'success');
      setPanelOpen(true);
    } catch (e) {
      if (e instanceof Error && (e as Error & { status?: number }).status === 409) {
        toast('Already downloading', 'error');
      } else {
        toast(e instanceof Error ? e.message : 'Download failed', 'error');
      }
    }
  }

  const backdrop = backdropUrl(detail?.backdropPath ?? null);
  const filterCount = activeFilterCount(filters);

  if (detailError) {
    return (
      <div className="page-state">
        <Spinner label="Loading…" />
        <p className="inline-error">{detailError}</p>
        <button type="button" className="btn" onClick={() => navigate('/')}>
          Back to search
        </button>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="page-state">
        <Spinner label="Loading…" />
      </div>
    );
  }

  return (
    <div className="detail-page">
      <section className="hero">
        {backdrop && <img className="hero-backdrop" src={backdrop} alt="" />}
        <div className="hero-shade" />
        <div className="hero-content">
          <h1 className="hero-title">{detail.title}</h1>
          <div className="hero-meta">
            <span>{detail.year ?? '—'}</span>
            <span>{detail.genres.join(' · ')}</span>
            {detail.runtime != null && <span>{detail.runtime} min</span>}
            <span className="hero-rating">★ {detail.voteAverage.toFixed(1)}</span>
          </div>
          <p className="hero-overview">{detail.overview}</p>
          {activeDownload && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => navigate(`/watch/${activeDownload.infoHash}`)}
            >
              ▶ Watch
            </button>
          )}
        </div>
      </section>

      <section className="sources-section">
        <div className="sources-head">
          <h2>Sources</h2>
          <div className="sources-count">
            {sortedRaw.length} results · {total} shown
            {!showDuplicates && grouped && grouped.length < sortedRaw.length
              ? ` (${sortedRaw.length - grouped.length} duplicates grouped)`
              : ''}
          </div>
        </div>

        <div className="filter-bar">
          <div className="filter-group">
            <span className="filter-label">Resolution</span>
            <div className="filter-options">
              {RESOLUTIONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  className={`filter-chip ${filters.resolutions.includes(r) ? 'active' : ''}`}
                  onClick={() => patchFilters({ resolutions: toggleValue(filters.resolutions, r) })}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          <div className="filter-group">
            <span className="filter-label">Source</span>
            <div className="filter-options">
              {SOURCES.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`filter-chip ${filters.sources.includes(s) ? 'active' : ''}`}
                  onClick={() => patchFilters({ sources: toggleValue(filters.sources, s) })}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          <div className="filter-group">
            <span className="filter-label">Codec</span>
            <div className="filter-options">
              {CODECS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`filter-chip ${filters.codecs.includes(c) ? 'active' : ''}`}
                  onClick={() => patchFilters({ codecs: toggleValue(filters.codecs, c) })}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          {indexers.length > 0 && (
            <div className="filter-group">
              <span className="filter-label">Indexer</span>
              <div className="filter-options">
                {indexers.map((i) => (
                  <button
                    key={i}
                    type="button"
                    className={`filter-chip ${filters.indexers.includes(i) ? 'active' : ''}`}
                    onClick={() => patchFilters({ indexers: toggleValue(filters.indexers, i) })}
                  >
                    {i}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="filter-group">
            <span className="filter-label">Min seeders</span>
            <input
              className="filter-input-num"
              type="number"
              min={0}
              placeholder="0"
              value={filters.minSeeders ?? ''}
              onChange={(e) => patchFilters({ minSeeders: parseNum(e.target.value) })}
              aria-label="Minimum seeders"
            />
          </div>

          <div className="filter-group">
            <span className="filter-label">Size (GB)</span>
            <div className="filter-range">
              <input
                className="filter-input-num"
                type="number"
                min={0}
                placeholder="min"
                value={filters.minSizeGB ?? ''}
                onChange={(e) => patchFilters({ minSizeGB: parseNum(e.target.value) })}
                aria-label="Minimum size in GB"
              />
              <span>–</span>
              <input
                className="filter-input-num"
                type="number"
                min={0}
                placeholder="max"
                value={filters.maxSizeGB ?? ''}
                onChange={(e) => patchFilters({ maxSizeGB: parseNum(e.target.value) })}
                aria-label="Maximum size in GB"
              />
            </div>
          </div>

          <div className="filter-group filter-row-actions">
            <label className="filter-toggle">
              <input
                type="checkbox"
                checked={showDuplicates}
                onChange={(e) => setShowDuplicates(e.target.checked)}
              />
              Show duplicates
            </label>
            <select
              className="sort-select"
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SourceSortKey)}
              aria-label="Sort sources"
            >
              <option value="seeders">Sort: seeders</option>
              <option value="size">Sort: size</option>
              <option value="age">Sort: age</option>
              <option value="resolution">Sort: resolution</option>
              <option value="sizePerSeeder">Sort: size/seeder</option>
            </select>
          </div>

          <div className="filter-group">
            <span className="filter-label">Advanced regex</span>
            <input
              className="filter-input-regex"
              type="text"
              placeholder='e.g. "1080p|x265" or "-CAM"'
              value={filters.regex}
              onChange={(e) => patchFilters({ regex: e.target.value })}
              aria-label="Advanced regex filter"
            />
          </div>
          {regexInvalid && <p className="filter-warning">Invalid regex — filter ignored</p>}

          {filterCount > 0 && (
            <div className="filter-active">
              <span>{filterCount} active</span>
              <button type="button" className="btn btn-sm btn-ghost" onClick={resetFilters}>
                Clear all
              </button>
            </div>
          )}
        </div>

        {sourcesUnreachable && (
          <div className="inline-error">Prowlarr unreachable — source search unavailable</div>
        )}
        {sourcesAuthError && (
          <div className="inline-error">
            Prowlarr API key invalid — set <code>PROWLARR_API_KEY</code> in .env
          </div>
        )}

        {loadingSources ? (
          <Spinner label="Searching sources…" />
        ) : allSources.length === 0 ? (
          <div className="empty-state">No sources found</div>
        ) : total === 0 ? (
          <div className="empty-state">No sources match your filters</div>
        ) : (
          <>
            <ul className="source-list">
              {visible.map((entry) => {
                if ('variants' in entry) {
                  const group = entry as SourceGroup;
                  return (
                    <SourceRow
                      key={group.key}
                      source={group.best}
                      variants={group.variants}
                      onDownload={handleDownload}
                      disabled={activeDownload != null}
                    />
                  );
                }
                return (
                  <SourceRow
                    key={entry.infoHash}
                    source={entry}
                    onDownload={handleDownload}
                    disabled={activeDownload != null}
                  />
                );
              })}
            </ul>
            {visible.length < total && (
              <button
                type="button"
                className="btn btn-ghost load-more"
                onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
              >
                Load more ({total - visible.length} remaining)
              </button>
            )}
          </>
        )}
      </section>
    </div>
  );
}
