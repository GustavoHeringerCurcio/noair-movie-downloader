import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SearchOverlay } from './SearchOverlay';
import { useSearchStore } from '../store/searchStore';
import type { MediaItem } from '../types';

const INCEPTION: MediaItem = {
  tmdbId: 27205,
  mediaType: 'movie',
  title: 'Inception',
  year: 2010,
  posterPath: '/poster.jpg',
  backdropPath: '/backdrop.jpg',
  overview: '',
  voteAverage: 8.4,
};

const ok = (body: unknown): Response =>
  ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

function stubFetch(item: MediaItem): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/browse')) return Promise.resolve(ok({ items: [] }));
      return Promise.resolve(ok({ items: [item] }));
    }),
  );
}

function renderShell(): void {
  render(
    <MemoryRouter initialEntries={['/']}>
      <SearchOverlay />
      <Routes>
        <Route path="/" element={<p>home-marker</p>} />
        <Route path="/media/:id" element={<p>media-marker</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

function openSearch(): void {
  useSearchStore.setState({ open: true, query: '', type: 'all', recentSearches: [] });
}

async function typeAndFindCard(term: string): Promise<HTMLElement> {
  const input = screen.getByRole('textbox', { name: 'Search titles' });
  fireEvent.change(input, { target: { value: term } });
  return screen.findByRole('button', { name: /inception.*open details/i });
}

beforeEach(() => {
  window.localStorage.clear();
  stubFetch(INCEPTION);
  openSearch();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useSearchStore.setState({ open: false, query: '', type: 'all', recentSearches: [] });
});

describe('SearchOverlay result selection', () => {
  it('closes the overlay and lands on the detail page when a result is clicked', async () => {
    renderShell();

    const card = await typeAndFindCard('inception');
    fireEvent.click(card);

    expect(await screen.findByText('media-marker')).toBeInTheDocument();
    await waitFor(() => expect(useSearchStore.getState().open).toBe(false));
    expect(useSearchStore.getState().query).toBe('');
    expect(screen.queryByRole('textbox', { name: 'Search titles' })).not.toBeInTheDocument();
  });

  it('closes the overlay and navigates when a result is activated with Enter', async () => {
    renderShell();

    const card = await typeAndFindCard('inception');
    fireEvent.keyDown(card, { key: 'Enter' });

    expect(await screen.findByText('media-marker')).toBeInTheDocument();
    await waitFor(() => expect(useSearchStore.getState().open).toBe(false));
    expect(useSearchStore.getState().query).toBe('');
  });

  it('keeps the overlay open when the route has not changed', async () => {
    renderShell();

    const card = await typeAndFindCard('inception');
    expect(card).toBeInTheDocument();
    expect(useSearchStore.getState().open).toBe(true);
    expect(screen.getByRole('textbox', { name: 'Search titles' })).toBeInTheDocument();
  });
});
