import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import { TitleCard } from './TitleCard';
import { useSettingsStore } from '../store/settingsStore';
import { trailerFor } from '../api';
import type { MediaItem } from '../types';

vi.mock('../api', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../api')>();
  return { ...mod, trailerFor: vi.fn() };
});

const mockTrailerFor = vi.mocked(trailerFor);

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

function renderCard(item: MediaItem): void {
  render(
    <MemoryRouter>
      <TitleCard item={item} />
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

describe('TitleCard hover-trailer preview (D18)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockTrailerFor.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function hoverFor(card: HTMLElement, ms: number): Promise<void> {
    fireEvent.mouseEnter(card);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  it('starts the muted embed after a sustained hover and stops on leave', async () => {
    mockTrailerFor.mockResolvedValue({ provider: 'youtube', videoId: 'abc', name: null });
    renderCard(FULL);
    const card = screen.getByRole('button', { name: /inception/i });

    await hoverFor(card, 600);
    await act(async () => {});

    expect(mockTrailerFor).toHaveBeenCalledTimes(1);
    expect(mockTrailerFor).toHaveBeenCalledWith({ tmdbId: 27205, mediaType: 'movie' });
    const iframe = document.querySelector('.title-card-trailer') as HTMLIFrameElement | null;
    expect(iframe?.src).toContain('youtube-nocookie.com/embed/abc');
    expect(iframe?.src).toContain('autoplay=1');
    expect(iframe?.src).toContain('mute=1');

    fireEvent.mouseLeave(card);
    await act(async () => {});
    expect(document.querySelector('.title-card-trailer')).toBeNull();
  });

  it('does not fetch on a quick hover sweep', async () => {
    mockTrailerFor.mockResolvedValue(null);
    renderCard(FULL);
    const card = screen.getByRole('button', { name: /inception/i });

    await hoverFor(card, 300);
    fireEvent.mouseLeave(card);
    await act(async () => {});

    expect(mockTrailerFor).not.toHaveBeenCalled();
  });

  it('keeps the card static when the title has no trailer', async () => {
    mockTrailerFor.mockResolvedValue(null);
    renderCard(FULL);
    const card = screen.getByRole('button', { name: /inception/i });

    await hoverFor(card, 600);
    await act(async () => {});

    expect(mockTrailerFor).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.title-card-trailer')).toBeNull();

    fireEvent.mouseLeave(card);
    fireEvent.mouseEnter(card);
    await hoverFor(card, 600);
    await act(async () => {});
    expect(mockTrailerFor).toHaveBeenCalledTimes(1);
  });
});
