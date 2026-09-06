import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import { TitleCard } from './TitleCard';
import { useSettingsStore } from '../store/settingsStore';
import type { MediaItem } from '../types';

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
  useSettingsStore.setState({ provider, fanartConfigured: provider === 'fanart', ready: true });
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
