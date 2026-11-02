import { describe, expect, it } from 'vitest';
import { sniff } from '../src/lib/detect';

const bytes = (s: string, ...extra: number[]) => new Uint8Array([...s].map((c) => c.charCodeAt(0)).concat(extra));

describe('file type from the first bytes', () => {
  it('recognises sounds', () => {
    expect(sniff(bytes('RIFF\0\0\0\0WAVEfmt '))).toEqual({ kind: 'audio', format: 'wav' });
    expect(sniff(bytes('ID3\x04\0\0'))).toEqual({ kind: 'audio', format: 'mp3' });
    expect(sniff(new Uint8Array([0xff, 0xfb, 0x90, 0x64]))).toEqual({ kind: 'audio', format: 'mp3' });
    expect(sniff(bytes('OggS\0\x02'))).toEqual({ kind: 'audio', format: 'ogg' });
    expect(sniff(bytes('fLaC\0\0'))).toEqual({ kind: 'audio', format: 'flac' });
    expect(sniff(bytes('\0\0\0\x20ftypM4A \0\0'))).toEqual({ kind: 'audio', format: 'm4a' });
  });
  it('keeps pictures and videos apart', () => {
    expect(sniff(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toEqual({ kind: 'image', format: 'jpeg' });
    expect(sniff(bytes('\0\0\0\x20ftypisom\0\0'))).toEqual({ kind: 'video', format: 'mp4' });
    expect(sniff(bytes('\0\0\0\x20ftypqt  \0\0'))).toEqual({ kind: 'video', format: 'mp4' });
    const bmp = new Uint8Array(30);
    bmp.set([0x42, 0x4d]);
    bmp[14] = 40;
    expect(sniff(bmp)).toEqual({ kind: 'image', format: 'bmp' });
  });
});
