# Formats

| Format | Lossless (default) | Balanced / Compact | Proof before the result is offered | Left untouched when |
|---|---|---|---|---|
| **JPEG** | optimal Huffman + progressive; metadata removed, orientation and ICC kept | MozJPEG, downscaled | identical DCT coefficients · decodes | pixel count > 120 MP |
| **PNG** | OxiPNG + IDAT re-deflated (libdeflate 12) | same | identical pixels · decodes | animated, > 120 MP |
| WebP · AVIF · GIF · HEIC | - | - | - | always (already compact or animated) |
| **MP4 · MOV · MKV · WebM** | - (impossible without re-encoding) | H.264 via WebCodecs, audio copied or AAC | stream present, resolution, duration ±1 %, frames decode at start / middle / end | no decoder / encoder on this workstation |
| **PDF** | JPEG re-coded losslessly, streams re-deflated, identical streams merged, unused objects dropped | + RGB / grey JPEG images re-encoded and downscaled (masks never) | reparses · same page count | encrypted, signed, > 1.5 GB, unparseable |
| **ZIP** | every entry re-deflated, the smaller of old / new kept; names, attributes, timestamps, order kept | same | every entry's CRC-32 · structure identical | - |
| **PPTX · XLSX · DOCX** | media images as above (same name & format), XML re-deflated, author fields cleared | + images ≤ 2400 / 1600 px | CRC-32 · relationships resolve · each image proven individually | unsafe paths; signed → re-deflate only |
| **PPTM · XLSM · DOCM** | as above, VBA / ActiveX / embeddings copied byte for byte | same | same | **off by default** (Settings) |

Sensitivity labels (Purview `MSIP_Label_*`, classification XMP, `docProps/custom.xml`) are always kept.
