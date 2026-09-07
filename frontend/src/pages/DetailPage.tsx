import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowDownToLine,
  Trash2,
  Play,
  SlidersHorizontal,
  Search,
  Plus,
  Pause,
  MonitorPlay,
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
  externalPlayerUrl,
  humanEta,
  humanSize,
  humanSpeed,
  mediaDetails,
  pauseDownload,
  posterUrl,
  removeDownload,
  resumeDownload,
  seasonEpisodes,
  sources,
} from '../api';
import { SourceRow } from '../components/SourceRow';
import { StateBadge } from '../components/StateBadge';
import { ExternalPlayerLink } from '../components/ExternalPlayerLink';
import { RatingBadge } from '../components/RatingBadge';
import { activeFilterCount, filterSources, groupSources, sortSources } from '../lib/release';
import { chooseEpisodePick, chooseMoviePick, chooseSeasonPick, isWebExhibitable } from '../lib/coverage';
import { episodeToken } from '../lib/episode';
import { useDownloadsStore } from '../store/downloadsStore';
import { useToastStore } from '../store/toastStore';
import { useRecentsStore } from '../store/recentsStore';
import { useAudioLanguage } from '../store/settingsStore';
import { useFriendlyPickStore } from '../store/friendlyPickStore';
import { useVersionStore, versionKey } from '../store/versionStore';
import {
  bestPlayable,
  leadCopy,
  playable,
  sortVersions,
  versionLabel,
} from '../lib/versions';
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

/** Headline shown on the hero status card for a copy that isn't playable yet. */
function busyHeadline(copy: DownloadRecord, subject: string): string {
  switch (copy.state) {
    case 'error':
      return `${subject} failed to download.`;
    case 'paused':
      return `${subject} paused.`;
    case 'stalled':
      return `${subject} is stalled — still looking for peers.`;
    case 'checking':
      return `Checking ${subject}…`;
    case 'queued':
    case 'fetching-metadata':
      return `Adding ${subject}…`;
    default:
      return `Preparing ${subject}…`;
  }
}

/**
 * One source of truth for the movie/season hero when copies exist:
 *  - something playable → a single Watch button (+ Player / delete) with a
 *    version-chip row to switch which ready copy is "the" copy; copies still
 *    arriving are folded into compact mini-rows below.
 *  - nothing playable yet → a status card (big %, speed · ETA, state) for the
 *    focused copy, with a chip row to focus another when several are arriving.
 * Never renders a disabled Watch button.
 */
function DownloadsHeroPanel({
  copies,
  activeHash,
  anyPlayable,
  title,
  onSelect,
  onWatch,
  onPause,
  onResume,
  onTrash,
  onAddVersion,
}: {
  copies: DownloadRecord[];
  activeHash: string | null;
  anyPlayable: boolean;
  title: string;
  onSelect: (infoHash: string) => void;
  onWatch: (infoHash: string) => void;
  onPause: (infoHash: string) => void;
  onResume: (infoHash: string) => void;
  onTrash: (infoHash: string) => void;
  onAddVersion?: () => void;
}) {
  const activeCopy = copies.find((c) => c.infoHash === activeHash) ?? null;

  function chipFor(c: DownloadRecord, busyLabel: boolean): { id: string; label: string; active: boolean } {
    const label = busyLabel ? `${versionLabel(c)} · ${Math.round(c.progress * 100)}%` : versionLabel(c);
    return { id: c.infoHash, label, active: c.infoHash === activeHash };
  }

  if (anyPlayable) {
    const ready = copies.filter(playable);
    const busy = copies.filter((c) => !playable(c));
    const act = activeCopy && playable(activeCopy) ? activeCopy : bestPlayable(copies) ?? ready[0];
    if (!act) return null;
    return (
      <>
        {ready.length > 1 && (
          <div className="version-chip-row" role="group" aria-label="Choose which version to watch">
            {ready.map((c) => {
              const chip = chipFor(c, false);
              return (
                <button
                  key={c.infoHash}
                  type="button"
                  className={`version-chip ${chip.active ? 'active' : ''}`}
                  onClick={() => onSelect(c.infoHash)}
                >
                  {chip.label}
                </button>
              );
            })}
          </div>
        )}
        <div className="dh-extra">
          <button type="button" className="btn btn-white btn-lg" onClick={() => onWatch(act.infoHash)}>
            <Play size={20} fill="currentColor" /> Watch
          </button>
          <ExternalPlayerLink
            className="btn btn-outline btn-lg"
            href={externalPlayerUrl(act.infoHash)}
            title="Play in your local player (VLC / MPV, …)"
          >
            <MonitorPlay size={18} /> Player
          </ExternalPlayerLink>
          <StateBadge state={act.state} />
          <button
            type="button"
            className="icon-btn"
            aria-label="Delete this version"
            title="Delete this version"
            onClick={() => onTrash(act.infoHash)}
          >
            <Trash2 size={18} />
          </button>
          {onAddVersion && (
            <button type="button" className="btn btn-outline btn-lg" onClick={onAddVersion}>
              <Plus size={16} /> Add version
            </button>
          )}
        </div>
        {busy.length > 0 && (
          <div className="hero-mini-dl" aria-label="Copies still downloading">
            {busy.map((c) => (
              <div key={c.infoHash} className="hero-mini-row">
                <span className="hero-mini-label" title={versionLabel(c)}>
                  {versionLabel(c)}
                </span>
                <span className="hero-mini-pct">{Math.round(c.progress * 100)}%</span>
                {c.state === 'paused' ? (
                  <button type="button" className="icon-btn icon-btn-sm" aria-label="Resume" onClick={() => onResume(c.infoHash)}>
                    <Play size={14} fill="currentColor" />
                  </button>
                ) : (
                  <button type="button" className="icon-btn icon-btn-sm" aria-label="Pause" onClick={() => onPause(c.infoHash)}>
                    <Pause size={14} />
                  </button>
                )}
                <button
                  type="button"
                  className="icon-btn icon-btn-sm"
                  aria-label="Delete this version"
                  onClick={() => onTrash(c.infoHash)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </>
    );
  }

  const act = activeCopy ?? leadCopy(copies) ?? copies[0];
  if (!act) return null;
  return (
    <>
      <div className="hero-status" role="status">
        <div className="hero-status-head">
          <span className="hero-status-title">{busyHeadline(act, title)}</span>
          <StateBadge state={act.state} />
        </div>
        <div className="hero-status-bar">
          <span className="hero-status-pct">{Math.round(act.progress * 100)}%</span>
          <div className="progress-track hero-progress" aria-label={`${Math.round(act.progress * 100)}% downloaded`}>
            <div className="progress-fill" style={{ width: `${Math.round(act.progress * 100)}%` }} />
          </div>
        </div>
        <div className="hero-status-meta">
          <span>{humanSpeed(act.downloadSpeed)}</span>
          <span>ETA {humanEta(act.etaSeconds)}</span>
        </div>
        <div className="hero-status-actions">
          {act.state === 'paused' ? (
            <button type="button" className="btn btn-outline btn-sm" onClick={() => onResume(act.infoHash)}>
              <Play size={14} fill="currentColor" /> Resume
            </button>
          ) : act.state === 'downloading' || act.state === 'stalled' ? (
            <button type="button" className="btn btn-outline btn-sm" onClick={() => onPause(act.infoHash)}>
              <Pause size={14} /> Pause
            </button>
          ) : null}
          <button type="button" className="btn btn-danger-outline btn-sm" onClick={() => onTrash(act.infoHash)}>
            <Trash2 size={14} /> Remove
          </button>
          {onAddVersion && (
            <button type="button" className="btn btn-outline btn-sm" onClick={onAddVersion}>
              <Plus size={14} /> Add another
            </button>
          )}
        </div>
      </div>
      {copies.length > 1 && (
        <div className="version-chip-row" role="group" aria-label="Focus a download">
          {copies.map((c) => {
            const chip = chipFor(c, true);
            return (
              <button
                key={c.infoHash}
                type="button"
                className={`version-chip ${chip.active ? 'active' : ''}`}
                onClick={() => onSelect(c.infoHash)}
              >
                {chip.label}
              </button>
            );
          })}
        </div>
      )}
    </>
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
  const friendlyPickMode = useFriendlyPickStore((s) => s.mode);

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

  // Movie version state — which copy is "the" copy (see DownloadsHeroPanel).
  const sortedCopies = useMemo(
    () => (mediaType === 'movie' ? sortVersions(titleDownloads) : []),
    [titleDownloads, mediaType],
  );
  const playableCopies = useMemo(() => sortedCopies.filter(playable), [sortedCopies]);
  const anyPlayable = playableCopies.length > 0;
  const versionStoreKey = useMemo(() => versionKey('movie', id), [id]);
  const storedActive = useVersionStore((s) => s.active[versionStoreKey]);
  const selectVersion = useVersionStore((s) => s.select);
  const activeHash = useMemo(() => {
    if (mediaType !== 'movie' || sortedCopies.length === 0) return null;
    if (anyPlayable) {
      if (storedActive && playableCopies.some((c) => c.infoHash === storedActive)) return storedActive;
      return bestPlayable(sortedCopies)?.infoHash ?? null;
    }
    if (storedActive && sortedCopies.some((c) => c.infoHash === storedActive)) return storedActive;
    return leadCopy(sortedCopies)?.infoHash ?? null;
  }, [mediaType, sortedCopies, playableCopies, anyPlayable, storedActive]);

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
          imdbRating: media.imdbRating ?? null,
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
          const alreadyOwned = downloads.some((d) => d.tmdbId === id && d.mediaType === 'movie');
          if (alreadyOwned) {
            // Already have copies — don't re-ask Prowlarr just to show a Watch
            // button; sources resolve lazily if the user wants to add a version.
            setMovieLoading(false);
          } else {
            await loadMovieSources(media);
          }
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

  async function loadMovieSources(media: MediaDetail, override?: AudioLang): Promise<Source[]> {
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
      return res.sources;
    } catch (e) {
      setMovieSources([]);
      setMovieError(e instanceof Error ? e.message : 'Failed to search sources');
      return [];
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
      audioLang: source.audioLang ?? null,
      audioMode: source.audioMode ?? null,
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
    return chooseMoviePick(movieSources, friendlyPickMode);
  }

  function seasonFullPick(): Source | null {
    if (activeSeason == null) return null;
    return chooseSeasonPick(seasonSources, activeSeason, friendlyPickMode);
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
    const source = chooseEpisodePick(seasonSources, episode.seasonNumber, episode.episodeNumber, friendlyPickMode);
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

  async function pauseCopy(infoHash: string): Promise<void> {
    try {
      await pauseDownload(infoHash);
      toast('Paused', 'info');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Pause failed', 'error');
    }
  }

  async function resumeCopy(infoHash: string): Promise<void> {
    try {
      await resumeDownload(infoHash);
      toast('Resumed', 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Resume failed', 'error');
    }
  }

  function trashCopy(infoHash: string): void {
    const d = titleDownloads.find((x) => x.infoHash === infoHash);
    if (d) trashDownload(d);
  }

  function goWatch(infoHash: string): void {
    navigate(`/watch/${infoHash}`);
  }

  function selectMovieCopy(infoHash: string): void {
    selectVersion(versionStoreKey, infoHash);
  }

  function ensureMovieSources(): Promise<Source[]> {
    if (!detail) return Promise.resolve(movieSources);
    if (movieSources.length === 0 && !movieLoading) {
      return loadMovieSources(detail);
    }
    return Promise.resolve(movieSources);
  }

  async function openAddVersion(): Promise<void> {
    if (!detail) return;
    const srcs = await ensureMovieSources();
    if (srcs.length === 0) {
      toast(movieNoMatch ? 'No releases match this audio.' : 'No releases found.', 'info');
      return;
    }
    setSheet({ title: detail.title, subtitle: 'Choose another release', scopeSources: srcs, season: null, episode: null });
  }

  function openSeasonSheet(season: number): void {
    if (!detail) return;
    setSheet({
      title: `${detail.title} · Season ${season}`,
      subtitle: 'All releases',
      scopeSources: seasonSources,
      season,
      episode: null,
    });
  }

  // Lazy best-source search: once a movie has no copies (e.g. the last one was
  // removed) fetch sources so the hero returns to the offer state. Skipped while
  // copies exist — owned titles never re-ask Prowlarr on their own.
  useEffect(() => {
    if (mediaType !== 'movie' || !detail) return;
    const owned = downloads.some((d) => d.tmdbId === id && d.mediaType === 'movie');
    if (owned || movieSources.length > 0 || movieLoading || movieError) return;
    void loadMovieSources(detail);
  }, [detail, mediaType, id, downloads, movieSources, movieLoading, movieError, audio]);

  // Hero ground: the title's TMDB poster (backdrop when no poster exists),
  // blurred full-bleed so the page reads as a cinematic colour field that
  // matches the title. Displayed art comes from the single TMDB key (S8 proxy);
  // the OMDb poster pipeline is not used for on-screen art.
  const heroPoster = detail
    ? detail.posterPath
      ? posterUrl(detail.posterPath, 'w780')
      : backdropUrl(detail.backdropPath)
    : null;
  const [heroArtFailed, setHeroArtFailed] = useState({ media: false });
  useEffect(() => {
    setHeroArtFailed({ media: false });
  }, [heroPoster]);

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
        {heroPoster && !heroArtFailed.media && (
          <img
            className="hero-media"
            src={heroPoster}
            alt=""
            onError={() => setHeroArtFailed((s) => ({ ...s, media: true }))}
          />
        )}
        <div className="hero-overlay-l" aria-hidden="true" />
        <div className="hero-overlay-b" aria-hidden="true" />
        <div className="dh-content">
          <h1 className="dh-title">{detail.title}</h1>
          <div className="dh-meta">
            <span>{detail.year ?? '—'}</span>
            <span>{detail.genres.join(' · ')}</span>
            {detail.runtime != null && <span>{detail.runtime} min</span>}
            <RatingBadge value={detail.imdbRating} />
            {mediaType === 'tv' && <span className="dh-meta-chip">{seasons.length} Seasons</span>}
          </div>
          <p className="dh-overview">{detail.overview}</p>

          {mediaType === 'movie' ? (
            <div className="dh-actions">
              {titleDownloads.length > 0 ? (
                <DownloadsHeroPanel
                  copies={sortedCopies}
                  activeHash={activeHash}
                  anyPlayable={anyPlayable}
                  title={detail.title}
                  onSelect={selectMovieCopy}
                  onWatch={goWatch}
                  onPause={(h) => void pauseCopy(h)}
                  onResume={(h) => void resumeCopy(h)}
                  onTrash={trashCopy}
                  onAddVersion={() => void openAddVersion()}
                />
              ) : movieError ? (
                <div className="dh-extra">
                  <span className="inline-error">{movieError}</span>
                  <button type="button" className="btn btn-sm btn-outline" onClick={() => void loadMovieSources(detail)}>
                    Retry
                  </button>
                </div>
              ) : movieLoading ? (
                <button type="button" className="btn btn-white btn-lg" disabled>
                  <span className="spinner spinner-sm" aria-hidden="true" /> Finding the best release…
                </button>
              ) : movieSources.length > 0 ? (
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
              ) : (
                <>
                  <p className="dh-nosource">
                    {movieNoMatch
                      ? `No ${audioLanguageLabel(movieNoMatch)} audio releases found for this title.`
                      : 'No releases were found for this title.'}
                  </p>
                  <button
                    type="button"
                    className="btn btn-outline btn-lg"
                    onClick={() => void loadMovieSources(detail)}
                  >
                    <Search size={18} /> Search again
                  </button>
                </>
              )}
            </div>
          ) : (
            <div className="dh-actions">
              {activeSeason == null ? null : activePackDownload ? (
                <>
                  <DownloadsHeroPanel
                    copies={sortVersions([activePackDownload])}
                    activeHash={activePackDownload.infoHash}
                    anyPlayable={playable(activePackDownload)}
                    title={`${detail.title} · Season ${activeSeason}`}
                    onSelect={() => undefined}
                    onWatch={goWatch}
                    onPause={(h) => void pauseCopy(h)}
                    onResume={(h) => void resumeCopy(h)}
                    onTrash={trashCopy}
                  />
                  <button
                    type="button"
                    className="btn btn-ghost btn-lg"
                    onClick={() => openSeasonSheet(activeSeason)}
                  >
                    <SlidersHorizontal size={18} /> Browse releases
                  </button>
                </>
              ) : seasonLoading ? (
                <button type="button" className="btn btn-white btn-lg" disabled>
                  <span className="spinner spinner-sm" aria-hidden="true" /> Finding the best season pack…
                </button>
              ) : seasonFullPick() ? (
                <>
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
                  <button
                    type="button"
                    className="btn btn-ghost btn-lg"
                    onClick={() => openSeasonSheet(activeSeason)}
                  >
                    <SlidersHorizontal size={18} /> Browse releases
                  </button>
                </>
              ) : (
                <>
                  <p className="dh-nosource">
                    {activeSeason != null
                      ? `No season pack found for Season ${activeSeason}. Individual episodes may still be available below.`
                      : 'Choose a season to see its downloads.'}
                  </p>
                  {activeSeason != null && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-lg"
                      onClick={() => openSeasonSheet(activeSeason)}
                    >
                      <SlidersHorizontal size={18} /> Browse releases
                    </button>
                  )}
                </>
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
                  {friendlyPickMode === 'web-playable' && isWebExhibitable(confirm.source) && (
                    <span className="chip">Web-playable</span>
                  )}
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
