#!/usr/bin/env python3
"""Independently check lookup-pack bytes and key mappings against SQLite."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sqlite3
import struct
from pathlib import Path


SCHEMA = "qrl.v1.archive.query-packs.v1"
ROLES = (
    "from", "signer", "master", "coinbase_receive", "receive",
    "token_receive", "token_initial", "message_to", "slave_key",
    "multisig_spend_source", "token_owner", "multisig_created",
    "multisig_signatory",
)


def _fail(message: str):
    raise ValueError(message)


def _hash_file(path: Path):
    sha256, sha3 = hashlib.sha256(), hashlib.sha3_256()
    size = 0
    with path.open("rb") as stream:
        while data := stream.read(1024 * 1024):
            size += len(data)
            sha256.update(data)
            sha3.update(data)
    return size, sha256.hexdigest(), sha3.hexdigest()


def _read_json(path: Path):
    return json.loads(path.read_text("ascii"))


def _verify_files(root: Path, index: dict):
    files = index["files"]
    if not isinstance(files, list) or not files:
        _fail("query index has no files")
    names, paths = set(), set()
    total = maximum = 0
    for entry in files:
        name = entry["path"]
        path = Path(name)
        if path.is_absolute() or ".." in path.parts or name in paths or path.name in names:
            _fail("query index path or basename is unsafe or duplicated")
        if not (root / path).is_file() or (root / path).is_symlink():
            _fail(f"query file missing or symlinked: {name}")
        size, sha256, sha3 = _hash_file(root / path)
        if (size, sha256, sha3) != (entry["bytes"], entry["sha256"], entry["sha3_256"]):
            _fail(f"query file digest differs: {name}")
        paths.add(name)
        names.add(path.name)
        total += size
        maximum = max(maximum, size)
    actual = {path.relative_to(root).as_posix() for path in root.rglob("*")
              if path.is_file() and path.name not in
              {"query-packs-index.json", "query-packs-report.json"}}
    if paths != actual:
        _fail("query directory has unlisted files or missing listed files")
    return len(files), total, maximum


def _verify_heights(db: sqlite3.Connection, root: Path, index: dict):
    expected = 0
    tx_rows = iter(db.execute("SELECT tx_hash,height,tx_index FROM transactions ORDER BY height,tx_index"))
    next_tx = next(tx_rows, None)
    blocks = db.execute("SELECT height,hash,previous_hash,timestamp,tx_count FROM blocks ORDER BY height")
    for source in blocks:
        height = source[0]
        if height != expected:
            _fail("source block heights are not contiguous")
        path = root / "blocks/height" / f"height-{height // 1000:06d}.json"
        if height % 1000 == 0:
            pack = _read_json(path)
            if pack.get("schema") != SCHEMA or pack.get("first_height") != height:
                _fail(f"height pack identity differs at {height}")
        block = pack["blocks"][height - pack["first_height"]]
        if (block["height"], block["hash"], block["previous_hash"],
            block["timestamp"], len(block["transactions"])) != (
                source[0], source[1].hex(), source[2].hex() if source[2] else None,
                source[3], source[4]):
            _fail(f"height pack differs from source at {height}")
        for tx in block["transactions"]:
            if next_tx is None or (tx["hash"], height, tx["index"]) != (
                    next_tx[0].hex(), next_tx[1], next_tx[2]):
                _fail(f"transaction order differs at {height}")
            next_tx = next(tx_rows, None)
        expected += 1
    if expected != index["block_count"] or next_tx is not None:
        _fail("height/transaction count differs")
    return expected


def _verify_hash_index(db: sqlite3.Connection, root: Path,
                       folder: str, stem: str, sql: str, row_format: str):
    record = struct.Struct(row_format)
    opened = None
    current = None
    count = 0
    try:
        for row in db.execute(sql):
            prefix = row[0][0]
            if prefix != current:
                if opened is not None:
                    if opened.read(1):
                        _fail(f"{folder} hash index has extra records")
                    opened.close()
                current = prefix
                path = root / folder / "hash" / f"{stem}-{prefix:02x}.bin"
                opened = path.open("rb")
            if opened.read(record.size) != record.pack(*row):
                _fail(f"{folder} hash index differs at record {count}")
            count += 1
    finally:
        if opened is not None and not opened.closed:
            if opened.read(1):
                _fail(f"{folder} hash index has extra records")
            opened.close()
    return count


def _verify_addresses(db: sqlite3.Connection, root: Path, index: dict):
    indices = [_read_json(root / "addresses" / f"address-index-{bucket:02x}.json")
               for bucket in range(256)]
    streams = [(root / "addresses" / f"address-events-{bucket:02x}.bin").open("rb")
               for bucket in range(256)]
    positions = [0] * 256
    count = 0
    seen = set()
    actual_counts = {}
    try:
        for bucket, page in enumerate(indices):
            if page.get("schema") != SCHEMA or page.get("record_bytes") != 54 or page.get("roles") != list(ROLES):
                _fail(f"address index schema differs for bucket {bucket}")
        for address, height, tx_index, tx_hash, role, output_index, amount in db.execute("""
            SELECT address,height,tx_index,tx_hash,role,output_index,amount_shor
            FROM address_events
            ORDER BY address,height DESC,tx_index DESC,role,output_index
        """):
            bucket = hashlib.sha256(address).digest()[0]
            key = "Q" + address.hex().upper()
            entry = indices[bucket]["addresses"].get(key)
            if entry is None:
                _fail(f"address index missing {key}")
            if key not in seen:
                if entry["offset"] != positions[bucket]:
                    _fail(f"address offset differs at {key}")
                seen.add(key)
            actual_counts[key] = actual_counts.get(key, 0) + 1
            present = amount is not None
            record = struct.pack(">II32sBiQB", height, tx_index, tx_hash,
                                 ROLES.index(role), output_index,
                                 int(amount) if present else 0, int(present))
            if streams[bucket].read(54) != record:
                _fail(f"address event differs at event {count}")
            positions[bucket] += 54
            count += 1
        for bucket, stream in enumerate(streams):
            if stream.read(1):
                _fail(f"address event bucket {bucket} has extra bytes")
            if positions[bucket] != (root / "addresses" / f"address-events-{bucket:02x}.bin").stat().st_size:
                _fail(f"address event bucket {bucket} size differs")
        state_addresses = set()
        for address, balance, source in db.execute(
            "SELECT address,balance_shor,source FROM final_address_state ORDER BY address"
        ):
            bucket = hashlib.sha256(address).digest()[0]
            key = "Q" + address.hex().upper()
            entry = indices[bucket]["addresses"].get(key)
            if entry is None or entry["balance_shor"] != balance or entry["balance_source"] != source:
                _fail(f"final observed state differs at {key}")
            state_addresses.add(key)
        indexed_count = sum(entry["count"] for page in indices
                            for entry in page["addresses"].values())
        indexed_addresses = {key for page in indices for key in page["addresses"]}
        if indexed_addresses != seen | state_addresses:
            _fail("address index has an unmatched or missing address")
        for page in indices:
            for key, entry in page["addresses"].items():
                if entry["count"] != actual_counts.get(key, 0):
                    _fail(f"address event count differs at {key}")
        for bucket, page in enumerate(indices):
            with (root / "addresses" / f"address-events-{bucket:02x}.bin").open("rb") as stream:
                for key, entry in page["addresses"].items():
                    expected_pages = (entry["count"] + 24) // 25
                    if len(entry.get("page_sha256", [])) != expected_pages:
                        _fail(f"address page digest count differs at {key}")
                    stream.seek(entry["offset"])
                    remaining = entry["count"]
                    for expected_digest in entry["page_sha256"]:
                        rows = min(25, remaining)
                        data = stream.read(rows * 54)
                        if len(data) != rows * 54 or hashlib.sha256(data).hexdigest() != expected_digest:
                            _fail(f"address page digest differs at {key}")
                        remaining -= rows
        if count != index["event_count"] or count != indexed_count:
            _fail("address event count differs")
        return len(indexed_addresses), count, len(state_addresses)
    finally:
        for stream in streams:
            stream.close()


def verify(source: Path, root: Path) -> dict:
    index = _read_json(root / "query-packs-index.json")
    if index.get("schema") != SCHEMA or index.get("network") != "testnet":
        _fail("query index schema or network differs")
    source_sqlite_sha256 = _hash_file(source)[1]
    query_index_sha256 = _hash_file(root / "query-packs-index.json")[1]
    db = sqlite3.connect(f"file:{source}?mode=ro&immutable=1", uri=True)
    try:
        meta = dict(db.execute("SELECT key,value FROM archive_meta"))
        if (meta.get("snapshot_eligible") != "true"
                or meta.get("snapshot_kind") != "live-chain-point-in-time"
                or index.get("snapshot_kind") != meta["snapshot_kind"]
                or index.get("snapshot_balance_label") != meta.get("snapshot_balance_label")
                or index.get("consensus_replayed") is not False
                or index.get("source_sqlite_sha256") != source_sqlite_sha256
                or index.get("snapshot_height") != int(meta["terminal_height"])
                or index.get("snapshot_hash") != meta["terminal_hash"]
                or index.get("genesis_hash") != meta["genesis_hash"]
                or index.get("block_count") != int(meta["block_count"])
                or index.get("transaction_count") != int(meta["transaction_count"])):
            _fail("query index is not bound to source SQLite")
        file_count, total, maximum = _verify_files(root, index)
        block_count = _verify_heights(db, root, index)
        block_hash_count = _verify_hash_index(db, root, "blocks", "block-hash",
            "SELECT hash,height FROM blocks ORDER BY hash", ">32sI")
        tx_hash_count = _verify_hash_index(db, root, "transactions", "tx-hash",
            "SELECT tx_hash,height,tx_index FROM transactions ORDER BY tx_hash", ">32sII")
        address_count, event_count, observed_state_count = _verify_addresses(db, root, index)
        if block_hash_count != block_count or tx_hash_count != index["transaction_count"]:
            _fail("hash-index counts differ")
        return {
            "schema": SCHEMA, "status": "PASS", "release_ready": False,
            "network": "testnet", "snapshot_height": index["snapshot_height"],
            "snapshot_hash": index["snapshot_hash"],
            "source_sqlite_sha256": source_sqlite_sha256,
            "query_index_sha256": query_index_sha256,
            "canonical_stream_sha256": index["canonical_stream_sha256"],
            "file_count": file_count, "total_bytes": total,
            "max_file_bytes": maximum, "block_count": block_count,
            "transaction_count": tx_hash_count,
            "address_count": address_count,
            "observed_account_state_count": observed_state_count,
            "event_count": event_count,
            "sha256_sha3_checked": True,
            "sqlite_logical_comparison_passed": True,
            "signed_verified": False, "served_bytes_verified": False,
        }
    finally:
        db.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sqlite", type=Path, required=True)
    parser.add_argument("--packs", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    if args.report.exists():
        parser.error("report already exists")
    result = verify(args.sqlite, args.packs)
    with args.report.open("x", encoding="ascii") as stream:
        json.dump(result, stream, sort_keys=True, separators=(",", ":"))
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    main()
