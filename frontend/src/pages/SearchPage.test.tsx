import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import { SearchPage } from './SearchPage';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('SearchPage', () => {
  it('renders poster grid from search results', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          items: [
            {
              tmdbId: 27205,
              mediaType: 'movie',
              title: 'Inception',
              year: 2010,
              posterPath: '/qL9BmNyBAtPX5N9dXmY1Qa4fPv.jpg',
              backdropPath: null,
              overview: 'A thief who steals corporate secrets.',
              voteAverage: 8.4,
            },
          ],
        }),
      }),
    );

    render(
      <MemoryRouter>
        <SearchPage />
      </MemoryRouter>,
    );

    const input = screen.getByLabelText(/search/i);
    fireEvent.change(input, { target: { value: 'inception' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(await screen.findByText('Inception')).toBeInTheDocument();
    expect(screen.getByText('2010')).toBeInTheDocument();
  });
});
