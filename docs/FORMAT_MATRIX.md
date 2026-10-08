# Supported-format matrix

**Default mode: Sans perte / Lossless.** JPEG → optimal Huffman + progressive (identical coefficients); PNG → OxiPNG + libdeflate (identical pixels); ZIP/Office/PDF → libdeflate 12, PDF stream dedup (identical content). Video is not reducible losslessly (reported). WebP/AVIF are left as is in lossless mode. Lossy modes below apply only when *Équilibré* or *Compact* is chosen, and a lossy result is kept only if ≥ 10 % smaller than the lossless one.

| Format | Detection | Engine | What is optimised | What is preserved | Validation | Lossy? | Refused / untouched when |
|---|---|---|---|---|---|---|---|
| **JPEG** | `FF D8 FF` | MozJPEG | Re-encode (quality per preset), downscale above max edge, progressive + optimised Huffman | Visual orientation (EXIF applied), dimensions unless downscaled | Decode, dimensions, magic bytes | Yes | > 120 MP |
| **PNG** | PNG signature | OxiPNG | Lossless re-compression; downscale only if preset requires | Exact pixels when not resized; alpha | Decode, dimensions, magic | No (unless resized) | Animated (APNG), > 120 MP |
| **WebP** | `RIFF…WEBP` | libwebp | Re-encode, downscale | Alpha | Decode, dimensions, magic | Yes | Animated |
| **AVIF** | `ftypavif` | libavif | Re-encode, downscale | Alpha | Decode, dimensions, magic | Yes | — |
| GIF / HEIC | detected | — | — | — | — | — | Not supported (reported) |
| **MP4 / MOV** | `ftyp` + video brand | Mediabunny + WebCodecs | Re-encode video (H.264 default; HEVC/AV1 opt-in), resolution cap per preset, AAC/Opus audio (copied when already compact) | Duration, aspect ratio, rotation, primary audio | Container, video stream & codec, resolution, duration ±1 %, audio presence, decode start/middle/end frames | Yes | No decoder for codec; no encoder available; already ≤ target bitrate |
| **MKV / WebM** | EBML | same | same → MP4 output | same | same | Yes | same |
| **PDF** | `%PDF-` in first 1 KB | pdf-lib + MozJPEG + DEFLATE | JPEG images (re-encode, downsample), photographic Flate images → JPEG (Balanced/Max), lossless stream re-deflate, object streams, unused objects, `PieceInfo`, thumbnails, metadata | Text, vectors, fonts (unchanged), annotations, forms (appearances not regenerated), masks (never lossy), CMYK images (untouched) | Header/trailer, reparse, page count, page resources | Images only | Encrypted, digitally signed, > 1.5 GB, unparseable |
| **ZIP** | `PK\3\4` / `PK\5\6` | Own ZIP64 rewriter + fflate / native | Stored or weakly deflated entries → DEFLATE (per-entry best-of) | Names (raw bytes), order, attributes/permissions, timestamps, extra fields, comments, encrypted entries (verbatim) | Reopen, structure equality, CRC-32 of every entry | **No** | Projected saving < 2 % (*not worth recompressing*), spanned archives, bombs |
| **PPTX / XLSX / DOCX** | ZIP + `[Content_Types].xml` + part prefix | OOXML repack | `media/*.png|jpg` (same format & name), XML re-deflate, author/company fields cleared | Slides, formulas, relationships, content types, embedded objects, charts, part names | ZIP checks + content types + every internal relationship target resolves | Images only | Unsafe part paths; signed packages → lossless only |
| **PPTM / XLSM / DOCM** | as above + `vbaProject.bin` | as above | as above | **VBA, ActiveX, embeddings, customUI copied byte-for-byte** | as above + VBA untouched | Images only | **Disabled by default** (setting, subject to security approval) |
| 7z, RAR, others | detected (7z) | — | — | — | — | — | Not supported (reported) |

## Presets

| | Maximum quality | Balanced | Maximum compression | Custom |
|---|---|---|---|---|
| Image quality | 90 | 78 | 62 | 10–100 |
| Max image edge | original | 3840 px | 2560 px | 0–8000 px |
| Images in documents | original | 2400 px | 1600 px | min(custom, 3000) |
| PDF lossless→JPEG | no | yes (photographic only) | yes | q < 90 |
| Video bpp (H.264) | 0.10 | 0.06 | 0.035 | 0.02–0.12 |
| Max video height | original | 1080p | 720p | 0–2160 |
| Audio | 192 kbit/s | 128 kbit/s | 96 kbit/s | by quality |
