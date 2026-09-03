import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import { HomePage } from './HomePage';

const ITEM = {
  tmdbId: 27205,
  mediaType: 'movie' as const,
  title: 'Inception',
  year: 2010,
  posterPath: '/qL9BmNyBAtPX5N9dXmY1Qa4fPv.jpg',
  backdropPath: null,
  overview: 'A thief who steals corporate secrets.',
  voteAverage: 8.4,
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('HomePage', () => {
  it('renders section titles and poster cards from browse results', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ items: [ITEM] }),
      }),
    );

    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Trending Today')).toBeInTheDocument();
    expect((await screen.findAllByText('Inception')).length).toBeGreaterThan(0);
    expect(screen.getByText('Trending This Week')).toBeInTheDocument();
    expect(screen.getByText('Popular TV')).toBeInTheDocument();
  });

  it('shows an error message when a section fails to load', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        json: async () => ({ error: 'TMDB unreachable' }),
      }),
    );

    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );

    expect(
      await screen.findAllByText(/couldn.t load/i),
    ).not.toHaveLength(0);
  });
});
