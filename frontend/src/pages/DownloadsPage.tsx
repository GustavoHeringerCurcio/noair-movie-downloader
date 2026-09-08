import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download } from 'lucide-react';
import { useDownloadsStore } from '../store/downloadsStore';
import { EmptyState } from '../components/EmptyState';
import { DownloadListItem } from '../components/DownloadListItem';
import { movieGroupKey, versionLabel } from '../lib/versions';
import type { DownloadRecord } from '../types';

type Tab = 'all' | 'downloading' | 'ready';

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'downloading', label: 'Downloading' },
  { key: 'ready', label: 'Ready to watch' },
];

function titleLabel(d: DownloadRecord): string {
  const base = d.title ?? d.torrentName;
  if (d.seasonNumber == null) return base;
  const se = `S${String(d.seasonNumber).padStart(2, '0')}${d.episodeNumber != null ? `E${String(d.episodeNumber).padStart(2, '0')}` : ''}`;
  return `${base} · ${se}`;
}

/** Key of a standalone title (movie; TV stays one row per season/episode). */
function movieTitleKey(d: DownloadRecord): string | null {
  return movieGroupKey(d);
}

interface GroupHead {
  kind: 'head';
  key: string;
  label: string;
  count: number;
}
interface GroupRow {
  kind: 'row';
  d: DownloadRecord;
  /** True when this row is one of several copies of the same movie title. */
  grouped: boolean;
}
type ListEntry = GroupHead | GroupRow;

export function DownloadsPage() {
  const downloads = useDownloadsStore((s) => s.downloads);
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('all');

  const ordered = useMemo(
    () =>
      [...downloads].sort((a, b) => (b.completedAt ?? b.createdAt).localeCompare(a.completedAt ?? a.createdAt)),
    [downloads],
  );

  const visible = ordered.filter((d) => {
    if (tab === 'downloading') return !(d.progress >= 1 || d.state === 'seeding');
    if (tab === 'ready') return d.progress >= 1 || d.state === 'seeding';
    return true;
  });

  const active = ordered.filter((d) => !(d.progress >= 1 || d.state === 'seeding')).length;
  const ready = ordered.length - active;

  const entries = useMemo<ListEntry[]>(() => {
    const versionCounts = new Map<string, number>();
    for (const d of visible) {
      const k = movieTitleKey(d);
      if (k) versionCounts.set(k, (versionCounts.get(k) ?? 0) + 1);
    }
    const seen = new Set<string>();
    const out: ListEntry[] = [];
    for (const d of visible) {
      const k = movieTitleKey(d);
      const multi = k ? (versionCounts.get(k) ?? 0) > 1 : false;
      if (k && multi && !seen.has(k)) {
        seen.add(k);
        out.push({
          kind: 'head',
          key: k,
          label: d.title ?? d.torrentName,
          count: versionCounts.get(k) ?? 0,
        });
      }
      out.push({ kind: 'row', d, grouped: multi });
    }
    return out;
  }, [visible]);

  return (
    <div className="page">
      <h1 className="page-title">Downloads</h1>
      <p className="page-sub">
        {ordered.length === 0
          ? 'Your downloaded titles will appear here.'
          : `${ready} ready to watch · ${active} downloading · ${ordered.length} total`}
      </p>

      <div className="tabbar" role="tablist" aria-label="Filter downloads">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className={`tab ${tab === t.key ? 'active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {ordered.length === 0 ? (
        <EmptyState
          title="Nothing downloaded yet"
          hint="Search for a movie or show and start a download — it becomes watchable here once the file has fully downloaded."
          steps={['1 · Search', '2 · Download', '3 · Watch']}
          icon={<Download size={22} />}
          actionLabel="Browse movies"
          onAction={() => navigate('/')}
          compact
        />
      ) : visible.length === 0 ? (
        <p className="empty-state">No downloads match this filter.</p>
      ) : (
        <ul className="downloads-list">
          {entries.map((entry) =>
            entry.kind === 'head' ? (
              <li key={entry.key} className="download-grouphead">
                <span className="download-group-title">{entry.label}</span>
                <span className="download-group-count">{entry.count} versions</span>
              </li>
            ) : (
              <DownloadListItem
                key={entry.d.infoHash}
                d={entry.d}
                label={entry.grouped ? versionLabel(entry.d) : titleLabel(entry.d)}
              />
            ),
          )}
        </ul>
      )}
    </div>
  );
}
