import { describe, expect, it } from 'vitest';
import { durationLabel, hoverTags, seasonCountLabel } from './hoverCard';

describe('durationLabel', () => {
  it('formats hours and minutes Netflix-style', () => {
    expect(durationLabel(139)).toBe('2h 19m');
    expect(durationLabel(60)).toBe('1h');
    expect(durationLabel(45)).toBe('45m');
  });

  it('returns null for null/zero/garbage input', () => {
    expect(durationLabel(null)).toBeNull();
    expect(durationLabel(0)).toBeNull();
    expect(durationLabel(-5)).toBeNull();
    expect(durationLabel(Number.NaN)).toBeNull();
  });
});

describe('seasonCountLabel', () => {
  it('pluralizes seasons', () => {
    expect(seasonCountLabel(1)).toBe('1 Season');
    expect(seasonCountLabel(2)).toBe('2 Seasons');
    expect(seasonCountLabel(null)).toBeNull();
    expect(seasonCountLabel(0)).toBeNull();
  });
});

describe('hoverTags', () => {
  it('caps genre tags at three like Netflix and drops empties', () => {
    expect(hoverTags(['Slick', 'Psychological', 'Mystery', 'Extra'])).toEqual(['Slick', 'Psychological', 'Mystery']);
    expect(hoverTags(['', 'Only'])).toEqual(['Only']);
    expect(hoverTags([])).toEqual([]);
  });
});
