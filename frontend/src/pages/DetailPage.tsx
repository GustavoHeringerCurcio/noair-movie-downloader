import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowDownToLine,
  Trash2,
  Play,
  SlidersHorizontal,
  Search,
  Plus,
} from 'lucide-react';
import type {
  AudioLang,
  MediaDetail,
  MediaType,
  Source,
  SourceFilters,
  SourceSortKey,
  TvEpisode,
} from '../types';
import {
  backdropUrl,
  createDownload,
  mediaDetails,
  removeDownload,
  seasonEpisodes,
  sources,
} from '../api';
import { SourceRow } from '../components/SourceRow';
import { StateBadge } from '../components/StateBadge';
import { humanSize } from '../api';
import { activeFilterCount, filterSources, groupSources, sortSources } from '../lib/release';
import { chooseEpisodePick, chooseSeasonPick } from '../lib/coverage';
import { episodeToken } from '../lib/episode';
import { useDownloadsStore } from '../store/downloadsStore';
import { useToastStore } from '../store/toastStore';
import { useRecentsStore } from '../store/recentsStore';
import { useAudioLanguage, useImageProvider } from '../store/settingsStore';
import { audioChipLabel, audioLanguageLabel } from '../lib/audio';
import type { DownloadRecord } from '../types';

const PAGE_SIZE = 30;
const RESOLUTIONS = ['2160p', '1080p', '720p', '480p'];
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

function pickQuality(source: Source): string | null {
  const parts: string[] = [];
  if (source.resolution) parts.push(source.resolution);
  if (source.source) parts.push(source.source);
  if (source.codec) parts.push(source.codec);
  if (source.isDolbyVision) parts.push('DoVi');
  else if (source.hdr) parts.push('HDR');
  return parts.length > 0 ? parts.join(' · ') : null;
}

function pickSummary(source: Source): string {
  const bits: string[] = [];
  bits.push(humanSize(source.sizeBytes));
  if (source.indexer) bits.push(source.indexer);
  bits.push(`${source.seeders} seeds`);
  return bits.join(' · ');
}

interface AdvancedSheetProps {
  open: boolean;
  title: string;
  subtitle: string;
  sources: Source[];
  addedHashes: Set<string>;
  onPick: (source: Source) => void;
  onClose: () => void;
}

function AdvancedSheet({ open, title, subtitle, sources: rawSources, addedHashes, onPick, onClose }: AdvancedSheetProps) {
  const [filters, setFilters] = useState<SourceFilters>(emptyFilters);
  const [sortKey, setSortKey] = useState<SourceSortKey>('seeders');
  const [showDuplicates, setShowDuplicates] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  useEffect(() => {
    if (!open) return;
    setFilters(emptyFilters);
    setSortKey('seeders');
    setShowDuplicates(false);
    setVisibleCount(PAGE_SIZE);
  }, [open]);

  const filtered = useMemo(() => filterSources(rawSources, filters), [rawSources, filters]);
  const sorted = useMemo(() => sortSources(filtered, sortKey), [filtered, sortKey]);
  const grouped = useMemo(
    () => (showDuplicates ? null : groupSources(sorted)),
    [sorted, showDuplicates],
  );
  const total = grouped ? grouped.length : sorted.length;
  const visible = (grouped ?? sorted).slice(0, visibleCount);

  function toggle(list: string[], value: string): string[] {
    return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  }

  if (!open) return null;

  const filterCount = activeFilterCount(filters);

  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-label="All sources" onClick={onClose}>
      <div className="sheet-panel" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <div>
            <h2 className="sheet-title">{title}</h2>
            <p className="sheet-subtitle">
              {subtitle} · {total} {total === 1 ? 'release' : 'releases'}
            </p>
          </div>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="filter-bar">
          <div className="filter-group">
            <span className="chip">Resolution</span>
            {RESOLUTIONS.map((r) => (
              <button
                key={r}
                type="button"
                className={`filter-chip ${filters.resolutions.includes(r) ? 'active' : ''}`}
                onClick={() => setFilters((f) => ({ ...f, resolutions: toggle(f.resolutions, r) }))}
              >
                {r}
              </button>
            ))}
          </div>
          <div className="filter-group">
            <span className="chip">Codec</span>
            {CODECS.map((c) => (
              <button
                key={c}
                type="button"
                className={`filter-chip ${filters.codecs.includes(c) ? 'active' : ''}`}
                onClick={() => setFilters((f) => ({ ...f, codecs: toggle(f.codecs, c) }))}
              >
                {c}
              </button>
            ))}
          </div>
          <div className="filter-group">
            <span className="chip">Min seeders</span>
            <input
              className="filter-input"
              type="number"
              min={0}
              placeholder="0"
              value={filters.minSeeders ?? ''}
              onChange={(e) => {
                const n = Number(e.target.value);
                setFilters((f) => ({ ...f, minSeeders: e.target.value === '' ? null : Number.isFinite(n) && n > 0 ? n : f.minSeeders }));
              }}
              aria-label="Minimum seeders"
            />
          </div>
          <div className="filter-group">
            <input
              className="filter-input filter-input-regex"
              type="text"
              placeholder="Advanced regex e.g. 1080p|x265 or -CAM"
              value={filters.regex}
              onChange={(e) => setFilters((f) => ({ ...f, regex: e.target.value }))}
              aria-label="Advanced regex filter"
            />
          </div>
          <div className="filter-group">
            <label className="chip" style={{ cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={showDuplicates}
                onChange={(e) => setShowDuplicates(e.target.checked)}
                style={{ marginRight: 6 }}
              />
              Show duplicates
            </label>
            <select
              className="sort-select"
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SourceSortKey)}
              aria-label="Sort sources"
            >
              <option value="seeders">Seeders</option>
              <option value="size">Size</option>
              <option value="age">Age</option>
              <option value="resolution">Resolution</option>
              <option value="sizePerSeeder">Size/seeder</option>
            </select>
            {filterCount > 0 && (
              <button type="button" className="btn btn-sm btn-outline" onClick={() => setFilters(emptyFilters)}>
                Clear filters
              </button>
            )}
          </div>
        </div>

        {total === 0 ? (
          <p className="empty-state">
            {rawSources.length === 0 ? 'No sources found.' : 'No sources match your filters.'}
          </p>
        ) : (
          <ul className="source-list">
            {visible.map((entry) => {
              if ('variants' in entry) {
                const group = entry;
                const selected = group.variants.find((v) => addedHashes.has(v.infoHash));
                return (
                  <SourceRow
                    key={group.key}
                    source={group.best}
                    variants={group.variants}
                    onDownload={onPick}
                    disabled={selected != null}
                    disabledLabel={selected ? 'Already added' : undefined}
                  />
                );
              }
              const single = entry as Source;
              return (
                <SourceRow
                  key={single.infoHash}
                  source={single}
                  onDownload={onPick}
                  disabled={addedHashes.has(single.infoHash)}
                  disabledLabel={addedHashes.has(single.infoHash) ? 'Already added' : undefined}
                />
              );
            })}
          </ul>
        )}
        {visible.length < total && (
          <button
            type="button"
            className="btn btn-ghost"
            style={{ width: '100%', marginTop: 14 }}
            onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
          >
            Load more ({total - visible.length} remaining)
          </button>
        )}
      </div>
    </div>
  );
}

interface ConfirmState {
  scopeLabel: string;
  source: Source;
  season: number | null;
  episode: number | null;
}

interface LanguageBannerProps {
  lang: AudioLang;
  fallbackActive: boolean;
  onEnglish: () => void;
  onBack: () => void;
  onDismiss: () => void;
}

function LanguageBanner({ lang, fallbackActive, onEnglish, onBack, onDismiss }: LanguageBannerProps) {
  if (fallbackActive) {
    return (
      <div className="language-banner" role="status">
        <span>
          Showing <strong>English</strong> results — no {audioLanguageLabel(lang)} audio releases were
          found.
        </span>
        <button type="button" className="btn btn-sm btn-outline" onClick={onBack}>
          Back to {audioLanguageLabel(lang)}
        </button>
      </div>
    );
  }
  return (
    <div className="language-banner language-banner-warn" role="alert">
      <span>No {audioLanguageLabel(lang)} audio releases found. Search in English instead?</span>
      <div className="language-banner-actions">
        <button type="button" className="btn btn-sm btn-white" onClick={onEnglish}>
          Search in English
        </button>
        <button type="button" className="btn btn-sm btn-outline" onClick={onDismiss}>
          Keep {audioLanguageLabel(lang)}
        </button>
      </div>
    </div>
  );
}

export function DetailPage() {
  const { id: idParam } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const id = parseInt(idParam ?? '', 10);
  const mediaType: MediaType = searchParams.get('type') === 'tv' ? 'tv' : 'movie';

  const downloads = useDownloadsStore((s) => s.downloads);
  const toast = useToastStore((s) => s.toast);
  const recordRecent = useRecentsStore((s) => s.record);
  const audio = useAudioLanguage();

  const [detail, setDetail] = useState<MediaDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  // Movie scope sources (whole-title search)
  const [movieSources, setMovieSources] = useState<Source[]>([]);
  const [movieLoading, setMovieLoading] = useState(false);
  const [movieError, setMovieError] = useState<string | null>(null);
  const [movieNoMatch, setMovieNoMatch] = useState<AudioLang | null>(null);
  const [movieFallback, setMovieFallback] = useState(false);

  // TV season state
  const [activeSeason, setActiveSeason] = useState<number | null>(null);
  const [episodes, setEpisodes] = useState<TvEpisode[]>([]);
  const [episodesLoading, setEpisodesLoading] = useState(false);
  const [seasonSources, setSeasonSources] = useState<Source[]>([]);
  const [seasonLoading, setSeasonLoading] = useState(false);
  const [sourcesError, setSourcesError] = useState<string | null>(null);
  const [seasonNoMatch, setSeasonNoMatch] = useState<AudioLang | null>(null);
  const [seasonFallback, setSeasonFallback] = useState(false);

  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [sheet, setSheet] = useState<{ title: string; subtitle: string; scopeSources: Source[]; season: number | null; episode: number | null } | null>(null);

  // Downloads for this title
  const titleDownloads = useMemo(
    () =>
      downloads
        .filter((d) => d.tmdbId === id && d.mediaType === mediaType)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [downloads, id, mediaType],
  );
  const addedHashes = useMemo(() => new Set(titleDownloads.map((d) => d.infoHash)), [titleDownloads]);

  useEffect(() => {
    if (!Number.isFinite(id) || id <= 0) {
      setDetailError('Invalid media id');
      return;
    }
    let cancelled = false;
    setDetailError(null);
    setDetail(null);
    setMovieSources([]);
    setSeasonSources([]);
    setEpisodes([]);
    setActiveSeason(null);
    setSourcesError(null);
    setMovieNoMatch(null);
    setMovieFallback(false);
    setSeasonNoMatch(null);
    setSeasonFallback(false);

    async function load(): Promise<void> {
      try {
        const media = await mediaDetails(id, mediaType);
        if (cancelled) return;
        setDetail(media);
        recordRecent({
          tmdbId: media.tmdbId,
          mediaType: media.mediaType,
          title: media.title,
          year: media.year,
          posterPath: media.posterPath,
          backdropPath: media.backdropPath,
          overview: media.overview,
          voteAverage: media.voteAverage,
        });

        if (mediaType === 'tv') {
          const seasons = (media.seasons ?? []).filter((s) => s.episodeCount > 0);
          const defaultSeason =
            (media.seasons ?? []).find((s) =>
              downloads.some((d) => d.tmdbId === id && d.mediaType === 'tv' && d.seasonNumber === s.seasonNumber),
            )?.seasonNumber ?? seasons[0]?.seasonNumber ?? null;
          if (defaultSeason != null) {
            setActiveSeason(defaultSeason);
            void loadSeason(defaultSeason, media);
          } else {
            setEpisodesLoading(false);
            setSeasonLoading(false);
          }
        } else {
          await loadMovieSources(media);
        }
      } catch (e) {
        if (cancelled) return;
        setDetailError(e instanceof Error ? e.message : 'Failed to load details');
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [id, mediaType, audio]);

  async function loadMovieSources(media: MediaDetail, override?: AudioLang): Promise<void> {
    const reqAudio = override ?? audio;
    setMovieLoading(true);
    setMovieError(null);
    setMovieNoMatch(null);
    setMovieFallback(false);
    try {
      const res = await sources(media.tmdbId, 'movie', { audio: reqAudio });
      setMovieSources(res.sources);
      if (res.noMatchForAudio) setMovieNoMatch(res.noMatchForAudio);
      if (reqAudio === 'en' && audio !== 'en') setMovieFallback(true);
      if (res.unreachable) setMovieError('Source search unavailable (Prowlarr unreachable).');
      else if (res.authError) setMovieError('Source search unavailable (invalid Prowlarr key).');
    } catch (e) {
      setMovieSources([]);
      setMovieError(e instanceof Error ? e.message : 'Failed to search sources');
    } finally {
      setMovieLoading(false);
    }
  }

  async function loadSeason(season: number, media: MediaDetail, override?: AudioLang): Promise<void> {
    const reqAudio = override ?? audio;
    setEpisodesLoading(true);
    setSeasonLoading(true);
    setSourcesError(null);
    setSeasonNoMatch(null);
    setSeasonFallback(false);
    try {
      const [epRes, srcRes] = await Promise.all([
        seasonEpisodes(media.tmdbId, season),
        sources(media.tmdbId, 'tv', { season, audio: reqAudio }),
      ]);
      setEpisodes(epRes.episodes);
      setSeasonSources(srcRes.sources);
      if (srcRes.noMatchForAudio) setSeasonNoMatch(srcRes.noMatchForAudio);
      if (reqAudio === 'en' && audio !== 'en') setSeasonFallback(true);
      if (srcRes.unreachable) setSourcesError('Source search unavailable (Prowlarr unreachable).');
      else if (srcRes.authError) setSourcesError('Source search unavailable (invalid Prowlarr key).');
    } catch (e) {
      setEpisodes([]);
      setSeasonSources([]);
      setSourcesError(e instanceof Error ? e.message : 'Failed to load season');
    } finally {
      setEpisodesLoading(false);
      setSeasonLoading(false);
    }
  }

  function changeSeason(season: number): void {
    if (!detail) return;
    setActiveSeason(season);
    setEpisodes([]);
    setSeasonSources([]);
    void loadSeason(season, detail);
  }

  async function addDownload(source: Source, season: number | null, episode: number | null): Promise<void> {
    if (!detail) return;
    const payload = {
      tmdbId: detail.tmdbId,
      mediaType: detail.mediaType,
      title: detail.title,
      year: detail.year,
      posterPath: detail.posterPath,
      backdropPath: detail.backdropPath ?? null,
      seasonNumber: season,
      episodeNumber: episode,
      infoHash: source.infoHash,
      magnetUri: source.magnetUri,
      torrentName: source.title,
      indexer: source.indexer,
      resolution: source.resolution,
      source: source.source,
      codec: source.codec,
      hdr: source.hdr,
      isDolbyVision: source.isDolbyVision,
    };
    try {
      await createDownload(payload);
      setConfirm(null);
      toast(`Added: ${source.title}`, 'success');
    } catch (e) {
      const status = (e as Error & { status?: number }).status;
      toast(status === 409 ? 'Already downloading that release' : e instanceof Error ? e.message : 'Download failed', 'error');
    }
  }

  function openConfirm(scopeLabel: string, source: Source, season: number | null, episode: number | null): void {
    setConfirm({ scopeLabel, source, season, episode });
  }

  function movieFriendlyPick(): Source | null {
    return movieSources.length > 0 ? movieSources[0]! : null;
  }

  function seasonFullPick(): Source | null {
    if (activeSeason == null) return null;
    return chooseSeasonPick(seasonSources, activeSeason);
  }

  // Episode -> action derivation
  const downloadsForSeason = useMemo(
    () => titleDownloads.filter((d) => d.seasonNumber === activeSeason),
    [titleDownloads, activeSeason],
  );
  const seasonPackDownload = useMemo(
    () => downloadsForSeason.find((d) => d.episodeNumber === null && d.seasonNumber === activeSeason) ?? null,
    [downloadsForSeason, activeSeason],
  );

  function episodeActions(episode: TvEpisode): {
    kind: 'pack' | 'own' | 'download' | 'noexact' | 'browse';
    download: DownloadRecord | null;
    source: Source | null;
    own: DownloadRecord | null;
  } {
    const own = titleDownloads.find((d) => d.seasonNumber === episode.seasonNumber && d.episodeNumber === episode.episodeNumber) ?? null;
    const source = chooseEpisodePick(seasonSources, episode.seasonNumber, episode.episodeNumber);
    if (own) return { kind: 'own', download: own, source: null, own };
    if (seasonPackDownload) return { kind: 'pack', download: seasonPackDownload, source: null, own: null };
    if (source) return { kind: 'download', download: null, source, own: null };
    return { kind: 'noexact', download: null, source: null, own: null };
  }

  function trashDownload(d: DownloadRecord): void {
    const ok = window.confirm(`Delete "${d.torrentName}" and its files? This cannot be undone.`);
    if (!ok) return;
    void removeDownload(d.infoHash, true)
      .then(() => {
        useDownloadsStore.getState().removeLocal(d.infoHash);
        toast('Removed download', 'success');
      })
      .catch((e: unknown) => toast(e instanceof Error ? e.message : 'Remove failed', 'error'));
  }

  const provider = useImageProvider();
  // STRICT hero art: FanArt provider shows only FanArt.tv art (HD background →
  // key-art thumb → poster), never TMDB; TMDB provider shows only TMDB backdrops,
  // never FanArt.
  const backdrop =
    provider === 'fanart'
      ? (detail?.art?.backgroundUrl ??
        detail?.art?.thumbUrl ??
        detail?.art?.posterUrl ??
        null)
      : backdropUrl(detail?.backdropPath ?? null);

  const [heroArtFailed, setHeroArtFailed] = useState({ media: false, logo: false });
  useEffect(() => {
    setHeroArtFailed({ media: false, logo: false });
  }, [backdrop, detail?.art?.logoUrl]);

  if (detailError || !detail) {
    return (
      <div className="page-state">
        {!detailError && <span className="spinner" aria-hidden="true" />}
        {detailError && <p className="inline-error">{detailError}</p>}
        <button type="button" className="btn btn-white" onClick={() => navigate('/')}>
          Back home
        </button>
      </div>
    );
  }

  const seasons = (detail.seasons ?? []).filter((s) => s.episodeCount > 0);
  const activePackDownload = seasonPackDownload;

  return (
    <div className="detail-page">
      <section className="detail-hero">
        {backdrop && !heroArtFailed.media && (
          <img className="hero-media" src={backdrop} alt="" onError={() => setHeroArtFailed((s) => ({ ...s, media: true }))} />
        )}
        <div className="hero-overlay-l" aria-hidden="true" />
        <div className="hero-overlay-b" aria-hidden="true" />
        <div className="dh-content">
          {provider === 'fanart' && detail.art?.logoUrl && !heroArtFailed.logo ? (
            <>
              <img
                className="dh-logo"
                src={detail.art.logoUrl}
                alt=""
                onError={() => setHeroArtFailed((s) => ({ ...s, logo: true }))}
              />
              <h1 className="sr-only">{detail.title}</h1>
            </>
          ) : (
            <h1 className="dh-title">{detail.title}</h1>
          )}
          <div className="dh-meta">
            <span>{detail.year ?? '—'}</span>
            <span>{detail.genres.join(' · ')}</span>
            {detail.runtime != null && <span>{detail.runtime} min</span>}
            <span className="dh-meta-chip">★ {detail.voteAverage.toFixed(1)}</span>
            {mediaType === 'tv' && <span className="dh-meta-chip">{seasons.length} Seasons</span>}
          </div>
          <p className="dh-overview">{detail.overview}</p>

          {mediaType === 'movie' ? (
            <div className="dh-actions">
              {titleDownloads.length > 0 ? (
                titleDownloads.map((d) => (
                  <div key={d.infoHash} className="dh-extra">
                    <button
                      type="button"
                      className="btn btn-white"
                      disabled={!d.streamable}
                      onClick={() => navigate(`/watch/${d.infoHash}`)}
                    >
                      <Play size={18} fill="currentColor" /> Watch
                    </button>
                    <StateBadge state={d.state} />
                    <span className="dh-active">
                      {d.progress < 1 && `${Math.round(d.progress * 100)}%`}
                    </span>
                    <button type="button" className="icon-btn" aria-label="Delete files" title="Delete files" onClick={() => trashDownload(d)}>
                      <Trash2 size={18} />
                    </button>
                  </div>
                ))
              ) : movieLoading ? (
                <button type="button" className="btn btn-white btn-lg" disabled>
                  <span className="spinner spinner-sm" aria-hidden="true" /> Looking for best source…
                </button>
              ) : movieSources.length === 0 && !movieNoMatch ? (
                <>
                  <button type="button" className="btn btn-white btn-lg" disabled>
                    No sources found
                  </button>
                  <button type="button" className="btn btn-ghost btn-lg" onClick={() => setSheet({ title: detail.title, subtitle: 'All releases', scopeSources: movieSources, season: null, episode: null })}>
                    <Search size={18} /> Retry search
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="btn btn-white btn-lg"
                    onClick={() => {
                      const pick = movieFriendlyPick();
                      if (pick) openConfirm('Download this movie', pick, null, null);
                    }}
                  >
                    <ArrowDownToLine size={20} /> Download
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-lg"
                    onClick={() => setSheet({ title: detail.title, subtitle: 'All releases for this movie', scopeSources: movieSources, season: null, episode: null })}
                  >
                    <SlidersHorizontal size={18} /> Advanced
                  </button>
                </>
              )}
              {movieError && (
                <div className="dh-extra">
                  <span className="inline-error">{movieError}</span>
                  <button type="button" className="btn btn-sm btn-outline" onClick={() => loadMovieSources(detail)}>
                    Retry
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="dh-actions">
              {seasonFullPick() ? (
                <button
                  type="button"
                  className="btn btn-white btn-lg"
                  onClick={() => {
                    const pick = seasonFullPick();
                    if (pick && activeSeason != null) {
                      openConfirm(`Download ${detail.title} · Season ${activeSeason}`, pick, activeSeason, null);
                    }
                  }}
                >
                  <ArrowDownToLine size={20} /> Download season
                </button>
              ) : seasonLoading ? (
                <button type="button" className="btn btn-white btn-lg" disabled>
                  <span className="spinner spinner-sm" aria-hidden="true" /> Looking for best source…
                </button>
              ) : (
                <button type="button" className="btn btn-white btn-lg" disabled>
                  No season pack found
                </button>
              )}
              <button
                type="button"
                className="btn btn-ghost btn-lg"
                onClick={() => {
                  if (activeSeason != null) {
                    setSheet({ title: `${detail.title} · Season ${activeSeason}`, subtitle: 'All releases', scopeSources: seasonSources, season: activeSeason, episode: null });
                  }
                }}
              >
                <SlidersHorizontal size={18} /> Browse releases
              </button>
              {activePackDownload && (
                <div className="dh-extra">
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={!activePackDownload.streamable}
                    onClick={() => navigate(`/watch/${activePackDownload.infoHash}`)}
                  >
                    <Play size={18} fill="currentColor" /> Watch season
                  </button>
                  <StateBadge state={activePackDownload.state} />
                  <button type="button" className="icon-btn" aria-label="Delete files" onClick={() => trashDownload(activePackDownload)}>
                    <Trash2 size={18} />
                  </button>
                </div>
              )}
            </div>
          )}
          {mediaType === 'movie' && (movieNoMatch || movieFallback) && (
            <LanguageBanner
              lang={movieNoMatch ?? audio}
              fallbackActive={movieFallback}
              onEnglish={() => void loadMovieSources(detail, 'en')}
              onBack={() => void loadMovieSources(detail)}
              onDismiss={() => setMovieNoMatch(null)}
            />
          )}
        </div>
      </section>

      {mediaType === 'tv' && (
        <div className="detail-body">
          {seasons.length > 0 && (
            <div className="season-toolbar">
              <span className="tb-title">{detail.title}</span>
              <select
                className="season-select"
                aria-label="Choose season"
                value={activeSeason ?? ''}
                onChange={(e) => changeSeason(Number(e.target.value))}
              >
                {seasons.map((s) => (
                  <option key={s.seasonNumber} value={s.seasonNumber}>
                    Season {s.seasonNumber} — {s.episodeCount} episodes
                  </option>
                ))}
              </select>
              <span className="spacer" />
              {seasonLoading && <span className="spinner spinner-sm" aria-hidden="true" />}
            </div>
          )}

          {sourcesError && <div className="inline-error">{sourcesError}</div>}

          {(seasonNoMatch || seasonFallback) && (
            <LanguageBanner
              lang={seasonNoMatch ?? audio}
              fallbackActive={seasonFallback}
              onEnglish={() => activeSeason != null && void loadSeason(activeSeason, detail, 'en')}
              onBack={() => activeSeason != null && void loadSeason(activeSeason, detail)}
              onDismiss={() => setSeasonNoMatch(null)}
            />
          )}

          {episodesLoading ? (
            <div className="section-block">
              <div className="landscape-grid" aria-hidden="true">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="title-card skeleton" />
                ))}
              </div>
            </div>
          ) : (
            episodes.map((episode) => {
              const act = episodeActions(episode);
              const kind = act.kind;
              const own = act.own;
              const dl = act.download;
              const src = act.source;
              return (
                <div className="episode-row" key={`${episode.seasonNumber}-${episode.episodeNumber}`}>
                  <span className="er-index">{episode.episodeNumber}</span>
                  {episode.stillPath ? (
                    <img className="er-thumb" src={`/api/images/tmdb/w500${episode.stillPath}`} alt="" loading="lazy" />
                  ) : (
                    <div className="er-thumb skeleton" aria-hidden="true" />
                  )}
                  <div className="er-body">
                    <div className="er-title-line">
                      <span className="er-title">{episode.name || `Episode ${episode.episodeNumber}`}</span>
                      {episode.runtime != null && <span className="er-duration">{episode.runtime} min</span>}
                    </div>
                    {episode.overview && <p className="er-overview">{episode.overview}</p>}
                    <div className="er-state">
                      {kind === 'own' && own && (
                        <>
                          <StateBadge state={own.state} />
                          <span>{Math.round(own.progress * 100)}%</span>
                        </>
                      )}
                      {kind === 'pack' && <span>Included in the season download</span>}
                      {kind === 'noexact' && <span>No standalone episode release</span>}
                      {kind === 'download' && src && <span>Ready to download</span>}
                    </div>
                  </div>
                  <div className="er-actions">
                    {kind === 'own' && own && (
                      <>
                        <button
                          type="button"
                          className="btn btn-white btn-sm"
                          disabled={!own.streamable}
                          onClick={() => navigate(`/watch/${own.infoHash}`)}
                        >
                          <Play size={15} fill="currentColor" /> Watch
                        </button>
                        <button type="button" className="icon-btn" aria-label="Delete files" onClick={() => trashDownload(own)}>
                          <Trash2 size={16} />
                        </button>
                      </>
                    )}
                    {kind === 'pack' && dl && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={!dl.streamable}
                        onClick={() => navigate(`/watch/${dl.infoHash}?episode=${episodeToken(episode.seasonNumber, episode.episodeNumber)}`)}
                      >
                        <Play size={15} fill="currentColor" /> Watch episode
                      </button>
                    )}
                    {kind === 'download' && src && (
                      <button
                        type="button"
                        className="btn btn-white btn-sm"
                        onClick={() => openConfirm(`${episodeToken(episode.seasonNumber, episode.episodeNumber)} · ${episode.name || 'Episode'}`, src, episode.seasonNumber, episode.episodeNumber)}
                      >
                        <Plus size={15} /> Download
                      </button>
                    )}
                    {kind === 'noexact' && (
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        onClick={() =>
                          setSheet({
                            title: `${detail.title} · Season ${episode.seasonNumber}`,
                            subtitle: `All releases for ${episodeToken(episode.seasonNumber, episode.episodeNumber)}`,
                            scopeSources: seasonSources,
                            season: episode.seasonNumber,
                            episode: episode.episodeNumber,
                          })
                        }
                      >
                        <Search size={15} /> Pick from all results
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Confirm download sheet */}
      {confirm && (
        <div className="confirm-dialog" role="dialog" aria-modal="true" aria-label="Confirm download" onClick={() => setConfirm(null)}>
          <div className="confirm-card" onClick={(e) => e.stopPropagation()}>
            <h3>{confirm.scopeLabel}</h3>
            <p className="confirm-sub">
              {detail.title} will be downloaded from the release below. Confirm to start.
            </p>
            <div className="confirm-pick">
              <div>
                <div className="pick-title">{confirm.source.title}</div>
                <div style={{ marginTop: 6, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  {audioChipLabel(confirm.source) && (
                    <span className="chip chip-audio">{audioChipLabel(confirm.source)}</span>
                  )}
                  {pickQuality(confirm.source) && <span className="chip">{pickQuality(confirm.source)}</span>}
                  <span className="chip">{pickSummary(confirm.source)}</span>
                </div>
              </div>
            </div>
            <div className="confirm-actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setSheet({
                    title: `${detail.title}${confirm.season != null ? ` · Season ${confirm.season}` : ''}`,
                    subtitle: 'All releases',
                    scopeSources: mediaType === 'tv' ? seasonSources : movieSources,
                    season: confirm.season,
                    episode: confirm.episode,
                  });
                  setConfirm(null);
                }}
              >
                <SlidersHorizontal size={16} /> Advanced
              </button>
              <button type="button" className="btn btn-outline" onClick={() => setConfirm(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-white"
                onClick={() => addDownload(confirm.source, confirm.season, confirm.episode)}
              >
                <ArrowDownToLine size={16} /> Start download
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Advanced sources sheet */}
      {sheet && (
        <AdvancedSheet
          open
          title={sheet.title}
          subtitle={sheet.subtitle}
          sources={sheet.scopeSources}
          addedHashes={addedHashes}
          onPick={(source) => addDownload(source, sheet.season, sheet.episode)}
          onClose={() => setSheet(null)}
        />
      )}
    </div>
  );
}
