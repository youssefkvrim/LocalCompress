# LocalCompress

**Le fichier reste ici.** Compression de fichiers sur le poste de travail : rien n’est envoyé à un serveur.
*The file stays here. File compression on the workstation, nothing is sent to a server.* · [English below](#english)

## Français

Remplace les outils en ligne (iLovePDF, TinyPNG…) pour les documents C1-C3. Le serveur interne ne fait que livrer l’application ; chaque fichier est traité dans le navigateur, sur le poste, puis enregistré là où l’utilisateur le choisit.

| Mode | Effet |
|---|---|
| **Sans perte** (défaut) | Contenu identique au bit près, preuve vérifiée à chaque fichier |
| Équilibré | Bien plus léger, différence invisible |
| Compact | Le plus léger possible |

Formats : JPEG · PNG · MP4 · MOV · MKV · WebM · PDF · ZIP · PPTX · XLSX · DOCX.

```bash
npm ci && npm run dev        # développement
npm run build                # contrôle des types, build, audit de la chaîne d’approvisionnement
npm test                     # npm run fixtures d’abord pour les tests sur vrais fichiers
npm run package              # paquet de déploiement (site, nginx/IIS, SBOM, SHA256SUMS)
```

Le code tient dans `src/` : `lib/` (outils), `engines/` (un fichier par format), `security/`, `worker/`, `ui/`. Voir [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## English

Replaces online tools for C1-C3 documents. The intranet server only delivers the app; every file is processed in the browser on the workstation.

**Lossless engines (default mode)**, each result is *proven* identical before it is offered:

| Format | Technique | Proof |
|---|---|---|
| JPEG | Optimal Huffman tables + progressive scans (jpegtran-equivalent, in-house) | identical DCT coefficients; pixels identical in libjpeg-turbo |
| PNG | OxiPNG (filters, bit depth, palette) + libdeflate level 12 | pixel-by-pixel comparison |
| ZIP, Office XML, PDF streams | libdeflate level 12 (≈ Zopfli, ~20 % smaller than zlib -9) | CRC-32 of every entry / reparse |
| PDF | lossless JPEG, stream re-deflate, duplicate-stream merge, object streams, unused objects | reparse, page count |

Lossy modes add MozJPEG and hardware H.264 video encoding (WebCodecs).

**Zero upload**, enforced in layers: no code path sends data; CSP with no remote origin; egress guard in page and workers; service-worker firewall (also makes the app work offline); server accepts GET only.

| Docs | |
|---|---|
| [Security review](docs/SECURITY_REVIEW.md) | audit findings, misuse scenarios, fixes |
| [Threat model](docs/THREAT_MODEL.md) · [Zero-upload verification](docs/ZERO_UPLOAD_VERIFICATION.md) | |
| [Architecture](docs/ARCHITECTURE.md) · [Format matrix](docs/FORMAT_MATRIX.md) · [Technical investigation](docs/TECH_INVESTIGATION.md) | |
| [Deployment](docs/DEPLOYMENT.md) · [Maintenance](docs/MAINTENANCE.md) · [Benchmarks](benchmarks/README.md) · [SBOM](sbom/LICENSES.md) | |

Status: PoC 0.3, independent verification and C3 review pending.
