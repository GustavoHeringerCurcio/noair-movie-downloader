import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download } from 'lucide-react';
import type { DiscoverSection, DownloadRecord, MediaItem } from '../types';
import { browse } from '../api';
import { TitleCard, type TitleCardPrimary } from '../components/TitleCard';
import { HeroBillboard } from '../components/HeroBillboard';
import { SectionRail } from '../components/SectionRail';
import { EmptyState } from '../components/EmptyState';
import { useDownloadsStore } from '../store/downloadsStore';
import { useRecentsStore } from '../store/recentsStore';
import { useSearchStore } from '../store/searchStore';

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
  };
}

export function HomePage() {
  const navigate = useNavigate();
  const downloads = useDownloadsStore((s) => s.downloads);
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

  const completed = orderedDownloads.filter((d) => d.progress >= 1 || d.state === 'seeding').length;
  const active = orderedDownloads.length - completed;

  function primaryFor(d: DownloadRecord): TitleCardPrimary | null {
    if (d.streamable && d.progress >= 1) {
      return { label: 'Watch', icon: 'play', onClick: () => navigate(`/watch/${d.infoHash}`) };
    }
    if (d.streamable) {
      return {
        label: 'Watch now',
        icon: 'play',
        onClick: () => navigate(`/watch/${d.infoHash}`),
      };
    }
    if (d.progress < 1) {
      return { label: 'Manage', icon: 'down', onClick: () => navigate('/downloads') };
    }
    return null;
  }

  return (
    <>
      <HeroBillboard />
      <div className="rails">
        <SectionRail
          title="My Downloads"
          subtitle={downloads.length > 0 ? `${completed} ready · ${active} downloading` : undefined}
          count={orderedDownloads.length}
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
          {orderedDownloads.map((d) => (
            <TitleCard
              key={d.infoHash}
              item={toMediaItem(d)}
              progress={d.progress < 1 ? d.progress : null}
              primary={primaryFor(d)}
            />
          ))}
        </SectionRail>

        <SectionRail
          title="Recently Viewed"
          subtitle={recents.length > 0 ? `${recents.length} titles` : undefined}
          count={recents.length}
          emptyHint="Titles you open from search or browsing will appear here."
        >
          {recents.map(({ item }) => (
            <TitleCard key={`${item.mediaType}-${item.tmdbId}`} item={item} primary={null} />
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
