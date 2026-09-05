import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { DiscoverSection, MediaItem, MediaType, SearchType } from '../types';
import { browse, search } from '../api';
import { PosterCard } from '../components/PosterCard';
import { SearchBar } from '../components/SearchBar';
import { SectionRail } from '../components/SectionRail';
import { useDownloadsStore } from '../store/downloadsStore';
import { useRecentsStore } from '../store/recentsStore';
import type { DownloadRecord } from '../types';

interface SectionState {
  items: MediaItem[];
  loading: boolean;
  error: string | null;
}

const HOME_SECTIONS: Array<{ section: DiscoverSection; title: string }> = [
  { section: 'trending-week', title: 'Trending This Week' },
  { section: 'popular-movies', title: 'Popular Movies' },
  { section: 'best-movies', title: 'Best Movies' },
  { section: 'top-rated-recent', title: 'Top Rated (Recent)' },
  { section: 'popular-tv', title: 'Popular TV' },
  { section: 'best-tv', title: 'Best Series' },
];

const emptyState = (): SectionState => ({ items: [], loading: true, error: null });

export function HomePage() {
  const navigate = useNavigate();
  const downloads = useDownloadsStore((s) => s.downloads);
  const recents = useRecentsStore((s) => s.recents);

  const [sections, setSections] = useState<Record<string, SectionState>>(() =>
    Object.fromEntries(HOME_SECTIONS.map((s) => [s.section, emptyState()])),
  );

  useEffect(() => {
    let cancelled = false;
    setSections(Object.fromEntries(HOME_SECTIONS.map((s) => [s.section, emptyState()])));
    for (const s of HOME_SECTIONS) {
      browse(s.section)
        .then((res) => {
          if (cancelled) return;
          setSections((prev) => ({ ...prev, [s.section]: { items: res.items, loading: false, error: null } }));
        })
        .catch((e: unknown) => {
          if (cancelled) return;
          const message = e instanceof Error ? e.message : 'Failed to load';
          setSections((prev) => ({ ...prev, [s.section]: { items: [], loading: false, error: message } }));
        });
    }
    return () => {
      cancelled = true;
    };
  }, []);

  // ---- search state ---------------------------------------------------------
  const [query, setQuery] = useState('');
  const [type, setType] = useState<SearchType>('all');
  const [results, setResults] = useState<MediaItem[]>([]);
  const [resultsLoading, setResultsLoading] = useState(false);
  const [resultsError, setResultsError] = useState<string | null>(null);
  const [searchedTerm, setSearchedTerm] = useState<string>('');
  const debounceRef = useRef<number | undefined>(undefined);
  const searchSeqRef = useRef(0);

  const searching = useMemo(() => {
    const q = query.trim();
    return q.length > 0 && searchedTerm === q;
  }, [query, searchedTerm]);

  function runSearch(term: string, mediaType: SearchType): void {
    const trimmed = term.trim();
    const seq = ++searchSeqRef.current;
    window.clearTimeout(debounceRef.current);
    if (!trimmed) {
      setResults([]);
      setSearchedTerm('');
      setResultsError(null);
      setResultsLoading(false);
      return;
    }
    setResultsLoading(true);
    setResultsError(null);
    setSearchedTerm(trimmed);
    search(trimmed, mediaType)
      .then((res) => {
        if (searchSeqRef.current !== seq) return;
        setResults(res.items);
        setResultsLoading(false);
      })
      .catch((e: unknown) => {
        if (searchSeqRef.current !== seq) return;
        setResults([]);
        setResultsError(e instanceof Error ? e.message : 'Search failed');
        setResultsLoading(false);
      });
  }

  function handleQueryChange(value: string): void {
    setQuery(value);
    window.clearTimeout(debounceRef.current);
    const trimmed = value.trim();
    if (!trimmed) {
      searchSeqRef.current += 1;
      setResults([]);
      setSearchedTerm('');
      setResultsError(null);
      setResultsLoading(false);
      return;
    }
    debounceRef.current = window.setTimeout(() => {
      runSearch(trimmed, type);
    }, 300);
  }

  function handleTypeChange(next: SearchType): void {
    setType(next);
    if (query.trim()) runSearch(query.trim(), next);
  }

  function clearSearch(): void {
    searchSeqRef.current += 1;
    window.clearTimeout(debounceRef.current);
    setQuery('');
    setResults([]);
    setSearchedTerm('');
    setResultsError(null);
    setResultsLoading(false);
  }

  // ---- derived browse data ---------------------------------------------------
  const completed = useMemo(
    () =>
      downloads
        .filter((d) => d.progress >= 1 || d.state === 'seeding')
        .sort((a, b) => (b.completedAt ?? b.createdAt).localeCompare(a.completedAt ?? a.createdAt)),
    [downloads],
  );
  const inProgress = useMemo(
    () =>
      downloads
        .filter((d) => !(d.progress >= 1 || d.state === 'seeding'))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [downloads],
  );
  const downloadsCount = downloads.length;

  function openDownload(d: DownloadRecord): void {
    if (d.streamable) {
      navigate(`/watch/${d.infoHash}`);
      return;
    }
    if (d.tmdbId && d.mediaType) {
      navigate(`/media/${d.tmdbId}?type=${d.mediaType}`);
    }
  }

  function openDetail(item: { tmdbId: number; mediaType: MediaType }): void {
    navigate(`/media/${item.tmdbId}?type=${item.mediaType}`);
  }

  // ---- render -----------------------------------------------------------------
  return (
    <div className="home-page">
      <div className="home-hero">
        <h1 className="home-title">Movie Downloader</h1>
        <p className="home-tagline">Find it. Download it. Watch it instantly.</p>
        <SearchBar
          query={query}
          type={type}
          onQueryChange={handleQueryChange}
          onTypeChange={handleTypeChange}
          onClear={clearSearch}
        />
      </div>

      {searching ? (
        <div className="search-results">
          <div className="search-results-head">
            <h2 className="rail-title">Results for &ldquo;{searchedTerm}&rdquo;</h2>
            <span className="rail-subtitle">
              {resultsLoading ? 'Searching…' : `${results.length} ${results.length === 1 ? 'result' : 'results'}`}
            </span>
          </div>

          {resultsError ? (
            <div className="inline-error">Search failed: {resultsError}</div>
          ) : resultsLoading ? (
            <div className="poster-grid" aria-hidden="true">
              {Array.from({ length: 12 }).map((_, i) => (
                <div key={i} className="poster-card skeleton" />
              ))}
            </div>
          ) : results.length === 0 ? (
            <div className="empty-state">No results for &ldquo;{searchedTerm}&rdquo;</div>
          ) : (
            <div className="poster-grid">
              {results.map((item) => (
                <button
                  key={`${item.mediaType}-${item.tmdbId}`}
                  type="button"
                  className="poster-link"
                  onClick={() => openDetail(item)}
                >
                  <PosterCard item={item} />
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="browse">
          <SectionRail
            title="Downloads"
            subtitle={`${completed.length} downloaded${inProgress.length > 0 ? ` · ${inProgress.length} in progress` : ''}`}
            count={downloadsCount}
            emptyHint="Search for a movie and start a download to see it here."
          >
            {[...completed, ...inProgress].map((d) => (
              <button
                key={d.infoHash}
                type="button"
                className="poster-link"
                onClick={() => openDownload(d)}
                aria-label={`${d.title ?? d.torrentName}${d.progress >= 1 ? '' : ` (${Math.round(d.progress * 100)}% downloaded)`}`}
              >
                <PosterCard
                  item={{
                    tmdbId: d.tmdbId ?? 0,
                    mediaType: d.mediaType ?? 'movie',
                    title: d.title ?? d.torrentName,
                    year: d.year,
                    posterPath: d.posterPath,
                    backdropPath: null,
                    overview: '',
                    voteAverage: 0,
                  }}
                  progress={d.progress < 1 ? d.progress : null}
                />
              </button>
            ))}
          </SectionRail>

          <SectionRail
            title="Recently Viewed"
            subtitle={recents.length > 0 ? `${recents.length} titles` : undefined}
            count={recents.length}
            emptyHint="Movies you open from search or browsing will appear here."
          >
            {recents.map(({ item }) => (
              <button key={`${item.mediaType}-${item.tmdbId}`} type="button" className="poster-link" onClick={() => openDetail(item)}>
                <PosterCard item={item} />
              </button>
            ))}
          </SectionRail>

          {HOME_SECTIONS.map((s) => {
            const state = sections[s.section];
            return (
              <SectionRail
                key={s.section}
                title={s.title}
                count={state.items.length}
                loading={state.loading}
                error={state.error}
                emptyHint="Nothing here yet."
              >
                {state.items.map((item) => (
                  <button
                    key={`${item.mediaType}-${item.tmdbId}`}
                    type="button"
                    className="poster-link"
                    onClick={() => openDetail(item)}
                  >
                    <PosterCard item={item} />
                  </button>
                ))}
              </SectionRail>
            );
          })}
        </div>
      )}
    </div>
  );
}
