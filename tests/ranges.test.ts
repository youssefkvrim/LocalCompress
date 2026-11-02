import { describe, expect, it } from 'vitest';
import { parseRanges } from '../src/lib/ranges';

describe('parseRanges', () => {
  it('reads single pages, ranges and open ranges', () => {
    expect(parseRanges('1-3, 5, 8-', 9)).toEqual([[0, 1, 2], [4], [7, 8]]);
  });
  it('accepts spaces and semicolons', () => {
    expect(parseRanges(' 2 - 3 ; 1 ', 3)).toEqual([[1, 2], [0]]);
  });
  it('rejects pages out of the document, reversed ranges and garbage', () => {
    expect(parseRanges('0', 3)).toBeNull();
    expect(parseRanges('4', 3)).toBeNull();
    expect(parseRanges('3-1', 3)).toBeNull();
    expect(parseRanges('a', 3)).toBeNull();
    expect(parseRanges('', 3)).toBeNull();
  });
});
