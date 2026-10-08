import {
  ALL_FORMATS,
  BlobSource,
  Conversion,
  Input,
  Mp4OutputFormat,
  Output,
  StreamTarget,
  VideoSampleSink,
  canEncodeVideo,
  getFirstEncodableAudioCodec,
  type AudioCodec,
  type VideoCodec,
} from 'mediabunny';
import {
  MIN_SAVING,
  RefusedError,
  ScratchWriter,
  baseName,
  formatBytes,
  formatDuration,
  type EngineContext,
  type EngineOutput,
  type VideoCodecChoice,
} from '@localcompress/core';

const CODEC_LABEL: Record<string, string> = { avc: 'H.264', hevc: 'H.265 / HEVC', av1: 'AV1', vp9: 'VP9', vp8: 'VP8' };
/** Relative efficiency vs H.264 at equal perceived quality. */
const CODEC_FACTOR: Record<string, number> = { avc: 1, hevc: 0.65, av1: 0.55, vp9: 0.7 };

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

export interface VideoPlan {
  codec: VideoCodec;
  width: number;
  height: number;
  fps: number;
  videoBitrate: number;
  audioBitrate: number;
  audioCodec: AudioCodec | null;
  copyAudio: boolean;
  estimate: number;
}

/**
 * Pick codec + bitrate from source properties and preset.
 * Bitrate = pixels × fps × bits-per-pixel, scaled by codec efficiency and
 * capped below the source bitrate (re-encoding up is pointless).
 */
async function plan(ctx: EngineContext, input: Input): Promise<{ plan: VideoPlan | null; details: string[]; duration: number }> {
  const { params, settings } = ctx;
  const duration = await input.computeDuration();
  const video = await input.getPrimaryVideoTrack();
  const audio = await input.getPrimaryAudioTrack();
  if (!video) throw new RefusedError('No video track found', 'unsupported');
  if (!(await video.canDecode())) throw new RefusedError(`This workstation cannot decode ${CODEC_LABEL[video.codec ?? ''] ?? video.codec ?? 'this codec'}`, 'no-decoder');

  const srcW = await video.getDisplayWidth();
  const srcH = await video.getDisplayHeight();
  const stats = await video.computePacketStats(240);
  const fps = Math.min(60, Math.max(1, Math.round(stats.averagePacketRate || 30)));
  const srcVideoBitrate = stats.averageBitrate || (ctx.file.size * 8) / Math.max(duration, 0.001);
  const details = [
    `${srcW}×${srcH} · ${fps} fps · ${CODEC_LABEL[video.codec ?? ''] ?? video.codec} · ${formatDuration(duration * 1000)}`,
    `Source video ≈ ${(srcVideoBitrate / 1e6).toFixed(1)} Mbit/s`,
  ];
  if (audio) details.push(`Audio: ${audio.codec ?? 'unknown'} · ${await audio.getNumberOfChannels()} ch · ${await audio.getSampleRate()} Hz`);

  // Resolution.
  const shortSide = Math.min(srcW, srcH);
  const limit = params.videoMaxHeight || shortSide;
  const scale = shortSide > limit ? limit / shortSide : 1;
  const width = even(srcW * scale);
  const height = even(srcH * scale);

  // Codec: requested one if this machine can encode it, else H.264.
  const wanted: VideoCodecChoice = settings.videoCodec;
  let codec: VideoCodec | null = null;
  for (const c of [wanted, 'avc', 'vp9'] as VideoCodec[]) {
    if (await canEncodeVideo(c, { width, height, bitrate: 2e6 })) {
      codec = c;
      break;
    }
  }
  if (!codec) throw new RefusedError('No video encoder is available on this workstation (WebCodecs)', 'no-encoder');
  if (codec !== wanted) details.push(`${CODEC_LABEL[wanted]} encoder unavailable here — using ${CODEC_LABEL[codec]}`);

  let videoBitrate = Math.round(width * height * fps * params.videoBpp * (CODEC_FACTOR[codec] ?? 1));
  videoBitrate = Math.max(250_000, videoBitrate);
  const downscaled = scale < 1;
  if (videoBitrate >= srcVideoBitrate * 0.9 && !downscaled && codec === video.codec) {
    details.push('Source is already encoded at or below the target bitrate');
    return { plan: null, details, duration };
  }
  videoBitrate = Math.min(videoBitrate, Math.round(srcVideoBitrate * 0.85));

  // Audio: copy compact AAC/Opus as-is, otherwise re-encode.
  let audioCodec: AudioCodec | null = null;
  let copyAudio = false;
  let audioBitrate = 0;
  if (audio) {
    const audioStats = await audio.computePacketStats(200).catch(() => null);
    const srcAudioBitrate = audioStats?.averageBitrate ?? Infinity;
    if ((audio.codec === 'aac' || audio.codec === 'opus') && srcAudioBitrate <= params.audioBitrate * 1.25) {
      copyAudio = true;
      audioCodec = audio.codec;
      audioBitrate = srcAudioBitrate;
    } else {
      audioCodec = await getFirstEncodableAudioCodec(['aac', 'opus'], { bitrate: params.audioBitrate });
      audioBitrate = params.audioBitrate;
      if (!audioCodec) details.push('⚠ No audio encoder available — audio track will be dropped');
    }
  }
  const estimate = Math.round(((videoBitrate + (audioCodec ? audioBitrate : 0)) * duration) / 8 * 1.01 + 64_000);
  return { plan: { codec, width, height, fps, videoBitrate, audioBitrate, audioCodec, copyAudio, estimate }, details, duration };
}

export async function compressVideo(ctx: EngineContext): Promise<EngineOutput> {
  const { file, settings, params } = ctx;
  if (params.lossless) {
    return { status: 'not-worth-it', reason: 'video-lossless', engine: '—', summary: 'Video cannot be made smaller without re-encoding. Choose Balanced or Compact.', details: [] };
  }
  ctx.stage('analyze');
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const { plan: p, details, duration } = await plan(ctx, input);

    ctx.stage('strategy');
    if (!p) {
      return { status: 'not-worth-it', reason: 'video-efficient', engine: 'WebCodecs', summary: 'Already efficiently encoded — re-encoding would only lose quality.', details };
    }
    const label = `${CODEC_LABEL[p.codec]} · ${p.width}×${p.height} · ${(p.videoBitrate / 1e6).toFixed(1)} Mbit/s`;
    ctx.plan({ engine: `WebCodecs ${CODEC_LABEL[p.codec]}`, summary: label, estimate: p.estimate });
    if (p.estimate > file.size * (1 - MIN_SAVING)) {
      return { status: 'not-worth-it', reason: 'video-efficient', engine: `WebCodecs ${CODEC_LABEL[p.codec]}`, summary: `Projected ${formatBytes(p.estimate)} — no meaningful saving.`, details, outputSize: p.estimate };
    }

    ctx.stage('candidate');
    const writer = await ScratchWriter.create(ctx.jobId, 'output.mp4');
    const output = new Output({
      format: new Mp4OutputFormat({ fastStart: false }),
      target: new StreamTarget(writer.writable() as WritableStream<never>, { chunked: true, chunkSize: 16 * 1024 * 1024 }),
    });
    let conversion: Conversion;
    try {
      conversion = await Conversion.init({
        input,
        output,
        tracks: 'primary',
        video: {
          codec: p.codec,
          bitrate: p.videoBitrate,
          width: p.width,
          height: p.height,
          fit: 'fill',
          hardwareAcceleration: 'prefer-hardware',
          forceTranscode: true,
          // Alpha handling would spawn blob: workers, which the CSP forbids by design.
          alpha: 'discard',
        },
        audio: p.audioCodec ? { codec: p.audioCodec, bitrate: p.copyAudio ? undefined : p.audioBitrate } : { discard: true },
        // Location (GPS), device and author tags are dropped unless the user opts out.
        tags: settings.stripMetadata ? () => ({}) : undefined,
        showWarnings: false,
      });
      if (!conversion.isValid) {
        throw new RefusedError(`Cannot convert: ${conversion.discardedTracks.map((t) => t.reason).join(', ')}`);
      }
      conversion.onProgress = (f) => ctx.progress(f, `${Math.round(f * 100)}% · ${CODEC_LABEL[p.codec]}`);
      await conversion.execute();
    } finally {
      writer.close();
    }

    ctx.stage('validate');
    const outFile = await writer.file();
    await validateVideo(ctx, outFile, p, duration);
    if (settings.stripMetadata) details.push('Container metadata (location, device, author) removed');
    details.push(p.copyAudio ? 'Audio stream copied without re-encoding' : p.audioCodec ? `Audio re-encoded to ${p.audioCodec.toUpperCase()} ${p.audioBitrate / 1000} kbit/s` : 'No audio');

    ctx.stage('compare');
    if (outFile.size > file.size * (1 - MIN_SAVING)) {
      await writer.remove();
      return { status: 'not-worth-it', engine: `WebCodecs ${CODEC_LABEL[p.codec]}`, summary: 'Re-encoding did not reduce the size.', details, outputSize: outFile.size };
    }
    return {
      status: 'optimized',
      outputPath: writer.path,
      outputSize: outFile.size,
      outputName: `${baseName(file.name)}.compressed.mp4`,
      mime: 'video/mp4',
      engine: `${CODEC_LABEL[p.codec]} (WebCodecs, hardware preferred)`,
      summary: label,
      details,
    };
  } finally {
    input.dispose();
  }
}

/** Reopen the generated MP4 and prove the streams are decodable and complete. */
async function validateVideo(ctx: EngineContext, file: File, p: VideoPlan, srcDuration: number) {
  const out = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const fmt = await out.getFormat();
    ctx.check('Container verified', fmt.name.toLowerCase().includes('mp4'), fmt.name);
    const video = await out.getPrimaryVideoTrack();
    ctx.check('Video stream present', !!video, video ? (CODEC_LABEL[video.codec ?? ''] ?? String(video.codec)) : 'missing');
    if (!video) return;
    const w = await video.getDisplayWidth();
    const h = await video.getDisplayHeight();
    ctx.check('Resolution verified', w === p.width && h === p.height, `${w}×${h}`);
    const duration = await out.computeDuration();
    const tolerance = Math.max(0.5, srcDuration * 0.01);
    ctx.check('Duration verified', Math.abs(duration - srcDuration) <= tolerance, `${duration.toFixed(2)} s vs ${srcDuration.toFixed(2)} s`);
    const audio = await out.getPrimaryAudioTrack();
    ctx.check('Audio stream', p.audioCodec ? !!audio : !audio, audio ? String(audio.codec) : 'none');

    const sink = new VideoSampleSink(video);
    const first = await video.getFirstTimestamp();
    const probes = [first, first + duration * 0.5, Math.max(first, first + duration - 0.5)];
    let decoded = 0;
    for (const t of probes) {
      const s = await sink.getSample(t);
      if (s) decoded++, s.close();
    }
    ctx.check('Frames decode (start / middle / end)', decoded === probes.length, `${decoded}/${probes.length}`);
  } finally {
    out.dispose();
  }
}
