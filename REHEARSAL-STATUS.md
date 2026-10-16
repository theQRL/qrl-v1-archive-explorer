# TESTNET ARCHIVE REHEARSAL status

Status: **signed point-in-time testnet snapshot published**. Release `testnet-snapshot-h1620000-8d7d8a30-r1` records public testnet through block 1,620,000. See the [release page](https://archive.v1.theqrl.org/testnet/release/), [data index](https://data.v1.theqrl.org/index.json) and [signed manifest](https://data.v1.theqrl.org/testnet/snapshots/testnet-snapshot-h1620000-8d7d8a30-r1/manifest.json). This repository contains the static explorer pages and read-only query adapter; release objects are served from the data host.

The public QRL testnet and mainnet remain live. The snapshot does not stop or seal either network. Pages and lookup results identify the cutoff; later blocks and current balances are outside the release. The browser checks hashes of query files it reads and the release page gives independent signature verification instructions.

The testnet block, transaction and address pages now provide read-only historical lookups using the published snapshot. Historical consensus replay, full isolated terminal rehearsals, clean-room recovery and the final archive remain pending.
