import { describe, expect, it } from 'vitest';
import { humanEta, humanSize, humanSpeed } from './api';

describe('humanSize', () => {
  it('formats byte sizes', () => {
    expect(humanSize(0)).toBe('0 B');
    expect(humanSize(500)).toBe('500 B');
    expect(humanSize(2048)).toBe('2 KB');
    expect(humanSize(5 * 1024 * 1024)).toBe('5 MB');
    expect(humanSize(2 * 1024 * 1024 * 1024)).toBe('2 GB');
  });
});

describe('humanSpeed', () => {
  it('formats speeds', () => {
    expect(humanSpeed(0)).toBe('0 B/s');
    expect(humanSpeed(1048576)).toBe('1 MB/s');
  });
});

describe('humanEta', () => {
  it('formats eta values', () => {
    expect(humanEta(null)).toBe('—');
    expect(humanEta(-1)).toBe('—');
    expect(humanEta(45)).toBe('45s');
    expect(humanEta(125)).toBe('2m 5s');
    expect(humanEta(3700)).toBe('1h 1m');
  });
});
