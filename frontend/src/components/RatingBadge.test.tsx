import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { RatingBadge } from './RatingBadge';

describe('RatingBadge (T-004)', () => {
  it('renders the IMDb score as ★ with a one-decimal value and an accessible label', () => {
    render(<RatingBadge value={8.3} />);
    expect(screen.getByRole('img', { name: 'IMDb rating 8.3' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'IMDb rating 8.3' }).textContent).toContain('★');
    expect(screen.getByRole('img', { name: 'IMDb rating 8.3' }).textContent).toContain('8.3');
  });

  it('always formats one decimal (8 → 8.0)', () => {
    render(<RatingBadge value={8} />);
    expect(screen.getByRole('img', { name: 'IMDb rating 8.0' })).toBeInTheDocument();
  });

  it('renders nothing when no cached score exists', () => {
    const { container } = render(<RatingBadge value={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing for an undefined or non-positive value', () => {
    const a = render(<RatingBadge value={undefined} />);
    expect(a.container.firstChild).toBeNull();
    const b = render(<RatingBadge value={0} />);
    expect(b.container.firstChild).toBeNull();
  });
});
