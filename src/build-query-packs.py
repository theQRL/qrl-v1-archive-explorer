#!/usr/bin/env python3
"""Build bounded, read-only browser lookup packs from a verified SQLite snapshot.

The output directory must be new and end in `.partial`. These derived files are
not a release: they need logical checks, signing, upload and served-byte checks.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sqlite3
import struct
from pathlib import Path


SCHEMA = "qrl.v1.archive.query-packs.v1"
EVENT_RECORD_BYTES = 54
HEIGHT_PACK_SIZE = 1000
MAX_HEIGHT_PACK_BYTES = 8 * 1024 * 1024
ROLES = (
    "from", "signer", "master", "coinbase_receive", "receive",
    "token_receive", "token_initial", "message_to", "slave_key",
    "multisig_spend_source", "token_owner", "multisig_created",
    "multisig_signatory",
)
ROLE_ID = {role: index for index, role in enumerate(ROLES)}


def _hex(value: bytes | None) -> str | None:
    return None if value is None else value.hex()


def _address(value: bytes | None) -> str | None:
    return None if value is None else "Q" + value.hex().upper()


def _json_bytes(value: object) -> bytes:
    return (json.dumps(value, sort_keys=True, separators=(",", ":"),
                       ensure_ascii=True) + "\n").encode("ascii")


def _write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("xb") as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())


def _transaction_groups(db: sqlite3.Connection):
    rows = db.execute("""
        SELECT t.height,t.tx_index,t.tx_hash,t.kind,t.from_address,
               t.signer_address,t.master_address,t.fee_shor,t.nonce,
               d.decoded_json,o.output_index,o.to_address,o.amount_shor,o.asset_id
        FROM transactions t JOIN tx_details d ON d.tx_hash=t.tx_hash
        LEFT JOIN tx_outputs o ON o.tx_hash=t.tx_hash
        ORDER BY t.height,t.tx_index,o.output_index
    """)
    current_key = None
    transaction = None
    for row in rows:
        key = (row[0], row[1])
        if key != current_key:
            if transaction is not None:
                yield current_key[0], transaction
            transaction = {
                "hash": _hex(row[2]), "index": row[1], "kind": row[3],
                "from_address": _address(row[4]),
                "signer_address": _address(row[5]),
                "master_address": _address(row[6]),
                "fee_shor": row[7], "nonce": row[8],
                "details": json.loads(row[9]), "outputs": [],
            }
            current_key = key
        if row[10] is not None:
            transaction["outputs"].append({
                "index": row[10], "address": _address(row[11]),
                "amount_shor": row[12], "asset_id": _hex(row[13]),
            })
    if transaction is not None:
        yield current_key[0], transaction


def _build_heights(db: sqlite3.Connection, root: Path, expected_count: int) -> int:
    tx_iter = iter(_transaction_groups(db))
    next_tx = next(tx_iter, None)
    pack = []
    count = 0
    for row in db.execute("""
        SELECT height,hash,previous_hash,timestamp,merkle_root,mining_nonce,
               block_reward_shor,fee_reward_shor,tx_count,canonical_shard,
               canonical_offset,canonical_length FROM blocks ORDER BY height
    """):
        height = row[0]
        if height != count:
            raise ValueError(f"missing or reordered block at {count}")
        transactions = []
        while next_tx is not None and next_tx[0] == height:
            transactions.append(next_tx[1])
            next_tx = next(tx_iter, None)
        if len(transactions) != row[8]:
            raise ValueError(f"transaction count differs at block {height}")
        pack.append({
            "height": height, "hash": _hex(row[1]),
            "previous_hash": _hex(row[2]), "timestamp": row[3],
            "merkle_root": _hex(row[4]), "mining_nonce": row[5],
            "block_reward_shor": row[6], "fee_reward_shor": row[7],
            "canonical": {"shard": row[9], "offset": row[10], "length": row[11]},
            "transactions": transactions,
        })
        count += 1
        if len(pack) == HEIGHT_PACK_SIZE or count == expected_count:
            first = pack[0]["height"]
            data = _json_bytes({
                "schema": SCHEMA, "first_height": first,
                "last_height": pack[-1]["height"], "blocks": pack,
            })
            if len(data) > MAX_HEIGHT_PACK_BYTES:
                raise ValueError(f"height pack {first} exceeds 8 MiB")
            _write(root / "blocks" / "height" / f"height-{first // HEIGHT_PACK_SIZE:06d}.json", data)
            pack = []
    if next_tx is not None or count != expected_count:
        raise ValueError("transaction or block rows remain after cutoff")
    return count


def _build_hash_index(db: sqlite3.Connection, root: Path, *, transaction: bool) -> int:
    if transaction:
        folder, sql = "transactions", "SELECT tx_hash,height,tx_index FROM transactions ORDER BY tx_hash"
        record = struct.Struct(">32sII")
    else:
        folder, sql = "blocks", "SELECT hash,height FROM blocks ORDER BY hash"
        record = struct.Struct(">32sI")
    current = None
    stream = None
    count = 0
    try:
        for row in db.execute(sql):
            digest = row[0]
            if len(digest) != 32:
                raise ValueError(f"invalid {folder} hash length")
            prefix = digest[0]
            if prefix != current:
                if stream is not None:
                    stream.flush()
                    os.fsync(stream.fileno())
                    stream.close()
                stem = "tx-hash" if transaction else "block-hash"
                path = root / folder / "hash" / f"{stem}-{prefix:02x}.bin"
                path.parent.mkdir(parents=True, exist_ok=True)
                stream = path.open("xb")
                current = prefix
            stream.write(record.pack(*row))
            count += 1
    finally:
        if stream is not None and not stream.closed:
            stream.flush()
            os.fsync(stream.fileno())
            stream.close()
    return count


def _event_bytes(height: int, tx_index: int, tx_hash: bytes, role: str,
                 output_index: int, amount: str | None) -> bytes:
    if len(tx_hash) != 32 or role not in ROLE_ID:
        raise ValueError("invalid address event")
    if amount is None:
        present, value = 0, 0
    else:
        if not amount.isdecimal() or (amount.startswith("0") and amount != "0"):
            raise ValueError("invalid event amount")
        present, value = 1, int(amount)
    return struct.pack(">II32sBiQB", height, tx_index, tx_hash,
                       ROLE_ID[role], output_index, value, present)


def _build_addresses(db: sqlite3.Connection, root: Path) -> tuple[int, int]:
    folder = root / "addresses"
    folder.mkdir(parents=True, exist_ok=True)
    streams = []
    indices = [dict() for _ in range(256)]
    positions = [0] * 256
    event_count = 0
    address_count = 0
    try:
        for bucket in range(256):
            streams.append((folder / f"address-events-{bucket:02x}.bin").open("xb"))
        rows = db.execute("""
            SELECT e.address,e.height,e.tx_index,e.tx_hash,e.role,
                   e.output_index,e.amount_shor,s.balance_shor,s.source
            FROM address_events e
            LEFT JOIN final_address_state s ON s.address=e.address
            ORDER BY e.address,e.height DESC,e.tx_index DESC,e.role,e.output_index
        """)
        last_address = None
        entry = None
        for row in rows:
            address = row[0]
            if len(address) != 39:
                raise ValueError("invalid QRL address length")
            if address != last_address:
                bucket = hashlib.sha256(address).digest()[0]
                key = _address(address)
                if key in indices[bucket]:
                    raise ValueError("address events are not contiguous")
                entry = {"offset": positions[bucket], "count": 0,
                         "balance_shor": row[7], "balance_source": row[8]}
                indices[bucket][key] = entry
                last_address = address
                address_count += 1
            data = _event_bytes(*row[1:7])
            streams[bucket].write(data)
            positions[bucket] += len(data)
            entry["count"] += 1
            event_count += 1
        for address, balance, source in db.execute(
            "SELECT address,balance_shor,source FROM final_address_state ORDER BY address"
        ):
            bucket = hashlib.sha256(address).digest()[0]
            key = _address(address)
            if key not in indices[bucket]:
                indices[bucket][key] = {"offset": positions[bucket], "count": 0,
                                        "balance_shor": balance, "balance_source": source}
                address_count += 1
    finally:
        for stream in streams:
            stream.flush()
            os.fsync(stream.fileno())
            stream.close()
    for bucket, index in enumerate(indices):
        with (folder / f"address-events-{bucket:02x}.bin").open("rb") as stream:
            for entry in index.values():
                stream.seek(entry["offset"])
                remaining = entry["count"]
                pages = []
                while remaining:
                    rows = min(25, remaining)
                    data = stream.read(rows * EVENT_RECORD_BYTES)
                    if len(data) != rows * EVENT_RECORD_BYTES:
                        raise ValueError("address event page is incomplete")
                    pages.append(hashlib.sha256(data).hexdigest())
                    remaining -= rows
                entry["page_sha256"] = pages
        _write(folder / f"address-index-{bucket:02x}.json", _json_bytes({
            "schema": SCHEMA, "record_bytes": EVENT_RECORD_BYTES,
            "roles": list(ROLES), "addresses": index,
        }))
    return address_count, event_count


def _file_inventory(root: Path) -> list[dict]:
    entries = []
    for path in sorted(root.rglob("*")):
        if not path.is_file() or path.name in {"query-packs-report.json", "query-packs-index.json"}:
            continue
        sha256 = hashlib.sha256()
        sha3 = hashlib.sha3_256()
        size = 0
        with path.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                size += len(chunk)
                sha256.update(chunk)
                sha3.update(chunk)
        entries.append({"path": path.relative_to(root).as_posix(),
                        "bytes": size, "sha256": sha256.hexdigest(),
                        "sha3_256": sha3.hexdigest()})
    return entries


def build(source: Path, output: Path, *, expected_height: int,
          expected_hash: str, canonical_stream_sha256: str) -> dict:
    if not output.name.endswith(".partial") or output.exists():
        raise ValueError("output must be a new directory ending in .partial")
    if not source.is_file():
        raise ValueError("SQLite source file does not exist")
    output.mkdir(parents=True)
    db = sqlite3.connect(f"file:{source}?mode=ro&immutable=1", uri=True)
    try:
        meta = dict(db.execute("SELECT key,value FROM archive_meta"))
        if (meta.get("schema") != "qrl-v1-sqlite-v1"
                or meta.get("network_id") != "testnet"
                or meta.get("snapshot_eligible") != "true"
                or meta.get("snapshot_kind") != "live-chain-point-in-time"
                or meta.get("terminal_height") != str(expected_height)
                or meta.get("terminal_hash") != expected_hash
                or int(meta.get("block_count", "-1")) != expected_height + 1):
            raise ValueError("source database identity does not match snapshot")
        if db.execute("PRAGMA integrity_check").fetchone() != ("ok",):
            raise ValueError("source database integrity_check failed")
        block_count = _build_heights(db, output, expected_height + 1)
        if _build_hash_index(db, output, transaction=False) != block_count:
            raise ValueError("block hash index count differs")
        transaction_count = _build_hash_index(db, output, transaction=True)
        if transaction_count != int(meta["transaction_count"]):
            raise ValueError("transaction hash index count differs")
        address_count, event_count = _build_addresses(db, output)
        if event_count != db.execute("SELECT count(*) FROM address_events").fetchone()[0]:
            raise ValueError("address event count differs")
        files = _file_inventory(output)
        index = {
            "schema": SCHEMA,
            "network": "testnet", "snapshot_height": expected_height,
            "snapshot_hash": expected_hash,
            "snapshot_kind": meta["snapshot_kind"],
            "snapshot_balance_label": meta.get("snapshot_balance_label"),
            "consensus_replayed": meta.get("consensus_replayed") == "true",
            "source_sqlite_sha256": _file_sha256(source),
            "canonical_stream_sha256": canonical_stream_sha256,
            "genesis_hash": meta.get("genesis_hash"),
            "block_count": block_count,
            "transaction_count": transaction_count,
            "address_count": address_count, "event_count": event_count,
            "height_pack_size": HEIGHT_PACK_SIZE,
            "event_record_bytes": EVENT_RECORD_BYTES,
            "files": files,
        }
        _write(output / "query-packs-index.json", _json_bytes(index))
        report = {**index, "status": "local-partial-not-signed"}
        _write(output / "query-packs-report.json", _json_bytes(report))
        return report
    finally:
        db.close()


def _file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sqlite", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--height", type=int, required=True)
    parser.add_argument("--hash", required=True)
    parser.add_argument("--canonical-sha256", required=True)
    args = parser.parse_args()
    if (args.height < 0 or any(len(value) != 64 or
            any(c not in "0123456789abcdef" for c in value)
            for value in (args.hash, args.canonical_sha256))):
        parser.error("height must be nonnegative and digests lowercase 64-character hex")
    report = build(args.sqlite, args.output, expected_height=args.height,
                   expected_hash=args.hash,
                   canonical_stream_sha256=args.canonical_sha256)
    print(json.dumps({key: report[key] for key in (
        "status", "block_count", "transaction_count", "address_count",
        "event_count", "snapshot_height")}, sort_keys=True))


if __name__ == "__main__":
    main()
