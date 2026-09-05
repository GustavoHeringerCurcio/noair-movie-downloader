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

  it('never falls back to a TMDB backdrop in FanArt mode when key art is missing', () => {
    setProvider('fanart');
    renderCard(FULL);
    expect(cardMedia()).toBeNull();
    expect(document.querySelector('.title-card-fallback')?.textContent).toBe('I');
  });

  it('falls back to the monogram when a FanArt image errors instead of swapping to TMDB', () => {
    setProvider('fanart');
    renderCard(FANART_ART);
    fireEvent.error(cardMedia()!);
    expect(cardMedia()).toBeNull();
    expect(document.querySelector('.title-card-fallback')?.textContent).toBe('I');
    const all = Array.from(document.querySelectorAll<HTMLImageElement>('img'));
    expect(all.every((i) => i.src.includes('fanart.tv'))).toBe(true);
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
