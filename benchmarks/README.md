# Query benchmarks

The explorer uses immutable data. Its first testnet release is a **point-in-time snapshot** through block 1,620,000 while the public testnet continues. Do not publish a query engine choice based only on local timings.

## Candidates

1. SQLite-WASM over HTTP Range using a maintained VFS compatible with the database's `STRICT` tables, or bounded SQLite shards. The official SQLite WASM package provides SQLite itself but does not supply a remote HTTP Range VFS. `sql.js-httpvfs@0.8.12` bundles SQLite 3.35.0 and cannot read this schema; do not use that package for this release.
2. DuckDB-Wasm over height-partitioned Parquet with compact exact hash and address lookup maps. A single hash query must not scan every Parquet file.
3. The deterministic static query packs in `src/build-query-packs.py`. A block-height pack contains at most 1,000 blocks and 8 MiB. Hash indexes are 256 binary files per key type. Address history uses exact 54-byte records and one HTTP Range request for a 25-row page. This is the current public serving implementation. Browser lookups work; comparative performance measurements remain pending.

Use a narrow read-only Worker only if browser-only options miss the gates. The Worker must read immutable signed release objects and have no QRL node or legacy explorer dependency.

## Reproducible corpus

Use the same 100,000 real mainnet blocks and the same signed testnet snapshot for all candidates. Include the genesis and cutoff blocks, shard boundaries, a largest observed block, a multi-output transfer, a missing hash, a normal address, the highest-activity address, and the second history page. Record the exact query inputs, release ID, dataset digests and tool versions with the raw measurements.

Run block by height, block by hash, transaction by hash, 25-row address history, next address page and balance-at-cutoff. Test cold and warm caches on Chrome, Firefox, Safari, mobile Safari and mobile Chrome. Use a 25 Mbps link with 50 ms RTT and a 2-core, 8 GiB client as the common profile. Repeat each query enough times to report p50 and p95, plus errors, bytes transferred, number of requests, peak memory, CPU and initial JS/WASM bundle size. Capture the browser's actual `206`, `Content-Range`, CORS and cache behaviour against the public data hostname. Test a missing object and an interrupted or offline request.

Initial gates: p95 under 5 seconds for block and transaction lookups; under 8 seconds for an address page; under 10 MiB transferred for a cold block or transaction lookup and under 15 MiB for an address page. A query must not fetch the whole chain or exhaust browser memory. These are targets to test, not measured claims.

## Current local measurements

The certified 1,620,000-block SQLite snapshot is about 2.01 GiB. The final locally verified packs contain 2,645 data files and 1,990,199,093 bytes total. Their signed index is 563,133 bytes. A typical 1,000-height pack is 1,091,713 bytes (median; maximum 2,027,419); block-hash buckets have a 227,664-byte median and transaction-hash buckets 253,540 bytes. The largest address-index bucket is 2,693,514 bytes. The largest event file is 54,242,838 bytes, but a 25-row address page fetches at most 1,350 bytes by Range and checks the page SHA-256 recorded in its signed index.

The adapter is designed for seven cold requests for a height lookup, or eight for a hash/address lookup, including the activation file, two operator verification reports, manifest, manifest signature and query index. These are file sizes and expected request counts from local artefacts, not measured public browser latency. Public Range/CORS/browser benchmarks remain a release gate.
