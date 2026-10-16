import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { openSnapshot, validateQrlAddress } from '../src/snapshot-query.mjs';

const base = 'https://data.v1.theqrl.org/testnet/snapshots/test-release-001/';
const queryBase = `${base}query/`;
const encoder = new TextEncoder();
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = (value) => encoder.encode(`${JSON.stringify(value)}\n`);

function fixture() {
  const blockHash = `ab${'00'.repeat(31)}`;
  const txHash = `cd${'00'.repeat(31)}`;
  const prefix = Buffer.from(`010400${'11'.repeat(32)}`, 'hex');
  const addressBytes = Buffer.concat([prefix, createHash('sha256').update(prefix).digest().subarray(28)]);
  const address = `Q${addressBytes.toString('hex').toUpperCase()}`;
  const addressBucket = digest(addressBytes).slice(0, 2);
  const event = Buffer.alloc(54);
  event.writeUInt32BE(0, 0);
  event.writeUInt32BE(0, 4);
  Buffer.from(txHash, 'hex').copy(event, 8);
  event.writeUInt8(3, 40);
  event.writeInt32BE(0, 41);
  event.writeBigUInt64BE(10n, 45);
  event.writeUInt8(1, 53);
  const blockIndex = Buffer.alloc(36);
  Buffer.from(blockHash, 'hex').copy(blockIndex);
  blockIndex.writeUInt32BE(0, 32);
  const txIndex = Buffer.alloc(40);
  Buffer.from(txHash, 'hex').copy(txIndex);
  txIndex.writeUInt32BE(0, 32);
  txIndex.writeUInt32BE(0, 36);
  const roles = ['from', 'signer', 'master', 'coinbase_receive', 'receive',
    'token_receive', 'token_initial', 'message_to', 'slave_key',
    'multisig_spend_source', 'token_owner', 'multisig_created', 'multisig_signatory'];
  const packs = new Map([
    ['blocks/height/height-000000.json', json({
      schema: 'qrl.v1.archive.query-packs.v1', first_height: 0, last_height: 0,
      blocks: [{ height: 0, hash: blockHash, previous_hash: null, timestamp: 123,
        block_reward_shor: '10', fee_reward_shor: '0', transactions: [{
          hash: txHash, index: 0, kind: 'coinbase', fee_shor: '0',
          outputs: [{ index: 0, address, amount_shor: '10' }],
          details: { kind: 'coinbase' },
        }] }],
    })],
    ['blocks/hash/block-hash-ab.bin', blockIndex],
    ['transactions/hash/tx-hash-cd.bin', txIndex],
    [`addresses/address-index-${addressBucket}.json`, json({
      schema: 'qrl.v1.archive.query-packs.v1', record_bytes: 54, roles,
      addresses: { [address]: { offset: 0, count: 1,
        balance_shor: null, balance_source: null,
        page_sha256: [digest(event)] } },
    })],
    [`addresses/address-events-${addressBucket}.bin`, event],
  ]);
  const canonicalStream = 'f'.repeat(64);
  const sourceSqlite = 'e'.repeat(64);
  const packIndex = {
    schema: 'qrl.v1.archive.query-packs.v1', network: 'testnet',
    snapshot_height: 0, snapshot_hash: blockHash,
    canonical_stream_sha256: canonicalStream,
    source_sqlite_sha256: sourceSqlite,
    snapshot_kind: 'live-chain-point-in-time',
    snapshot_balance_label: 'observed-at-cutoff-two-node-agreement',
    consensus_replayed: false,
    height_pack_size: 1000, event_record_bytes: 54,
    files: Array.from(packs, ([path, bytes]) => ({ path, bytes: bytes.length,
      sha256: digest(bytes), sha3_256: createHash('sha3-256').update(bytes).digest('hex') })),
  };
  const packIndexBytes = json(packIndex);
  const manifest = {
    schema: 'theqrl.release-manifest.v1', product: 'qrl-v1-testnet-archive',
    tag: 'test-release-001', context: 'qrl-v1-testnet-archive-release-signatures',
    artifacts: [
      { filename: 'query-packs-index.json', size: packIndexBytes.length,
        sha256: digest(packIndexBytes) },
      ...Array.from(packs, ([path, bytes]) => ({
        filename: path.split('/').at(-1), size: bytes.length, sha256: digest(bytes),
      })),
    ],
  };
  const manifestBytes = json(manifest);
  const signature = encoder.encode('a'.repeat(200));
  const signedReport = {
    schema: 'qrl.v1.archive.snapshot-inventory.v2', tag: 'test-release-001',
    height: 0, hash: blockHash, signed_verified: true,
    structural_verified: true, manifest_sha256: digest(manifestBytes),
    derived_verified: true, snapshot_eligible: true,
    query_logical_comparison_report_checked: true,
    sqlite_reassembled_verified: true,
    payload_count: manifest.artifacts.length,
    signature_count: manifest.artifacts.length + 1,
    manifest_signature_sha256: digest(signature),
    inventory_sha256: 'd'.repeat(64), signatures_sha256: 'c'.repeat(64),
    trusted_key_sha256: '8cf05c32a7cb69dfe27e5137b27baedf4ab0008a0684f36e59aa2553ff8f0c5f',
    security_commit: 'a'.repeat(40),
  };
  const servedReport = {
    schema: 'qrl.v1.archive.served-verification.v1', status: 'PASS',
    mode: 'public', public_origin: 'https://data.v1.theqrl.org',
    tag: 'test-release-001', height: 0, hash: blockHash,
    all_objects_verified: true, derived_verified: true, snapshot_eligible: true,
    sha256_and_sha3_256_equal: true, independent_signature_verification: true,
    object_count: manifest.artifacts.length + 3,
    manifest_sha256: digest(manifestBytes),
    manifest_signature_sha256: digest(signature),
    inventory_sha256: 'd'.repeat(64), signatures_sha256: 'c'.repeat(64),
    trusted_key_sha256: signedReport.trusted_key_sha256,
    security_commit: signedReport.security_commit,
  };
  const signedBytes = json(signedReport);
  const servedBytes = json(servedReport);
  const receipt = {
    schema: 'qrl.v1.archive.explorer-activation.v1', status: 'VERIFIED',
    network: 'testnet', release_id: 'test-release-001',
    snapshot_height: 0, snapshot_hash: blockHash,
    canonical_stream_sha256: canonicalStream,
    source_sqlite_sha256: sourceSqlite,
    query_base_url: queryBase, query_index_sha256: digest(packIndexBytes),
    signed_report: { url: '/testnet/reports/test-release-001/signed-verify-report.json',
      sha256: digest(signedBytes) },
    served_report: { url: '/testnet/reports/test-release-001/served-verify-report.json',
      sha256: digest(servedBytes) },
    manifest: { url: `${base}manifest.json`, sha256: digest(manifestBytes) },
    manifest_signature: { url: `${base}manifest.json.sig`, sha256: digest(signature) },
  };
  const files = new Map([
    ['/testnet/snapshot-config.json', json(receipt)],
    [receipt.signed_report.url, signedBytes],
    [receipt.served_report.url, servedBytes],
    [receipt.manifest.url, manifestBytes],
    [receipt.manifest_signature.url, signature],
    [`${queryBase}query-packs-index.json`, packIndexBytes],
    ...Array.from(packs, ([path, bytes]) => [`${queryBase}${path}`, bytes]),
  ]);
  const requests = [];
  const fetcher = async (url, options = {}) => {
    requests.push([url, options]);
    const data = files.get(url);
    if (!data) return new Response(null, { status: 404 });
    const range = options.headers?.Range;
    if (range) {
      const [, first, last] = /^bytes=(\d+)-(\d+)$/.exec(range);
      const start = Number(first);
      const end = Number(last);
      return new Response(data.subarray(start, end + 1), {
        status: 206, headers: { 'Content-Range': `bytes ${start}-${end}/${data.length}` },
      });
    }
    return new Response(data);
  };
  return { fetcher, files, requests, address, blockHash, txHash };
}

test('no activation file leaves the explorer disabled', async () => {
  const query = await openSnapshot({ fetcher: async () => new Response(null, { status: 404 }) });
  assert.equal(query, null);
});

test('verified local fixture supports exact block, transaction and address lookups', async () => {
  const item = fixture();
  const query = await openSnapshot({ fetcher: item.fetcher });
  assert.equal((await query.blockByHeight(0)).hash, item.blockHash);
  assert.equal((await query.blockByHash(item.blockHash)).height, 0);
  const transaction = await query.transactionByHash(item.txHash);
  assert.equal(transaction.transaction.outputs[0].address, item.address);
  const address = await query.addressPage(item.address);
  assert.equal(address.events[0].tx_hash, item.txHash);
  assert.equal(address.events[0].amount_shor, '10');
  assert.equal(address.balance_shor, null);
  assert.ok(item.requests.some(([, options]) => options.headers?.Range === 'bytes=0-53'));
});

test('address range fetch calls a native-style fetcher without a receiver', async () => {
  const item = fixture();
  function strictFetch(url, options) {
    assert.equal(this, undefined);
    return item.fetcher(url, options);
  }
  const query = await openSnapshot({ fetcher: strictFetch });
  const address = await query.addressPage(item.address);
  assert.equal(address.events.length, 1);
});

test('a changed query pack fails its signed digest check', async () => {
  const item = fixture();
  const path = `${queryBase}blocks/hash/block-hash-ab.bin`;
  const changed = new Uint8Array(item.files.get(path));
  changed[0] ^= 1;
  item.files.set(path, changed);
  const query = await openSnapshot({ fetcher: item.fetcher });
  await assert.rejects(query.blockByHash(item.blockHash), /digest differs/);
});

test('a changed address byte range fails its signed page digest check', async () => {
  const item = fixture();
  const query = await openSnapshot({ fetcher: item.fetcher });
  const bucket = digest(Buffer.from(item.address.slice(1), 'hex')).slice(0, 2);
  const path = `${queryBase}addresses/address-events-${bucket}.bin`;
  const changed = new Uint8Array(item.files.get(path));
  changed[8] ^= 1;
  item.files.set(path, changed);
  await assert.rejects(query.addressPage(item.address), /page digest differs/);
});

test('address validation matches QRL v1 consensus fixtures', async () => {
  // QRL's regression fixture accepts this otherwise unusual mainnet descriptor.
  const known = 'Q0C0D00E3ACDE5FA627B3C0F2D723108C265F16B9667A19D811B3C99AC329028EC8ABF52FC5CCA6';
  assert.equal(await validateQrlAddress(known), known);
  const corrupt = `${known.slice(0, -2)}00`;
  await assert.rejects(validateQrlAddress(corrupt), /checksum/);
  const wrongFormat = Buffer.from(known.slice(1), 'hex');
  wrongFormat[1] = 0x12;
  createHash('sha256').update(wrongFormat.subarray(0, 35)).digest().copy(wrongFormat, 35, 28);
  await assert.rejects(validateQrlAddress(`Q${wrongFormat.toString('hex').toUpperCase()}`), /address format/);
});
