import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { TitleCard } from './TitleCard';
import { hoverCardFor } from '../api';
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
};

const MOVIE_HOVER: HoverCardInfo = {
  trailer: { provider: 'youtube', videoId: 'abc', name: null },
  genres: ['Sci-Fi', 'Action'],
  runtime: 148,
  seasons: null,
  certification: 'PG-13',
};

const TV_HOVER: HoverCardInfo = {
  trailer: { provider: 'youtube', videoId: 'tvabc', name: null },
  genres: ['Psychological', 'Drama'],
  runtime: null,
  seasons: 2,
  certification: 'TV-MA',
};

const NO_TRAILER_HOVER: HoverCardInfo = {
  trailer: null,
  genres: ['Drama'],
  runtime: 121,
  seasons: null,
  certification: 'R',
};

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

/** Number of retries before the poster art gives up (mirrors TitleCard consts). */
const POSTER_RETRIES = 4;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('TitleCard', () => {
  it('renders the OMDb portrait composite: blurred ground + crisp centered figure', () => {
    renderCard(FULL);
    const card = document.querySelector('.title-card-poster');
    const figure = document.querySelector('.title-card-figure') as HTMLImageElement | null;
    const ground = document.querySelector('.title-card-bg') as HTMLImageElement | null;
    expect(card).not.toBeNull();
    // Both layers come from the local art-volume poster — never TMDB/FanArt.
    expect(figure?.src).toContain('/api/images/art/movie/27205/poster');
    expect(ground?.src).toContain('/api/images/art/movie/27205/poster');
    expect(figure?.src).not.toContain('/api/images/tmdb/');
    expect(screen.getByRole('button', { name: /inception/i })).toBeInTheDocument();
  });

  it('shows the monogram and empty ground once the poster gives up after retries', async () => {
    vi.useFakeTimers();
    try {
      renderCard(FULL);
      for (let i = 0; i <= POSTER_RETRIES; i += 1) {
        const figure = document.querySelector('.title-card-figure') as HTMLImageElement | null;
        if (!figure) break;
        fireEvent.error(figure);
        await act(async () => {
          await vi.advanceTimersByTimeAsync(1600);
        });
      }
      await act(async () => {});
      expect(document.querySelector('.title-card-figure')).toBeNull();
      expect(document.querySelector('.title-card-bg-empty')).not.toBeNull();
      expect(document.querySelector('.title-card-fallback')?.textContent).toBe('I');
    } finally {
      vi.useRealTimers();
    }
  });

  it('renders an optional primary quick action without any info button', () => {
    const primary = { label: 'Watch', icon: 'play' as const, onClick: vi.fn() };
    render(
      <MemoryRouter>
        <TitleCard item={FULL} primary={primary} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: 'Watch' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /more info/i })).not.toBeInTheDocument();
  });
});

describe('TitleCard expanded hover card (D20)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockHoverCardFor.mockReset();
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
    expect(pop?.querySelector('.tc-pop-title-text')?.textContent).toBe('Inception');
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

    await hoverFor(card, 300);
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

  it('expands with still artwork and details when the title has no trailer', async () => {
    mockHoverCardFor.mockResolvedValue(NO_TRAILER_HOVER);
    renderCard(FULL);
    const card = screen.getByRole('button', { name: /inception/i });
    await hoverFor(card, 600);

    const pop = document.querySelector('.tc-pop') as HTMLElement | null;
    expect(pop).not.toBeNull();
    expect(pop?.querySelector('.tc-pop-video')).toBeNull();
    expect(pop?.querySelector('.tc-pop-art')).not.toBeNull();
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
  });

  it('keeps the card static when the hover payload cannot be resolved', async () => {
    mockHoverCardFor.mockResolvedValue(null);
    renderCard(FULL);
    const card = screen.getByRole('button', { name: /inception/i });
    await hoverFor(card, 600);

    expect(mockHoverCardFor).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.tc-pop')).toBeNull();
  });

  it('does not expand for reduced-motion users', async () => {
    const mm = (query: string): MediaQueryList =>
      ({ matches: true, media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false }) as unknown as MediaQueryList;
    vi.spyOn(window, 'matchMedia').mockImplementation(mm);
    mockHoverCardFor.mockResolvedValue(MOVIE_HOVER);
    renderCard(FULL);
    const card = screen.getByRole('button', { name: /inception/i });
    await hoverFor(card, 600);

    expect(mockHoverCardFor).not.toHaveBeenCalled();
    expect(document.querySelector('.tc-pop')).toBeNull();
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
