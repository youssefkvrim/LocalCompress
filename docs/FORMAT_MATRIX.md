# Formats

| Format | Lossless (default) | Balanced / Compact | Proof before the result is offered | Left untouched when |
|---|---|---|---|---|
| **JPEG** | optimal Huffman + progressive; orientation and ICC kept | MozJPEG, downscaled | identical DCT coefficients · decodes | pixel count > 120 MP |
| **PNG** | OxiPNG + IDAT re-deflated (libdeflate 12) | same | identical pixels · decodes | animated, > 120 MP |
| WebP · AVIF · GIF · HEIC | - | - | - | always (already compact or animated) |
| **MP4 · MOV · MKV · WebM** | - (impossible without re-encoding) | H.264 via WebCodecs, audio copied or AAC | stream present, resolution, duration ±1 %, frames decode at start / middle / end | no decoder / encoder on this workstation |
| **PDF** | JPEG re-coded losslessly, streams re-deflated, identical streams merged, unused objects dropped | + RGB / grey JPEG images re-encoded and downscaled (masks never) | reparses · same page count | encrypted, signed, > 1.5 GB, unparseable |
| **ZIP** | every entry re-deflated, the smaller of old / new kept; names, attributes, timestamps, order kept | same | every entry's CRC-32 · structure identical | - |
| **PPTX · XLSX · DOCX** | media images as above (same name & format), XML re-deflated (author fields cleared only with cleaning on, see below) | + images ≤ 2400 / 1600 px | CRC-32 · relationships resolve · each image proven individually | unsafe paths; signed → re-deflate only |
| **PPTM · XLSM · DOCM** | as above, VBA / ActiveX / embeddings copied byte for byte | same | same | **off by default** (Settings) |

**Metadata cleaning** ("Erase location and author") is **off by default**. When it is off, every format keeps its metadata, and with it any sensitivity label.

When it is on:

| Format | Removed | Sensitivity labels |
|---|---|---|
| JPEG | every APPn / COM segment except JFIF, ICC, Adobe (EXIF, XMP, IPTC, C2PA) | **can be lost** (XMP) |
| PNG | `tEXt`, `zTXt`, `iTXt`, `eXIf`, `tIME` | **can be lost** (XMP in `iTXt`) |
| Video | every container tag | **can be lost** |
| PDF | Info dictionary / XMP, except when they carry a label | kept (detected by name: `MSIP_Label`, `Classification`, …) |
| PPTX · XLSX · DOCX | author fields of `docProps/core.xml` and `app.xml` | kept (`docProps/custom.xml`, `docMetadata/` never touched) |
| ZIP | nothing | kept |

Leave cleaning off for classified documents.
