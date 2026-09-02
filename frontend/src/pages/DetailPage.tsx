import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { MediaDetail, MediaType, Source } from '../types';
import { backdropUrl, createDownload, mediaDetails, sources } from '../api';
import { SourceRow } from '../components/SourceRow';
import { Spinner } from '../components/Spinner';
import { useDownloadsStore } from '../store/downloadsStore';
import { useToastStore } from '../store/toastStore';
import { useUiStore } from '../store/uiStore';

const PAGE_SIZE = 30;

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
  const [filter, setFilter] = useState('');
  const [filterInvalid, setFilterInvalid] = useState(false);
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
    setFilter('');
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

  const filtered = useMemo(() => {
    if (!filter.trim()) return allSources;
    try {
      const regex = new RegExp(filter.trim(), 'i');
      setFilterInvalid(false);
      return allSources.filter((s) => regex.test(s.title));
    } catch {
      setFilterInvalid(true);
      return allSources;
    }
  }, [filter, allSources]);

  const visible = filtered.slice(0, visibleCount);

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
        <h2>Sources</h2>
        <input
          className="search-input filter-input"
          type="text"
          placeholder='Filter sources, e.g. "1080p|x264" or "-CAM"'
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="Filter sources by regex"
        />
        {filterInvalid && (
          <p className="filter-warning">Invalid regex — filter ignored</p>
        )}

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
        ) : filtered.length === 0 ? (
          <div className="empty-state">No sources match your filter</div>
        ) : (
          <>
            <ul className="source-list">
              {visible.map((source) => (
                <SourceRow
                  key={source.infoHash}
                  source={source}
                  onDownload={handleDownload}
                  disabled={activeDownload != null}
                />
              ))}
            </ul>
            {visible.length < filtered.length && (
              <button
                type="button"
                className="btn btn-ghost load-more"
                onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
              >
                Load more ({filtered.length - visible.length} remaining)
              </button>
            )}
          </>
        )}
      </section>
    </div>
  );
}
