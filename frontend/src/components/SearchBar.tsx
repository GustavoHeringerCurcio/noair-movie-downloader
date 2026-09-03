import type { SearchType } from '../types';

const TYPE_FILTERS: Array<{ key: SearchType; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'movie', label: 'Movies' },
  { key: 'tv', label: 'TV' },
];

interface SearchBarProps {
  query: string;
  type: SearchType;
  onQueryChange: (value: string) => void;
  onTypeChange: (type: SearchType) => void;
  onClear: () => void;
}

export function SearchBar({ query, type, onQueryChange, onTypeChange, onClear }: SearchBarProps) {
  return (
    <div className="search-bar">
      <div className="search-field">
        <svg
          className="search-icon"
          viewBox="0 0 24 24"
          width="20"
          height="20"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <input
          className="search-input"
          type="search"
          placeholder="Search movies & TV — start typing…"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClear();
          }}
          aria-label="Search movies and TV"
          autoComplete="off"
          spellCheck={false}
        />
        {query.length > 0 && (
          <button
            type="button"
            className="search-clear"
            onClick={onClear}
            aria-label="Clear search"
            title="Clear search (Esc)"
          >
            ×
          </button>
        )}
      </div>
      <div className="type-filter" role="group" aria-label="Media type">
        {TYPE_FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            className={`type-btn ${type === f.key ? 'active' : ''}`}
            onClick={() => onTypeChange(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>
    </div>
  );
}
