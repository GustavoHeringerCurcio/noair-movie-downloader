import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download } from 'lucide-react';
import type { DiscoverSection, DownloadRecord, MediaItem } from '../types';
import { browse, removeDownload } from '../api';
import { TitleCard, type TitleCardPrimary } from '../components/TitleCard';
import { HeroBillboard } from '../components/HeroBillboard';
import { SectionRail } from '../components/SectionRail';
import { EmptyState } from '../components/EmptyState';
import { useDownloadsStore } from '../store/downloadsStore';
import { useRecentsStore } from '../store/recentsStore';
import { useSearchStore } from '../store/searchStore';
import { useToastStore } from '../store/toastStore';
import { useVersionStore, versionKey, resolveActiveVersion } from '../store/versionStore';
import {
  bestPlayable,
  movieGroupKey,
  playable,
  sortVersions,
  versionLabel,
} from '../lib/versions';

interface SectionState {
  items: MediaItem[];
  loading: boolean;
  error: string | null;
}

const HOME_SECTIONS: Array<{ section: DiscoverSection; title: string }> = [
  { section: 'trending-week', title: 'Trending This Week' },
  { section: 'best-movies', title: 'Best Movies' },
  { section: 'best-tv', title: 'Best Series' },
];

const emptyState = (): SectionState => ({ items: [], loading: true, error: null });

function toMediaItem(d: DownloadRecord): MediaItem {
  return {
    tmdbId: d.tmdbId ?? 0,
    mediaType: d.mediaType ?? 'movie',
    title: d.title ?? d.torrentName,
    year: d.year,
    posterPath: d.posterPath,
    backdropPath: d.backdropPath ?? null,
    overview: '',
    voteAverage: 0,
    imdbRating: d.imdbRating ?? null,
  };
}

export function HomePage() {
  const navigate = useNavigate();
  const downloads = useDownloadsStore((s) => s.downloads);
  const removeLocal = useDownloadsStore((s) => s.removeLocal);
  const toast = useToastStore((s) => s.toast);
  const recents = useRecentsStore((s) => s.recents);
  const openSearch = useSearchStore((s) => s.openSet);

  const [sections, setSections] = useState<Record<string, SectionState>>(() =>
    Object.fromEntries(HOME_SECTIONS.map((s) => [s.section, emptyState()])),
  );

  const loadSections = useCallback(() => {
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

  useEffect(() => {
    return loadSections();
  }, [loadSections]);

  const orderedDownloads = useMemo(() => {
    const done = downloads.filter((d) => d.progress >= 1 || d.state === 'seeding');
    const busy = downloads.filter((d) => !(d.progress >= 1 || d.state === 'seeding'));
    const byTime = (a: DownloadRecord, b: DownloadRecord): number =>
      (b.completedAt ?? b.createdAt).localeCompare(a.completedAt ?? a.createdAt);
    return [...done.sort(byTime), ...busy.sort(byTime)];
  }, [downloads]);

  const versionActive = useVersionStore((s) => s.active);
  const selectVersion = useVersionStore((s) => s.select);

  // One library entry per movie title (copies collapse into a single card with
  // version chips); TV releases keep one card per season/episode download.
  const downloadGroups = useMemo(() => {
    const groups = new Map<string, DownloadRecord[]>();
    const order: string[] = [];
    for (const d of orderedDownloads) {
      const g = movieGroupKey(d) ?? `raw:${d.infoHash}`;
      if (!groups.has(g)) order.push(g);
      const arr = groups.get(g);
      if (arr) arr.push(d);
      else groups.set(g, [d]);
    }
    return order.map((g) => ({ key: g, copies: groups.get(g)! }));
  }, [orderedDownloads]);

  const completedTitles = downloadGroups.filter(({ copies }) => copies.some((d) => d.streamable)).length;
  const activeTitles = downloadGroups.length - completedTitles;

  async function handleRemoveDownload(copy: DownloadRecord): Promise<void> {
    const ok = window.confirm(`Remove "${copy.torrentName}" and delete its files? This cannot be undone.`);
    if (!ok) return;
    try {
      await removeDownload(copy.infoHash, true);
      removeLocal(copy.infoHash);
      toast('Removed download', 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Remove failed', 'error');
    }
  }

  function cardFor(group: { key: string; copies: DownloadRecord[] }) {
    const copies = sortVersions(group.copies);
    const rep = copies[0]!;
    const isMovie = movieGroupKey(rep) != null;
    const movieId = rep.tmdbId ?? 0;
    const activeHash = isMovie
      ? resolveActiveVersion(versionKey('movie', movieId), copies, versionActive)
      : rep.infoHash;
    const activeCopy = copies.find((c) => c.infoHash === activeHash) ?? rep;
    const watchableHash =
      (activeCopy.streamable ? activeHash : null) ?? bestPlayable(copies)?.infoHash ?? null;

    let primary: TitleCardPrimary;
    if (watchableHash) {
      primary = { label: 'Watch', icon: 'play', onClick: () => navigate(`/watch/${watchableHash}`) };
    } else {
      primary = { label: 'Manage', icon: 'down', onClick: () => navigate('/downloads') };
    }

    const progress = copies.some(playable) ? null : activeCopy.progress < 1 ? activeCopy.progress : null;
    const variants =
      copies.length > 1
        ? copies.map((c) => ({
            id: c.infoHash,
            label: versionLabel(c),
            active: c.infoHash === activeHash,
          }))
        : null;

    return (
      <TitleCard
        key={group.key}
        item={toMediaItem(activeCopy)}
        progress={progress}
        primary={primary}
        variants={variants}
        onVariantSelect={
          isMovie ? (id) => selectVersion(versionKey('movie', movieId), id) : undefined
        }
        onRemoveDownload={() => void handleRemoveDownload(activeCopy)}
      />
    );
  }

  return (
    <>
      <HeroBillboard />
      <div className="rails">
        <SectionRail
          title="My Downloads"
          subtitle={
            downloadGroups.length > 0
              ? `${completedTitles} ready · ${activeTitles} downloading`
              : undefined
          }
          count={downloadGroups.length}
          emptyHint="Nothing downloaded yet."
          emptyContent={
            <EmptyState
              title="Your downloads will live here"
              hint="Search a title, pick the best release, and watch while it downloads."
              steps={['1 · Search', '2 · Download', '3 · Watch']}
              icon={<Download size={20} />}
              actionLabel="Search titles"
              onAction={() => openSearch(true)}
              compact
            />
          }
        >
          {downloadGroups.map((group) => cardFor(group))}
        </SectionRail>

        {recents.length > 0 && (
          <SectionRail title="Recently Viewed" subtitle={`${recents.length} titles`} count={recents.length}>
            {recents.map(({ item }) => (
              <TitleCard key={`${item.mediaType}-${item.tmdbId}`} item={item} primary={null} />
            ))}
          </SectionRail>
        )}

        {HOME_SECTIONS.map((s) => {
          const state = sections[s.section];
          return (
            <SectionRail
              key={s.section}
              title={s.title}
              count={state.items.length}
              loading={state.loading}
              error={state.error}
              onRetry={loadSections}
              emptyHint="Nothing here yet."
            >
              {state.items.map((item) => (
                <TitleCard key={`${item.mediaType}-${item.tmdbId}`} item={item} primary={null} />
              ))}
            </SectionRail>
          );
        })}
      </div>
    </>
  );
}
