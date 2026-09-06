import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { TitleCard } from './TitleCard';
import { useSettingsStore } from '../store/settingsStore';
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

const FANART_ART: MediaItem = {
  ...FULL,
  art: { thumbUrl: 'https://fanart.tv/keyart.jpg', logoUrl: null },
};

const FANART_POSTER_ONLY: MediaItem = {
  ...FULL,
  posterPath: null,
  backdropPath: null,
  art: { thumbUrl: null, posterUrl: 'https://fanart.tv/poster.jpg', logoUrl: null },
};

const NO_ART: MediaItem = { ...FULL, posterPath: null, backdropPath: null };

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

function cardMedia(): HTMLImageElement | null {
  return document.querySelector('.title-card-media') as HTMLImageElement | null;
}

function setProvider(provider: 'tmdb' | 'fanart'): void {
  useSettingsStore.setState({ provider, fanartConfigured: provider === 'fanart', style: 'backdrop', ready: true });
}

function setStyle(style: 'backdrop' | 'poster'): void {
  useSettingsStore.setState({ provider: 'tmdb', fanartConfigured: false, style, ready: true });
}

beforeEach(() => {
  setProvider('tmdb');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('TitleCard', () => {
  it('renders Fanart key art in FanArt mode and never the TMDB backdrop', () => {
    setProvider('fanart');
    renderCard(FANART_ART);
    const img = cardMedia();
    expect(img?.src).toBe('https://fanart.tv/keyart.jpg');
    expect(img?.src).not.toContain('/api/images/tmdb/');
    expect(screen.getByRole('button', { name: /inception/i })).toBeInTheDocument();
  });

  it('uses the TMDB backdrop as the tile image', () => {
    renderCard(FULL);
    const img = cardMedia();
    expect(img?.src).toContain('/api/images/tmdb/w1280/backdrop.jpg');
    expect(screen.queryByRole('button', { name: /more info/i })).not.toBeInTheDocument();
  });

  it('shows a monogram tile when no artwork exists and keeps the whole card clickable', () => {
    renderCard(NO_ART);
    expect(document.querySelector('.title-card-fallback')?.textContent).toBe('I');
    expect(screen.getByRole('button', { name: /inception/i })).toBeInTheDocument();
  });

  it('uses the Fanart portrait poster in FanArt mode when no 16:9 thumb exists', () => {
    setProvider('fanart');
    renderCard(FANART_POSTER_ONLY);
    const img = cardMedia();
    expect(img?.src).toBe('https://fanart.tv/poster.jpg');
    expect(document.querySelector('.title-card-fallback')).toBeNull();
  });

  it('shows a monogram in FanArt mode when Fanart has no art (no TMDB rescue)', () => {
    setProvider('fanart');
    renderCard(FULL);
    expect(document.querySelector('.title-card-fallback')?.textContent).toBe('I');
    expect(document.querySelector('.title-card-media')).toBeNull();
  });

  it('falls back to a monogram when the last Fanart image fails to load', () => {
    setProvider('fanart');
    renderCard(FANART_ART);
    fireEvent.error(cardMedia()!);
    expect(document.querySelector('.title-card-media')).toBeNull();
    expect(document.querySelector('.title-card-fallback')).not.toBeNull();
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

describe('TitleCard poster-first style (D17)', () => {
  beforeEach(() => {
    setStyle('poster');
  });

  it('layers a ground image and a centered poster figure', () => {
    renderCard(FULL);
    const figure = document.querySelector('.title-card-figure') as HTMLImageElement | null;
    const ground = document.querySelector('.title-card-bg') as HTMLImageElement | null;
    expect(document.querySelector('.title-card-poster')).not.toBeNull();
    // The local S8b cache is the first figure candidate.
    expect(figure?.src).toContain('/api/images/art/movie/27205/poster');
    // The 16:9 backdrop is the first ground candidate when no Fanart thumb exists.
    expect(ground?.src).toContain('/api/images/tmdb/w1280/backdrop.jpg');
  });

  it('falls the figure back to the TMDB w780 poster when the local file 404s', () => {
    renderCard(FULL);
    const figure = document.querySelector('.title-card-figure') as HTMLImageElement | null;
    fireEvent.error(figure!);
    const next = document.querySelector('.title-card-figure') as HTMLImageElement | null;
    expect(next?.src).toContain('/api/images/tmdb/w780/poster.jpg');
  });

  it('shows the monogram and an empty ground when there is no art at all', () => {
    renderCard(NO_ART);
    expect(document.querySelector('.title-card-figure')).toBeNull();
    expect(document.querySelector('.title-card-bg-empty')).not.toBeNull();
    expect(document.querySelector('.title-card-fallback')?.textContent).toBe('I');
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
});
