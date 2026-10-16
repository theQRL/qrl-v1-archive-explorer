# TESTNET ARCHIVE REHEARSAL — QRL v1 archive explorer

> **This is a test of the archival process, not the QRL v1 mainnet archive.** The signed point-in-time snapshot records public testnet through block 1,620,000. The public testnet and mainnet remain live. Later blocks and current balances are outside this snapshot.

This repository holds the read-only explorer for QRL v1 archive releases. The published snapshot is `testnet-snapshot-h1620000-8d7d8a30-r1`; see the [release page](https://archive.v1.theqrl.org/testnet/release/), [shard format and reconstruction guide](https://archive.v1.theqrl.org/testnet/shard-format/), and [data index](https://data.v1.theqrl.org/index.json). Every page and search result must identify the snapshot and cutoff. This release is not a terminal rehearsal or final archive.

## Current scope

- Search archived blocks, transactions and addresses in the point-in-time snapshot.
- Show independently checked node balances **observed at the snapshot cutoff**, with no claim of live confirmations or network health.
- Serve verified immutable data without depending on a running QRL v1 node or the old explorer backend.

Legacy explorer route coverage, historical consensus replay and full isolated rehearsals remain pending.

The public hosts are [archive.v1.theqrl.org](https://archive.v1.theqrl.org/) for the explorer and [data.v1.theqrl.org](https://data.v1.theqrl.org/) for downloads. Both identify the testnet snapshot and keep the rehearsal warning. No testnet release belongs under a `mainnet/` path.

## Current files

`public/` is the static Pages output. It uses the QRL component library's Quantum Dawn theme (`qrl-dawn` in source). The published testnet pages provide block height/hash, transaction hash, and address history/balance lookups at the cutoff. The browser checks hashes of query files it reads; the [release page](https://archive.v1.theqrl.org/testnet/release/) provides independent signature verification instructions. No live node or legacy explorer API serves these lookups.

Run `npm ci && npm run build` after editing the theme, `src/build-pages.mjs`, or `src/shard-format.html`. The generated lookup and format pages are checked into `public/` so the warning remains visible even if Pages serves that directory without a build step. `REHEARSAL-STATUS.md` records the current state; the sibling archive repository documents the signed snapshot and separate unsigned transport-test objects.

## Siblings

Archive formats and verification tools live in `theQRL/qrl-v1-archive`.
