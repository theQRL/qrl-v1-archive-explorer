# TESTNET ARCHIVE REHEARSAL — QRL v1 archive explorer

> **This is a test of the archival process, not the QRL v1 mainnet archive.** During these rehearsals, the public testnet and mainnet remain live. Blocks produced after the lab fork point belong to an isolated, disposable testnet branch. Do not use rehearsal results as evidence of mainnet balances or finality.

This repository will hold the read-only explorer for the QRL v1 archive. Its first deployments will serve clearly labelled testnet rehearsal releases. Every page, search result, download index and error page must show the rehearsal status and identify the release and lab cutoff.

## Planned behaviour

- Search archived blocks, transactions and addresses, including every recipient of a multi-output transfer.
- Show balances **at the archive cutoff**, with no claim of live confirmations or network health.
- Preserve useful legacy explorer links and documented read-only API behaviour.
- Serve verified immutable data without depending on a running QRL v1 node or the old explorer backend.
- Measure SQLite-WASM and DuckDB-Wasm/Parquet against the same query set before choosing the serving design.

The proposed public hosts are `archive.v1.theqrl.org` for the explorer and `data.archive.v1.theqrl.org` for downloads. They must display rehearsal warnings when provisioned. No rehearsal release belongs under a `mainnet/` path.

## Siblings

Archive formats and verification tools live in `theQRL/qrl-v1-archive`. Deployment plans live in the **private** `theQRL/qrl-v1-archive-ops` repository.
