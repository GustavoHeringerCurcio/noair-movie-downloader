import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { TitleCard } from './TitleCard';
import { hoverCardFor } from '../api';
import { usePosterStyleStore } from '../store/posterStyleStore';
import { usePosterImdbStore } from '../store/posterImdbStore';
import type { HoverCardInfo, MediaItem } from '../types';

vi.mock('../api', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../api')>();
  return { ...mod, hoverCardFor: vi.fn() };
});

const mockHoverCardFor = vi.mocked(hoverCardFor);

const FULL: MediaItem = {
  tmdbId: 27205,
  mediaType: 'movie',
  title: 'Inception',
  year: 2010,
  posterPath: '/poster.jpg',
  backdropPath: '/backdrop.jpg',
  overview: '',
  voteAverage: 8.4,
  imdbRating: 8.8,
};

const MOVIE_HOVER: HoverCardInfo = {
  trailer: { provider: 'youtube', videoId: 'abc', name: null },
  genres: ['Sci-Fi', 'Action'],
  runtime: 148,
  seasons: null,
  certification: 'PG-13',
  imdbRating: 8.8,
};

const TV_HOVER: HoverCardInfo = {
  trailer: { provider: 'youtube', videoId: 'tvabc', name: null },
  genres: ['Psychological', 'Drama'],
  runtime: null,
  seasons: 2,
  certification: 'TV-MA',
  imdbRating: 8.7,
};

const NO_TRAILER_HOVER: HoverCardInfo = {
  trailer: null,
  genres: ['Drama'],
  runtime: 121,
  seasons: null,
  certification: 'R',
  imdbRating: null,
};

/** Mirror the retry budget in TitleCard so error sequences exhaust correctly. */
const ART_RETRIES = 2;

function renderCard(item: MediaItem): void {
  render(
    <MemoryRouter>
      <TitleCard item={item} />
    </MemoryRouter>,
  );
}

function renderNav(item: MediaItem): void {
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<TitleCard item={item} />} />
        <Route path="/media/:id" element={<div>DETAIL PAGE</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

function fanartImage(): HTMLImageElement | null {
  return document.querySelector('.tc-art-main') as HTMLImageElement | null;
}

/** Fire `error` on the current main-art <img>, retrying until it gives up. */
async function exhaustMainArt(): Promise<void> {
  vi.useFakeTimers();
  try {
    for (let i = 0; i <= ART_RETRIES; i += 1) {
      const img = fanartImage();
      if (!img) break;
      fireEvent.error(img);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(900);
      });
    }
    await act(async () => {});
  } finally {
    vi.useRealTimers();
  }
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  // Reset to the app defaults (vertical 2:3 + IMDb badge shown) so every test starts clean.
  usePosterStyleStore.setState({ style: 'vertical' });
  usePosterImdbStore.setState({ show: true });
});

describe('TitleCard artwork (horizontal 16:9 poster mode)', () => {
  beforeEach(() => {
    usePosterStyleStore.setState({ style: 'horizontal' });
  });

  it('renders the horizontal poster look: fanart key-art over a typography mark', () => {
    renderCard(FULL);
    const card = document.querySelector('.title-card');
    const art = fanartImage();
    expect(card?.className).toContain('title-card-horiz');
    expect(card?.className).not.toContain('title-card-vert');
    // Wide art comes from the fanart route — never the OMDb portrait pipeline.
    expect(art?.src).toContain('/api/images/fanart/movie/27205/thumb');
    expect(art?.src).not.toContain('/api/images/tmdb/');
    // Strong typography mark always underpins the art.
    const mark = document.querySelector('.title-card-mark');
    expect(mark).not.toBeNull();
    expect(mark?.textContent).toContain('Inception');
    expect(screen.getByRole('button', { name: /inception/i })).toBeInTheDocument();
  });

  it('falls back to the TMDB backdrop (no OMDb composite) when the fanart art is missing', async () => {
    renderCard(FULL);
    await exhaustMainArt();
    // No more blurred-ground + floating-figure treatment; the fallback layer is
    // the plain TMDB backdrop behind the typography mark.
    expect(fanartImage()).toBeNull();
    const backdrop = document.querySelector('.tc-art-backdrop') as HTMLImageElement | null;
    expect(backdrop).not.toBeNull();
    expect(backdrop?.src).toContain('/api/images/tmdb/w1280/backdrop.jpg');
    expect(backdrop?.src).not.toContain('/api/images/art/movie/27205/poster');
    expect(document.querySelector('.title-card-mark')?.textContent).toContain('Inception');
  });

  it('reveals the transparent logo over the backdrop and hides the mark text when it loads', async () => {
    renderCard(FULL);
    await exhaustMainArt();
    const backdrop = document.querySelector('.tc-art-backdrop') as HTMLImageElement | null;
    expect(backdrop).not.toBeNull();
    fireEvent.load(backdrop!);
    await act(async () => {});
    // The logo is requested only once the backdrop is actually showing.
    const logo = document.querySelector('.tc-logo') as HTMLImageElement | null;
    expect(logo).not.toBeNull();
    expect(logo?.src).toContain('/api/images/art/movie/27205/logo');
    fireEvent.load(logo!);
    await act(async () => {});
    expect(document.querySelector('.title-card')?.className).toContain('tc-logo-on');
    expect(document.querySelector('.title-card-mark')?.className).toContain('title-card-mark');
  });

  it('uses bold typography (never a bare monogram) when no art source exists at all', async () => {
    const bare: MediaItem = { ...FULL, backdropPath: null, posterPath: null };
    renderCard(bare);
    await exhaustMainArt();
    const card = document.querySelector('.title-card');
    expect(card?.className).toContain('tc-noart');
    expect(document.querySelector('.tc-art-backdrop')).toBeNull();
    const mark = document.querySelector('.title-card-mark');
    expect(mark).not.toBeNull();
    // The monogram letter is part of the composed typography, with the title.
    expect(document.querySelector('.tc-mark-letter')?.textContent).toBe('I');
    expect(mark?.textContent).toContain('Inception');
  });
});

describe('TitleCard artwork (T-002 vertical 2:3 mode)', () => {
  it('renders the raw TMDB poster at 2:3 with no fanart/backdrop tiers', () => {
    usePosterStyleStore.setState({ style: 'vertical' });
    renderCard(FULL);
    const card = document.querySelector('.title-card');
    expect(card?.className).toContain('title-card-vert');
    const poster = document.querySelector('.tc-art-poster') as HTMLImageElement | null;
    expect(poster).not.toBeNull();
    expect(poster?.src).toContain('/api/images/tmdb/w780/poster.jpg');
    expect(fanartImage()).toBeNull();
    expect(document.querySelector('.tc-art-backdrop')).toBeNull();
    expect(document.querySelector('.tc-logo')).toBeNull();
    // No blurred ground / floating portrait figure in vertical mode either.
    expect(document.querySelector('.title-card-figure')).toBeNull();
  });

  it('degrades a poster-less title to the centered typography mark', async () => {
    usePosterStyleStore.setState({ style: 'vertical' });
    const bare: MediaItem = { ...FULL, posterPath: null, backdropPath: null };
    renderCard(bare);
    await exhaustMainArt();
    // In vertical mode there is no fanart tier, so the poster <img> never
    // appears; the mark is the sole content.
    expect(document.querySelector('.tc-art-poster')).toBeNull();
    const card = document.querySelector('.title-card');
    expect(card?.className).toContain('title-card-vert');
    expect(document.querySelector('.title-card-mark')?.textContent).toContain('Inception');
  });
});

describe('TitleCard IMDb poster badge', () => {
  it('shows an IMDb mark + rating bottom-left when the item carries a cached score', () => {
    renderCard({ ...FULL, imdbRating: 8.3 });
    const pill = document.querySelector('.tc-imdb');
    expect(pill).not.toBeNull();
    expect(pill?.getAttribute('aria-label')).toBe('IMDb rating 8.3');
    expect(pill?.querySelector('.tc-imdb-mark')?.textContent).toBe('IMDb');
    expect(pill?.querySelector('.tc-imdb-value')?.textContent).toBe('8.3');
  });

  it('renders no pill when the user turns the setting off', () => {
    usePosterImdbStore.setState({ show: false });
    renderCard(FULL);
    expect(document.querySelector('.tc-imdb')).toBeNull();
  });

  it('renders no pill (and no empty slot) when the item has no cached score', () => {
    renderCard({ ...FULL, imdbRating: null });
    expect(document.querySelector('.tc-imdb')).toBeNull();
  });

  it('shows the badge in the horizontal 16:9 poster mode too', () => {
    usePosterStyleStore.setState({ style: 'horizontal' });
    renderCard({ ...FULL, imdbRating: 9.0 });
    expect(document.querySelector('.tc-imdb-value')?.textContent).toBe('9.0');
  });
});

describe('TitleCard expanded hover card (D20)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockHoverCardFor.mockReset();
    // The pop-up/art stills are asserted against the 16:9 fanart key-art look;
    // vertical-mode geometry has its own dedicated case below.
    usePosterStyleStore.setState({ style: 'horizontal' });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function hoverFor(card: HTMLElement, ms: number): Promise<void> {
    fireEvent.mouseEnter(card);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
    await act(async () => {});
  }

  it('opens the expanded card after a sustained hover and plays sound on by default', async () => {
    mockHoverCardFor.mockResolvedValue(MOVIE_HOVER);
    renderCard(FULL);
    const card = screen.getByRole('button', { name: /inception/i });

    await hoverFor(card, 600);

    expect(mockHoverCardFor).toHaveBeenCalledTimes(1);
    expect(mockHoverCardFor).toHaveBeenCalledWith({ tmdbId: 27205, mediaType: 'movie' });
    const pop = document.querySelector('.tc-pop') as HTMLElement | null;
    expect(pop).not.toBeNull();
    expect(pop?.className).toContain('tc-pop-horiz');
    expect(pop?.className).not.toContain('tc-pop-vert');
    expect(pop?.querySelector('.tc-pop-title-text')?.textContent).toBe('Inception');
    expect(pop?.querySelector('.tc-pop-meta .rating-badge')?.textContent).toContain('8.8');
    expect(screen.getByRole('img', { name: 'IMDb rating 8.8' })).toBeInTheDocument();
    const video = pop?.querySelector('.tc-pop-video') as HTMLIFrameElement | null;
    expect(video?.src).toContain('youtube-nocookie.com/embed/abc');
    expect(video?.src).toContain('autoplay=1');
    expect(video?.src).toContain('mute=0');
    expect(screen.getByRole('button', { name: 'Mute preview' })).toBeInTheDocument();

    fireEvent.mouseLeave(card);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(document.querySelector('.tc-pop')).toBeNull();
  });

  it('does not fetch or expand on a quick hover sweep', async () => {
    mockHoverCardFor.mockResolvedValue(null);
    renderCard(FULL);
    const card = screen.getByRole('button', { name: /inception/i });

    await hoverFor(card, 100);
    fireEvent.mouseLeave(card);
    await act(async () => {});

    expect(mockHoverCardFor).not.toHaveBeenCalled();
    expect(document.querySelector('.tc-pop')).toBeNull();
  });

  it('toggles the mute state and remounts the embed with mute=1', async () => {
    mockHoverCardFor.mockResolvedValue(MOVIE_HOVER);
    renderCard(FULL);
    const card = screen.getByRole('button', { name: /inception/i });
    await hoverFor(card, 600);

    fireEvent.click(screen.getByRole('button', { name: 'Mute preview' }));
    await act(async () => {});
    expect(screen.getByRole('button', { name: 'Unmute preview' })).toBeInTheDocument();
    const video = document.querySelector('.tc-pop-video') as HTMLIFrameElement | null;
    expect(video?.src).toContain('mute=1');

    fireEvent.click(screen.getByRole('button', { name: 'Unmute preview' }));
    await act(async () => {});
    const again = document.querySelector('.tc-pop-video') as HTMLIFrameElement | null;
    expect(again?.src).toContain('mute=0');
  });

  it('expands with the key-art still and details when the title has no trailer', async () => {
    mockHoverCardFor.mockResolvedValue(NO_TRAILER_HOVER);
    renderCard(FULL);
    // The pop-up still uses the art that actually painted the card — make the
    // fanart thumb resolve first (it also covers the typography mark).
    const art = fanartImage();
    expect(art).not.toBeNull();
    fireEvent.load(art!);
    await act(async () => {});

    const card = screen.getByRole('button', { name: /inception/i });
    await hoverFor(card, 600);

    const pop = document.querySelector('.tc-pop') as HTMLElement | null;
    expect(pop).not.toBeNull();
    expect(pop?.querySelector('.tc-pop-video')).toBeNull();
    const still = pop?.querySelector('.tc-pop-art') as HTMLImageElement | null;
    expect(still).not.toBeNull();
    expect(still?.src).toContain('/api/images/fanart/movie/27205/thumb');
    expect(screen.queryByRole('button', { name: 'Mute preview' })).not.toBeInTheDocument();
    expect(screen.getByText('R')).toBeInTheDocument();
    expect(screen.getByText('2h 1m')).toBeInTheDocument();
    expect(screen.getByText('HD')).toBeInTheDocument();
    expect(screen.getByText('Drama')).toBeInTheDocument();
  });

  it('renders season metadata for a tv title', async () => {
    const tvItem: MediaItem = { ...FULL, mediaType: 'tv', title: 'Fallout' };
    mockHoverCardFor.mockResolvedValue(TV_HOVER);
    renderCard(tvItem);
    const card = screen.getByRole('button', { name: /fallout/i });
    await hoverFor(card, 600);

    expect(screen.getByText('TV-MA')).toBeInTheDocument();
    expect(screen.getByText('2 Seasons')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'IMDb rating 8.7' })).toBeInTheDocument();
  });

  it('omits the rating chip entirely when no IMDb score is cached', async () => {
    mockHoverCardFor.mockResolvedValue(NO_TRAILER_HOVER);
    renderCard(FULL);
    const card = screen.getByRole('button', { name: /inception/i });
    await hoverFor(card, 600);

    expect(document.querySelector('.tc-pop')).not.toBeNull();
    expect(document.querySelector('.tc-pop-meta .rating-badge')).toBeNull();
    expect(screen.queryByRole('img', { name: /imdb rating/i })).not.toBeInTheDocument();
    // The rest of the meta row is untouched.
    expect(screen.getByText('R')).toBeInTheDocument();
    expect(screen.getByText('HD')).toBeInTheDocument();
  });

  it('keeps the card static when the hover payload cannot be resolved', async () => {
    mockHoverCardFor.mockResolvedValue(null);
    renderCard(FULL);
    const card = screen.getByRole('button', { name: /inception/i });
    await hoverFor(card, 600);

    expect(mockHoverCardFor).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.tc-pop')).toBeNull();
  });

  it('opens the pop-up for reduced-motion users with a static trailer frame (no autoplay)', async () => {
    const mm = (query: string): MediaQueryList =>
      ({ matches: true, media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false }) as unknown as MediaQueryList;
    vi.spyOn(window, 'matchMedia').mockImplementation(mm);
    mockHoverCardFor.mockResolvedValue(MOVIE_HOVER);
    renderCard(FULL);
    const card = screen.getByRole('button', { name: /inception/i });
    await hoverFor(card, 600);

    expect(mockHoverCardFor).toHaveBeenCalledTimes(1);
    const pop = document.querySelector('.tc-pop');
    expect(pop).not.toBeNull();
    // The trailer is never autoplayed: no <iframe>, no sound toggle.
    expect(pop?.querySelector('.tc-pop-video')).toBeNull();
    expect(pop?.querySelector('.tc-pop-sound')).toBeNull();
    // A static YouTube first-frame stands in for the video.
    const still = pop?.querySelector('img.tc-pop-art') as HTMLImageElement | null;
    expect(still?.src).toContain('i.ytimg.com/vi/abc/');
    // The info pop-up itself is fully functional.
    expect(pop?.querySelector('.tc-pop-details')).not.toBeNull();
    expect(pop?.querySelector('.tc-pop-meta')).not.toBeNull();
  });

  it('keeps an art still under the trailer embed until it reports ready, then crossfades it in', async () => {
    mockHoverCardFor.mockResolvedValue(MOVIE_HOVER);
    renderCard(FULL);
    const card = screen.getByRole('button', { name: /inception/i });
    await hoverFor(card, 600);

    const pop = document.querySelector('.tc-pop') as HTMLElement | null;
    expect(pop).not.toBeNull();
    // While the embed buffers, the still base layer is in the DOM and the
    // autoplaying iframe sits above it hidden (no is-ready yet).
    expect(pop?.querySelector('img.tc-pop-art')).not.toBeNull();
    const video = pop?.querySelector('.tc-pop-video') as HTMLIFrameElement | null;
    expect(video).not.toBeNull();
    expect(video?.className).not.toContain('is-ready');

    fireEvent.load(video!);
    await act(async () => {});
    expect(document.querySelector('.tc-pop-video')?.className).toContain('is-ready');
  });

  it('triggers the primary watch action from the pop-up Play button', async () => {
    mockHoverCardFor.mockResolvedValue(MOVIE_HOVER);
    const onClick = vi.fn();
    render(
      <MemoryRouter>
        <TitleCard item={FULL} primary={{ label: 'Watch', icon: 'play', onClick }} />
      </MemoryRouter>,
    );
    const card = screen.getByRole('button', { name: /inception/i });
    await hoverFor(card, 600);

    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('opens the detail page from the pop-up More Info button', async () => {
    mockHoverCardFor.mockResolvedValue(MOVIE_HOVER);
    renderNav(FULL);
    const card = screen.getByRole('button', { name: /inception/i });
    await hoverFor(card, 600);

    fireEvent.click(screen.getByRole('button', { name: 'More info' }));
    await act(async () => {});
    expect(screen.getByText('DETAIL PAGE')).toBeInTheDocument();
  });

  it('shows the Netflix-style action row: Play, Add to list, Rate and More Info', async () => {
    mockHoverCardFor.mockResolvedValue(MOVIE_HOVER);
    renderCard(FULL);
    const card = screen.getByRole('button', { name: /inception/i });
    await hoverFor(card, 600);

    const pop = document.querySelector('.tc-pop') as HTMLElement | null;
    expect(pop).not.toBeNull();
    const labels = Array.from(pop?.querySelectorAll('.tc-pop-actions button') ?? []).map((b) =>
      b.getAttribute('aria-label'),
    );
    expect(labels).toEqual(['Play', 'Add to list', 'Rate', 'More info']);
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add to list' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rate' })).toBeInTheDocument();
  });

  it('swaps the Rate circle for a working trash that removes the download', async () => {
    mockHoverCardFor.mockResolvedValue(MOVIE_HOVER);
    const onRemove = vi.fn();
    render(
      <MemoryRouter>
        <TitleCard
          item={FULL}
          primary={{ label: 'Watch', icon: 'play', onClick: () => {} }}
          onRemoveDownload={onRemove}
        />
      </MemoryRouter>,
    );
    const card = screen.getByRole('button', { name: /inception/i });
    await hoverFor(card, 600);

    expect(screen.getByRole('button', { name: 'Remove download' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Rate' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Remove download' }));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('keeps version chips on their own row under the pop-up actions', async () => {
    mockHoverCardFor.mockResolvedValue(MOVIE_HOVER);
    const onVariantSelect = vi.fn();
    render(
      <MemoryRouter>
        <TitleCard
          item={FULL}
          variants={[
            { id: 'v1', label: '1080p', active: true },
            { id: 'v2', label: '4K', active: false },
          ]}
          onVariantSelect={onVariantSelect}
        />
      </MemoryRouter>,
    );
    const card = screen.getByRole('button', { name: /inception/i });
    await hoverFor(card, 600);

    const chips = document.querySelector('.tc-pop-variants');
    expect(chips).not.toBeNull();
    expect(chips?.querySelectorAll('.tc-version-chip')).toHaveLength(2);
    expect(document.querySelector('.tc-pop-actions')?.contains(chips)).toBe(false);
  });

  it('keeps the pop open when moving the pointer from the card onto it', async () => {
    mockHoverCardFor.mockResolvedValue(MOVIE_HOVER);
    renderCard(FULL);
    const card = screen.getByRole('button', { name: /inception/i });
    await hoverFor(card, 600);

    fireEvent.mouseLeave(card);
    fireEvent.mouseEnter(document.querySelector('.tc-pop')!);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(document.querySelector('.tc-pop')).not.toBeNull();
  });

  it('opens correctly on a vertical 2:3 card', async () => {
    usePosterStyleStore.setState({ style: 'vertical' });
    mockHoverCardFor.mockResolvedValue(MOVIE_HOVER);
    renderCard(FULL);
    const card = screen.getByRole('button', { name: /inception/i });
    await hoverFor(card, 600);

    const pop = document.querySelector('.tc-pop') as HTMLElement | null;
    expect(pop).not.toBeNull();
    expect(pop?.className).toContain('tc-pop-vert');
    const popStyle = pop?.getAttribute('style') ?? '';
    // Width comes from the (2:3) base-card measurement; never NaN/empty.
    expect(popStyle).toMatch(/width:\s*\d+px/);
    expect(document.querySelector('.tc-pop-video')).not.toBeNull();
  });

  it('closes the preview when the window loses focus so the trailer cannot keep playing', async () => {
    mockHoverCardFor.mockResolvedValue(MOVIE_HOVER);
    renderCard(FULL);
    const card = screen.getByRole('button', { name: /inception/i });
    await hoverFor(card, 600);
    expect(document.querySelector('.tc-pop-video')).not.toBeNull();

    fireEvent.blur(window);
    await act(async () => {});
    expect(document.querySelector('.tc-pop')).toBeNull();
    expect(document.querySelector('.tc-pop-video')).toBeNull();
  });

  it('closes the preview when the tab is hidden so no trailer audio keeps playing', async () => {
    mockHoverCardFor.mockResolvedValue(MOVIE_HOVER);
    renderCard(FULL);
    const card = screen.getByRole('button', { name: /inception/i });
    await hoverFor(card, 600);
    expect(document.querySelector('.tc-pop-video')).not.toBeNull();

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    try {
      fireEvent(document, new Event('visibilitychange'));
      await act(async () => {});
      expect(document.querySelector('.tc-pop')).toBeNull();
    } finally {
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    }
  });

  it('keeps a single preview open: expanding a second card closes the first', async () => {
    mockHoverCardFor.mockResolvedValue(MOVIE_HOVER);
    const other: MediaItem = { ...FULL, tmdbId: 603, title: 'The Matrix' };
    render(
      <MemoryRouter>
        <div>
          <TitleCard item={FULL} />
          <TitleCard item={other} />
        </div>
      </MemoryRouter>,
    );
    const first = screen.getByRole('button', { name: /inception/i });
    const second = screen.getByRole('button', { name: /matrix/i });
    await hoverFor(first, 600);
    expect(document.querySelector('.tc-pop-title-text')?.textContent).toBe('Inception');

    fireEvent.mouseEnter(second);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    await act(async () => {});

    const pops = document.querySelectorAll('.tc-pop');
    expect(pops).toHaveLength(1);
    expect(pops[0]?.querySelector('.tc-pop-title-text')?.textContent).toBe('The Matrix');
  });
});
