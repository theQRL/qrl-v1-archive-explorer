"""The bounded query packs retain exact lookup keys and address events."""

import importlib.util
import hashlib
import json
import sqlite3
import struct
import tempfile
import unittest
from pathlib import Path


MODULE = Path(__file__).resolve().parents[1] / "src" / "build-query-packs.py"
SPEC = importlib.util.spec_from_file_location("build_query_packs", MODULE)
PACKS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PACKS)
VERIFY_SPEC = importlib.util.spec_from_file_location(
    "verify_query_packs", MODULE.with_name("verify-query-packs.py"))
VERIFY = importlib.util.module_from_spec(VERIFY_SPEC)
VERIFY_SPEC.loader.exec_module(VERIFY)


class QueryPackTest(unittest.TestCase):
    def test_build_and_read_exact_keys(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "sample.sqlite"
            output = root / "packs.partial"
            address = bytes.fromhex("010400" + "11" * 32 + "22222222")
            block_hash = bytes.fromhex("ab" + "00" * 31)
            tx_hash = bytes.fromhex("cd" + "00" * 31)
            with sqlite3.connect(source) as db:
                db.executescript("""
                    CREATE TABLE archive_meta(key TEXT PRIMARY KEY,value TEXT);
                    CREATE TABLE blocks(height INTEGER PRIMARY KEY,hash BLOB,previous_hash BLOB,
                        timestamp INTEGER,merkle_root BLOB,mining_nonce TEXT,block_reward_shor TEXT,
                        fee_reward_shor TEXT,tx_count INTEGER,canonical_shard TEXT,
                        canonical_offset INTEGER,canonical_length INTEGER);
                    CREATE TABLE transactions(tx_hash BLOB PRIMARY KEY,height INTEGER,tx_index INTEGER,
                        kind TEXT,from_address BLOB,signer_address BLOB,master_address BLOB,
                        fee_shor TEXT,nonce TEXT);
                    CREATE TABLE tx_details(tx_hash BLOB,decoded_json TEXT);
                    CREATE TABLE tx_outputs(tx_hash BLOB,output_index INTEGER,to_address BLOB,
                        amount_shor TEXT,asset_id BLOB);
                    CREATE TABLE address_events(address BLOB,height INTEGER,tx_index INTEGER,
                        tx_hash BLOB,role TEXT,output_index INTEGER,amount_shor TEXT);
                    CREATE TABLE final_address_state(address BLOB,balance_shor TEXT,source TEXT);
                """)
                db.executemany("INSERT INTO archive_meta VALUES (?,?)", [
                    ("schema", "qrl-v1-sqlite-v1"), ("network_id", "testnet"),
                    ("terminal_height", "0"), ("terminal_hash", block_hash.hex()),
                    ("genesis_hash", block_hash.hex()),
                    ("snapshot_eligible", "true"),
                    ("snapshot_kind", "live-chain-point-in-time"),
                    ("snapshot_balance_label", "observed-at-cutoff-two-node-agreement"),
                    ("consensus_replayed", "false"),
                    ("block_count", "1"), ("transaction_count", "1"),
                ])
                db.execute("INSERT INTO blocks VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", (
                    0, block_hash, None, 123, None, "0", "10", "0", 1,
                    "canonical-000000.qrlblk", 16, 200,
                ))
                db.execute("INSERT INTO transactions VALUES (?,?,?,?,?,?,?,?,?)", (
                    tx_hash, 0, 0, "coinbase", None, None, None, "0", "0",
                ))
                db.execute("INSERT INTO tx_details VALUES (?,?)", (
                    tx_hash, '{"kind":"coinbase","schema":"fixture"}',
                ))
                db.execute("INSERT INTO tx_outputs VALUES (?,?,?,?,?)", (
                    tx_hash, 0, address, "10", None,
                ))
                db.execute("INSERT INTO address_events VALUES (?,?,?,?,?,?,?)", (
                    address, 0, 0, tx_hash, "coinbase_receive", 0, "10",
                ))
                db.commit()
            report = PACKS.build(source, output, expected_height=0,
                                 expected_hash=block_hash.hex(),
                                 canonical_stream_sha256="f" * 64)
            self.assertEqual(report["status"], "local-partial-not-signed")
            self.assertEqual(report["block_count"], 1)
            self.assertEqual(report["transaction_count"], 1)
            height_pack = json.loads((output / "blocks/height/height-000000.json").read_text())
            self.assertEqual(height_pack["blocks"][0]["hash"], block_hash.hex())
            self.assertEqual(height_pack["blocks"][0]["transactions"][0]["outputs"][0]["amount_shor"], "10")
            self.assertEqual(struct.unpack(">32sI", (output / "blocks/hash/block-hash-ab.bin").read_bytes()),
                             (block_hash, 0))
            self.assertEqual(struct.unpack(">32sII", (output / "transactions/hash/tx-hash-cd.bin").read_bytes()),
                             (tx_hash, 0, 0))
            bucket = __import__("hashlib").sha256(address).hexdigest()[:2]
            index = json.loads((output / f"addresses/address-index-{bucket}.json").read_text())
            entry = index["addresses"]["Q" + address.hex().upper()]
            self.assertEqual(entry["count"], 1)
            event = (output / f"addresses/address-events-{bucket}.bin").read_bytes()
            self.assertEqual(len(event), PACKS.EVENT_RECORD_BYTES)
            self.assertEqual(struct.unpack(">II32sBiQB", event), (0, 0, tx_hash, 3, 0, 10, 1))
            self.assertEqual(entry["page_sha256"], [hashlib.sha256(event).hexdigest()])
            verdict = VERIFY.verify(source, output)
            self.assertEqual(verdict["status"], "PASS")
            self.assertEqual(verdict["source_sqlite_sha256"], hashlib.sha256(source.read_bytes()).hexdigest())
            self.assertFalse(verdict["release_ready"])


if __name__ == "__main__":
    unittest.main()
