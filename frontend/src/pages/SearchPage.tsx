import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { MediaItem, SearchType } from '../types';
import { search } from '../api';
import { PosterCard } from '../components/PosterCard';

const TYPE_FILTERS: Array<{ key: SearchType; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'movie', label: 'Movies' },
  { key: 'tv', label: 'TV' },
];

export function SearchPage() {
  const [query, setQuery] = useState('');
  const [type, setType] = useState<SearchType>('all');
  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const debounceRef = useRef<number | undefined>(undefined);
  const navigate = useNavigate();

  async function runSearch(q: string, mediaType: SearchType): Promise<void> {
    const trimmed = q.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    setSearched(true);
    try {
      const res = await search(trimmed, mediaType);
      setItems(res.items);
    } catch (e) {
      setItems([]);
      setError(e instanceof Error ? e.message : 'Search failed');
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key !== 'Enter') return;
    window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      void runSearch(query, type);
    }, 300);
  }

  function handleTypeChange(next: SearchType): void {
    setType(next);
    if (query.trim()) void runSearch(query, next);
  }

  return (
    <div className="search-page">
      <div className="search-bar">
        <input
          className="search-input"
          type="search"
          placeholder="Search movies & TV…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          aria-label="Search"
        />
        <div className="type-filter" role="group" aria-label="Media type">
          {TYPE_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              className={`type-btn ${type === f.key ? 'active' : ''}`}
              onClick={() => handleTypeChange(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="inline-error">Search failed: {error}</div>}

      {loading ? (
        <div className="poster-grid">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="poster-card skeleton" aria-hidden="true" />
          ))}
        </div>
      ) : items.length > 0 ? (
        <div className="poster-grid">
          {items.map((item) => (
            <button
              key={`${item.mediaType}-${item.tmdbId}`}
              type="button"
              className="poster-link"
              onClick={() => navigate(`/media/${item.tmdbId}?type=${item.mediaType}`)}
            >
              <PosterCard item={item} />
            </button>
          ))}
        </div>
      ) : searched ? (
        <div className="empty-state">No results for &ldquo;{query.trim()}&rdquo;</div>
      ) : null}
    </div>
  );
}
