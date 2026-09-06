import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { X, Search, History } from 'lucide-react';
import type { MediaItem } from '../types';
import { browse, search } from '../api';
import { TitleCard } from './TitleCard';
import { useSearchStore, type SearchMediaType } from '../store/searchStore';

const TYPE_LABELS: Array<{ key: SearchMediaType; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'movie', label: 'Movies' },
  { key: 'tv', label: 'TV' },
];

export function SearchOverlay() {
  const location = useLocation();
  const open = useSearchStore((s) => s.open);
  const query = useSearchStore((s) => s.query);
  const type = useSearchStore((s) => s.type);
  const recentSearches = useSearchStore((s) => s.recentSearches);
  const openSet = useSearchStore((s) => s.openSet);
  const setQuery = useSearchStore((s) => s.setQuery);
  const setType = useSearchStore((s) => s.setType);
  const pushRecent = useSearchStore((s) => s.pushRecent);
  const clearRecents = useSearchStore((s) => s.clearRecents);

  const [results, setResults] = useState<MediaItem[]>([]);
  const [trending, setTrending] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchedTerm, setSearchedTerm] = useState('');
  const seqRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const trimmed = query.trim();
  const searching = trimmed.length > 0 && searchedTerm === trimmed;

  const close = useCallback(() => {
    openSet(false);
    setQuery('');
    setResults([]);
    setSearchedTerm('');
    setError(null);
  }, [openSet, setQuery]);

  // "/" global shortcut and Esc close
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (open && e.key === 'Escape') {
        e.preventDefault();
        close();
        return;
      }
      if (!open && e.key === '/' && !(e.metaKey || e.ctrlKey || e.altKey)) {
        const target = e.target as HTMLElement | null;
        if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
        e.preventDefault();
        openSet(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, openSet, close]);

  // Snapshot the route while the overlay is open so we can detect a navigation
  // committing beneath it. Selecting a result (or any future in-overlay link)
  // navigates to a page hidden by this full-screen layer; releasing the overlay
  // on route change makes the pick feel immediate instead of "nothing happened".
  const lastLocKey = useRef<string | null>(null);
  useEffect(() => {
    const changed = lastLocKey.current !== null && lastLocKey.current !== location.key;
    lastLocKey.current = location.key;
    if (open && changed) close();
  }, [open, location.key, close]);

  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = 'hidden';
    const t = window.setTimeout(() => inputRef.current?.focus(), 20);
    return () => {
      document.body.style.overflow = '';
      window.clearTimeout(t);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    browse('trending-week')
      .then((res) => {
        if (!cancelled) setTrending(res.items.slice(0, 18));
      })
      .catch(() => {
        if (!cancelled) setTrending([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (!trimmed) {
      seqRef.current += 1;
      setResults([]);
      setSearchedTerm('');
      setError(null);
      setLoading(false);
      return;
    }
    const seq = ++seqRef.current;
    setLoading(true);
    setError(null);
    setSearchedTerm(trimmed);
    const timer = window.setTimeout(() => {
      search(trimmed, type)
        .then((res) => {
          if (seqRef.current !== seq) return;
          setResults(res.items);
          setLoading(false);
        })
        .catch((e: unknown) => {
          if (seqRef.current !== seq) return;
          setResults([]);
          setError(e instanceof Error ? e.message : 'Search failed');
          setLoading(false);
        });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [trimmed, type, open]);

  function submitTerm(term: string): void {
    pushRecent(term);
    setQuery(term);
  }

  if (!open) return null;

  return (
    <div
      className="overlay search-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Search"
      ref={panelRef}
    >
      <button type="button" className="icon-btn so-close" aria-label="Close search" onClick={close}>
        <X size={26} />
      </button>

      <div className="so-head">
        <div className="so-input-wrap">
          <Search size={26} aria-hidden="true" />
          <input
            ref={inputRef}
            className="so-input"
            type="text"
            placeholder="Titles…"
            aria-label="Search titles"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && trimmed) submitTerm(trimmed);
            }}
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        <div className="so-controls">
          <div className="seg" role="group" aria-label="Media type">
            {TYPE_LABELS.map((f) => (
              <button
                key={f.key}
                type="button"
                className={type === f.key ? 'active' : ''}
                onClick={() => setType(f.key)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {recentSearches.length > 0 && (
          <div className="so-recents">
            <History size={15} aria-hidden="true" />
            {recentSearches.map((term) => (
              <button
                key={term}
                type="button"
                className="so-recent-chip"
                onClick={() => submitTerm(term)}
              >
                {term}
              </button>
            ))}
            <button
              type="button"
              className="so-recent-chip"
              aria-label="Clear search history"
              onClick={clearRecents}
            >
              Clear
            </button>
          </div>
        )}
      </div>

      {searching || query.length > 0 ? (
        <>
          {error ? (
            <div className="inline-error" role="alert">
              {error} — is the backend running?
            </div>
          ) : loading ? (
            <div className="landscape-grid" aria-hidden="true">
              {Array.from({ length: 12 }).map((_, i) => (
                <div key={i} className="title-card skeleton" />
              ))}
            </div>
          ) : results.length === 0 ? (
            <p className="empty-state">No results for “{searchedTerm}” — try another title.</p>
          ) : (
            <div className="landscape-grid so-grid">
              {results.map((item) => (
                <TitleCard key={`${item.mediaType}-${item.tmdbId}`} item={item} />
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <p className="so-section-label">Trending now</p>
          <div className="landscape-grid">
            {trending.map((item) => (
              <TitleCard key={`${item.mediaType}-${item.tmdbId}`} item={item} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
