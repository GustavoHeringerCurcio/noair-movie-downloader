import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import { TitleCard } from './TitleCard';
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

const BACKDROP_ONLY: MediaItem = { ...FULL, posterPath: null };
const NO_ART: MediaItem = { ...FULL, posterPath: null, backdropPath: null };

function renderCard(item: MediaItem): void {
  render(
    <MemoryRouter>
      <TitleCard item={item} />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('TitleCard', () => {
  it('renders a sharp centered poster over a blurred backdrop', () => {
    renderCard(FULL);
    expect(document.querySelector('.title-card-poster')).not.toBeNull();
    expect(document.querySelector('.title-card-bg')).not.toBeNull();
    expect(screen.getByRole('button', { name: /inception/i })).toBeInTheDocument();
  });

  it('falls back to a full-bleed image with a caption when only a backdrop exists', () => {
    renderCard(BACKDROP_ONLY);
    expect(document.querySelector('.title-card-poster')).toBeNull();
    expect(document.querySelector('.title-card-media')).not.toBeNull();
    expect(screen.getByText('Inception')).toBeInTheDocument();
  });

  it('shows a monogram tile when no artwork exists', () => {
    renderCard(NO_ART);
    expect(document.querySelector('.title-card-poster')).toBeNull();
    expect(document.querySelector('.title-card-fallback')?.textContent).toBe('I');
  });

  it('exposes the primary action and more-info buttons', () => {
    const primary = { label: 'Watch', icon: 'play' as const, onClick: vi.fn() };
    render(
      <MemoryRouter>
        <TitleCard item={FULL} primary={primary} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: 'Watch' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'More info' })).toBeInTheDocument();
  });
});
