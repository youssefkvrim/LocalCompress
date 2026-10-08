# wasm/

Reserved for **in-house builds** of WebAssembly engines, so that production does not have to trust upstream prebuilt binaries.

Today the shipped WASM comes from pinned npm packages (jSquash codecs, hash-wasm); their SHA-256 hashes are recorded in `sbom/wasm-binaries.json`. The procedure to rebuild them from source and alias them here is in `docs/MAINTENANCE.md` § 3.

Candidates evaluated but not shipped (see `docs/TECH_INVESTIGATION.md`): Ghostscript (AGPL — needs a commercial licence), FFmpeg (fallback decoder), 7-Zip.
