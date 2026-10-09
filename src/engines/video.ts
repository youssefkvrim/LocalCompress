/**
 * Video → MP4 / H.264 through WebCodecs (hardware encoders when present).
 * H.264 is the one codec every Windows workstation plays.
 *
 * A video cannot shrink without re-encoding, so "lossless" mode declines.
 */
import { ALL_FORMATS, BlobSource, Conversion, Input, Mp4OutputFormat, Output, StreamTarget, VideoSampleSink, canEncodeVideo, getFirstEncodableAudioCodec } from 'mediabunny';
import { Writer } from '../lib/scratch';
import { Skip, type Engine } from '../lib/types';

/** Bits per pixel per frame, and the cap on the short side of the picture. */
const PRESET = {
  balanced: { bpp: 0.06, maxSide: 1080, audio: 128_000 },
  compact: { bpp: 0.035, maxSide: 720, audio: 96_000 },
};

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

export const videoEngine: Engine = async (job) => {
  if (job.mode === 'lossless') throw new Skip('video-lossless');
  const preset = PRESET[job.mode];
  const input = new Input({ source: new BlobSource(job.file), formats: ALL_FORMATS });
  try {
    const video = await input.getPrimaryVideoTrack();
    const audio = await input.getPrimaryAudioTrack();
    if (!video || !(await video.canDecode())) throw new Skip('no-codec');
    const duration = await input.computeDuration();
    const srcW = await video.getDisplayWidth();
    const srcH = await video.getDisplayHeight();
    if (srcW * srcH > 7680 * 4320) throw new Skip('too-large'); // beyond 8K: refuse rather than exhaust memory
    const stats = await video.computePacketStats(240);
    const fps = Math.min(60, Math.max(1, Math.round(stats.averagePacketRate || 30)));

    const scale = Math.min(1, preset.maxSide / Math.min(srcW, srcH));
    const width = even(srcW * scale);
    const height = even(srcH * scale);
    const source = stats.averageBitrate || (job.file.size * 8) / Math.max(duration, 1);
    const bitrate = Math.max(250_000, Math.min(Math.round(width * height * fps * preset.bpp), Math.round(source * 0.85)));
    if (!(await canEncodeVideo('avc', { width, height, bitrate }))) throw new Skip('no-codec');

    // Keep compact AAC/Opus audio as is; otherwise re-encode.
    const audioStats = audio ? await audio.computePacketStats(200).catch(() => null) : null;
    const copyAudio = !!audio && (audio.codec === 'aac' || audio.codec === 'opus') && (audioStats?.averageBitrate ?? Infinity) <= preset.audio * 1.25;
    const audioCodec = audio && !copyAudio ? await getFirstEncodableAudioCodec(['aac', 'opus'], { bitrate: preset.audio }) : null;

    const out = await Writer.create(job.id, 'out.mp4');
    const conversion = await Conversion.init({
      input,
      output: new Output({ format: new Mp4OutputFormat({ fastStart: false }), target: new StreamTarget(out.writable() as WritableStream<never>, { chunked: true }) }),
      tracks: 'primary',
      video: { codec: 'avc', bitrate, width, height, fit: 'fill', hardwareAcceleration: 'prefer-hardware', forceTranscode: true, alpha: 'discard' },
      audio: copyAudio ? {} : audioCodec ? { codec: audioCodec, bitrate: preset.audio } : { discard: true },
      tags: job.stripMetadata ? () => ({}) : undefined, // location, device, author
      showWarnings: false,
    });
    if (!conversion.isValid) throw new Skip('unsupported');
    conversion.onProgress = (f) => job.progress(f * 0.95);
    await conversion.execute();
    const file = await out.close();
    job.step('verify');

    await validate(job, file, width, height, duration, copyAudio || !!audioCodec);
    return { file, path: out.path, ext: 'mp4', engine: 'H.264 (WebCodecs)', lossless: false };
  } finally {
    input.dispose();
  }
};

/** Reopen the MP4 and prove the streams are complete and decodable. */
async function validate(job: Parameters<Engine>[0], file: File, width: number, height: number, duration: number, withAudio: boolean) {
  const out = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const video = await out.getPrimaryVideoTrack();
    job.check('Video stream present', !!video);
    if (!video) return;
    job.check('Resolution verified', (await video.getDisplayWidth()) === width && (await video.getDisplayHeight()) === height);
    const d = await out.computeDuration();
    job.check('Duration verified', Math.abs(d - duration) <= Math.max(0.5, duration * 0.01));
    job.check('Audio stream', !!(await out.getPrimaryAudioTrack()) === withAudio);
    const sink = new VideoSampleSink(video);
    const t0 = await video.getFirstTimestamp();
    let decoded = 0;
    for (const t of [t0, t0 + d / 2, Math.max(t0, t0 + d - 0.5)]) {
      const s = await sink.getSample(t);
      if (s) decoded++, s.close();
    }
    job.check('Frames decode (start / middle / end)', decoded === 3);
  } finally {
    out.dispose();
  }
}
