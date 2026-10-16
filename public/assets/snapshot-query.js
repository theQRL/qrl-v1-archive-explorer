// Read-only queries over immutable, bounded lookup packs. No node/RPC access.
const CONFIG_SCHEMA = 'qrl.v1.archive.explorer-activation.v1';
const PACK_SCHEMA = 'qrl.v1.archive.query-packs.v1';
const SIGNED_REPORT_SCHEMA = 'qrl.v1.archive.snapshot-inventory.v2';
const SERVED_REPORT_SCHEMA = 'qrl.v1.archive.served-verification.v1';
const TRUSTED_KEY_SHA256 = '8cf05c32a7cb69dfe27e5137b27baedf4ab0008a0684f36e59aa2553ff8f0c5f';
const ARTIFACT_CONTEXT = 'qrl-v1-testnet-archive-release-signatures';
const MAX_CACHE_BYTES = 24 * 1024 * 1024;
const HEX_64 = /^[0-9a-f]{64}$/;
const QRL_ADDRESS = /^Q[0-9a-fA-F]{78}$/;
const RELEASE_ID = /^[a-z0-9][a-z0-9-]{7,119}$/;
const PACK_PATH = /^(?:blocks\/height\/height-[0-9]{6}\.json|blocks\/hash\/block-hash-[0-9a-f]{2}\.bin|transactions\/hash\/tx-hash-[0-9a-f]{2}\.bin|addresses\/address-(?:index-[0-9a-f]{2}\.json|events-[0-9a-f]{2}\.bin))$/;
const EVENT_BYTES = 54;
const PAGE_SIZE = 25;

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

function hex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function fromHex(value) {
  return Uint8Array.from(value.match(/../g), (pair) => Number.parseInt(pair, 16));
}

async function sha256(bytes) {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
}

function safeUrl(url, releaseId, { query = false } = {}) {
  const parsed = new URL(url);
  requireValue(parsed.protocol === 'https:' && parsed.hostname === 'data.v1.theqrl.org',
    'release URL must use the archive data domain');
  requireValue(!parsed.search && !parsed.hash, 'release URL has a query or fragment');
  requireValue(parsed.pathname.startsWith(`/testnet/snapshots/${releaseId}/`),
    'release URL is outside its immutable snapshot prefix');
  if (query) requireValue(parsed.pathname === `/testnet/snapshots/${releaseId}/query/`,
    'query URL must name the signed query directory');
  return parsed;
}

function safeReportPath(path, releaseId, name) {
  requireValue(path === `/testnet/reports/${releaseId}/${name}`,
    'verification report must be the exact same-origin Pages path');
}

async function fetchBytes(fetcher, url, options = {}) {
  const response = await fetcher(url, options);
  requireValue(response.ok, `archive request failed (${response.status})`);
  return { response, bytes: new Uint8Array(await response.arrayBuffer()) };
}

async function fetchHashedJson(fetcher, url, expectedHash) {
  const { bytes } = await fetchBytes(fetcher, url, { cache: 'no-store' });
  requireValue(await sha256(bytes) === expectedHash, 'release metadata digest differs');
  return JSON.parse(new TextDecoder().decode(bytes));
}

function assertDigest(value, name) {
  requireValue(typeof value === 'string' && HEX_64.test(value), `${name} is not SHA-256`);
}

export async function validateQrlAddress(address) {
  requireValue(QRL_ADDRESS.test(address), 'invalid QRL address format');
  const normalized = address.toUpperCase();
  const raw = fromHex(normalized.slice(1));
  // QRL v1 addressIsValid checks length, SHA256_2X format nibble, then checksum.
  // It deliberately permits other unusual descriptor bits present on mainnet.
  requireValue((raw[1] & 0xf0) === 0, 'unsupported QRL address format');
  const checksum = new Uint8Array(await crypto.subtle.digest('SHA-256', raw.subarray(0, 35)));
  requireValue(hex(raw.subarray(35)) === hex(checksum.subarray(28)), 'invalid QRL address checksum');
  return normalized;
}

function assertReceipt(receipt) {
  requireValue(receipt?.schema === CONFIG_SCHEMA && receipt.status === 'VERIFIED',
    'signed snapshot activation is unavailable');
  requireValue(receipt.network === 'testnet' && RELEASE_ID.test(receipt.release_id),
    'snapshot identity is invalid');
  requireValue(Number.isSafeInteger(receipt.snapshot_height) && receipt.snapshot_height >= 0,
    'snapshot height is invalid');
  assertDigest(receipt.snapshot_hash, 'snapshot hash');
  assertDigest(receipt.canonical_stream_sha256, 'canonical stream digest');
  assertDigest(receipt.source_sqlite_sha256, 'derived SQLite digest');
  assertDigest(receipt.query_index_sha256, 'query index digest');
  for (const key of ['signed_report', 'served_report', 'manifest', 'manifest_signature']) {
    requireValue(receipt[key] && typeof receipt[key].url === 'string', `${key} is missing`);
    assertDigest(receipt[key].sha256, `${key} digest`);
  }
  safeReportPath(receipt.signed_report.url, receipt.release_id,
    'signed-verify-report.json');
  safeReportPath(receipt.served_report.url, receipt.release_id,
    'served-verify-report.json');
  safeUrl(receipt.manifest.url, receipt.release_id);
  safeUrl(receipt.manifest_signature.url, receipt.release_id);
  requireValue(receipt.manifest.url ===
    `https://data.v1.theqrl.org/testnet/snapshots/${receipt.release_id}/manifest.json` &&
    receipt.manifest_signature.url ===
    `https://data.v1.theqrl.org/testnet/snapshots/${receipt.release_id}/manifest.json.sig`,
  'signed manifest URLs differ from the release layout');
  safeUrl(receipt.query_base_url, receipt.release_id, { query: true });
}

function compareHash(left, right) {
  for (let i = 0; i < 32; i += 1) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return 0;
}

class SnapshotQuery {
  constructor(receipt, packIndex, signed, fetcher) {
    this.release = Object.freeze({
      id: receipt.release_id,
      height: receipt.snapshot_height,
      hash: receipt.snapshot_hash,
      network: receipt.network,
      manifestUrl: receipt.manifest.url,
      manifestSignatureUrl: receipt.manifest_signature.url,
      signaturesUrl: `https://data.v1.theqrl.org/testnet/snapshots/${receipt.release_id}/signatures.txt`,
      trustedKeySha256: signed.trusted_key_sha256,
      securityCommit: signed.security_commit,
      balanceLabel: packIndex.snapshot_balance_label,
      consensusReplayed: packIndex.consensus_replayed,
    });
    this.base = receipt.query_base_url;
    this.fetcher = fetcher;
    this.files = new Map(packIndex.files.map((file) => [file.path, file]));
    this.cache = new Map();
    this.cacheBytes = 0;
  }

  async fullPack(path) {
    requireValue(this.files.has(path), 'lookup pack is absent from the signed index');
    if (this.cache.has(path)) {
      const cached = this.cache.get(path);
      this.cache.delete(path);
      this.cache.set(path, cached);
      return cached;
    }
    const file = this.files.get(path);
    const url = new URL(path, this.base).toString();
    const { bytes } = await fetchBytes(this.fetcher, url);
    requireValue(bytes.length === file.bytes && await sha256(bytes) === file.sha256,
      'lookup pack digest differs');
    if (bytes.length <= MAX_CACHE_BYTES) {
      while (this.cacheBytes + bytes.length > MAX_CACHE_BYTES) {
        const oldest = this.cache.keys().next().value;
        this.cacheBytes -= this.cache.get(oldest).length;
        this.cache.delete(oldest);
      }
      this.cache.set(path, bytes);
      this.cacheBytes += bytes.length;
    }
    return bytes;
  }

  async jsonPack(path) {
    return JSON.parse(new TextDecoder().decode(await this.fullPack(path)));
  }

  async blockByHeight(height) {
    requireValue(Number.isSafeInteger(height) && height >= 0 && height <= this.release.height,
      'block height is outside the snapshot');
    const path = `blocks/height/height-${String(Math.floor(height / 1000)).padStart(6, '0')}.json`;
    const pack = await this.jsonPack(path);
    requireValue(pack.schema === PACK_SCHEMA && pack.first_height <= height &&
      pack.last_height >= height, 'block pack identity differs');
    const block = pack.blocks[height - pack.first_height];
    requireValue(block?.height === height, 'block pack has a missing height');
    if (height === this.release.height) {
      requireValue(block.hash === this.release.hash, 'snapshot tip differs');
    }
    return block;
  }

  async hashLookup(folder, stem, hashValue, recordBytes) {
    requireValue(typeof hashValue === 'string' && HEX_64.test(hashValue.toLowerCase()),
      'hash must have 64 hex characters');
    const target = fromHex(hashValue.toLowerCase());
    const path = `${folder}/hash/${stem}-${hashValue.slice(0, 2).toLowerCase()}.bin`;
    if (!this.files.has(path)) return null;
    const bytes = await this.fullPack(path);
    requireValue(bytes.length % recordBytes === 0, 'hash index record width differs');
    let low = 0;
    let high = bytes.length / recordBytes;
    while (low < high) {
      const mid = (low + high) >>> 1;
      const offset = mid * recordBytes;
      if (compareHash(bytes.subarray(offset, offset + 32), target) < 0) low = mid + 1;
      else high = mid;
    }
    if (low >= bytes.length / recordBytes) return null;
    const offset = low * recordBytes;
    if (compareHash(bytes.subarray(offset, offset + 32), target) !== 0) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, recordBytes);
    return recordBytes === 36
      ? { height: view.getUint32(32, false) }
      : { height: view.getUint32(32, false), index: view.getUint32(36, false) };
  }

  async blockByHash(hashValue) {
    const location = await this.hashLookup('blocks', 'block-hash', hashValue, 36);
    if (!location) return null;
    const block = await this.blockByHeight(location.height);
    requireValue(block.hash === hashValue.toLowerCase(), 'block hash index differs');
    return block;
  }

  async transactionByHash(hashValue) {
    const location = await this.hashLookup('transactions', 'tx-hash', hashValue, 40);
    if (!location) return null;
    const block = await this.blockByHeight(location.height);
    const transaction = block.transactions[location.index];
    requireValue(transaction?.index === location.index &&
      transaction.hash === hashValue.toLowerCase(), 'transaction hash index differs');
    return { block_height: block.height, block_hash: block.hash, transaction };
  }

  async addressPage(address, page = 0) {
    requireValue(Number.isSafeInteger(page) && page >= 0, 'address page must be nonnegative');
    const normalized = await validateQrlAddress(address);
    const raw = fromHex(normalized.slice(1));
    const bucket = (await sha256(raw)).slice(0, 2);
    const index = await this.jsonPack(`addresses/address-index-${bucket}.json`);
    requireValue(index.schema === PACK_SCHEMA && index.record_bytes === EVENT_BYTES,
      'address index schema differs');
    const entry = index.addresses[normalized];
    if (!entry) return null;
    const pages = Math.ceil(entry.count / PAGE_SIZE);
    requireValue(page < pages || (page === 0 && pages === 0), 'address page is outside history');
    const count = Math.min(PAGE_SIZE, entry.count - page * PAGE_SIZE);
    const events = [];
    if (count > 0) {
      const path = `addresses/address-events-${bucket}.bin`;
      const file = this.files.get(path);
      requireValue(file && Number.isSafeInteger(entry.offset) && entry.offset >= 0 &&
        entry.offset + entry.count * EVENT_BYTES <= file.bytes,
        'address event location is invalid');
      const start = entry.offset + page * PAGE_SIZE * EVENT_BYTES;
      const end = start + count * EVENT_BYTES - 1;
      const url = new URL(path, this.base).toString();
      const fetcher = this.fetcher;
      const response = await fetcher(url, { headers: { Range: `bytes=${start}-${end}` } });
      requireValue(response.status === 206 &&
        response.headers.get('Content-Range') === `bytes ${start}-${end}/${file.bytes}`,
        'address event server did not honor the exact byte range');
      const bytes = new Uint8Array(await response.arrayBuffer());
      requireValue(bytes.length === count * EVENT_BYTES, 'address event response length differs');
      requireValue(Array.isArray(entry.page_sha256) &&
        entry.page_sha256.length === pages &&
        await sha256(bytes) === entry.page_sha256[page],
        'address event page digest differs');
      for (let offset = 0; offset < bytes.length; offset += EVENT_BYTES) {
        const view = new DataView(bytes.buffer, bytes.byteOffset + offset, EVENT_BYTES);
        const role = index.roles[view.getUint8(40)];
        requireValue(typeof role === 'string', 'unknown address event role');
        events.push({
          height: view.getUint32(0, false), tx_index: view.getUint32(4, false),
          tx_hash: hex(bytes.subarray(offset + 8, offset + 40)),
          role, output_index: view.getInt32(41, false),
          amount_shor: view.getUint8(53) === 1 ? view.getBigUint64(45, false).toString() : null,
        });
      }
    }
    return { address: normalized, page, page_size: PAGE_SIZE, pages,
      event_count: entry.count, balance_shor: entry.balance_shor,
      balance_source: entry.balance_source,
      balance_label: this.release.balanceLabel, events };
  }
}

// The config file is intentionally absent until a separately reviewed release
// has a signed manifest, an independent qrlft report and a served-byte report.
export async function openSnapshot({ configUrl = '/testnet/snapshot-config.json',
                                     fetcher = fetch } = {}) {
  const configResponse = await fetcher(configUrl, { cache: 'no-store' });
  if (configResponse.status === 404) return null;
  requireValue(configResponse.ok, 'snapshot activation request failed');
  const receipt = await configResponse.json();
  assertReceipt(receipt);

  const signed = await fetchHashedJson(fetcher, receipt.signed_report.url,
    receipt.signed_report.sha256);
  requireValue(signed.schema === SIGNED_REPORT_SCHEMA && signed.tag === receipt.release_id &&
    signed.height === receipt.snapshot_height && signed.hash === receipt.snapshot_hash &&
    signed.signed_verified === true && signed.structural_verified === true &&
    signed.derived_verified === true && signed.snapshot_eligible === true &&
    signed.query_logical_comparison_report_checked === true &&
    signed.sqlite_reassembled_verified === true &&
    Number.isSafeInteger(signed.payload_count) && signed.payload_count > 0 &&
    signed.signature_count === signed.payload_count + 1 &&
    signed.trusted_key_sha256 === TRUSTED_KEY_SHA256 &&
    /^[0-9a-f]{40}$/.test(signed.security_commit) &&
    signed.manifest_signature_sha256 === receipt.manifest_signature.sha256,
    'independent signing verification did not pass for this snapshot');
  const served = await fetchHashedJson(fetcher, receipt.served_report.url,
    receipt.served_report.sha256);
  requireValue(served.schema === SERVED_REPORT_SCHEMA && served.status === 'PASS' &&
    served.mode === 'public' && served.public_origin === 'https://data.v1.theqrl.org' &&
    served.tag === receipt.release_id && served.height === receipt.snapshot_height &&
    served.hash === receipt.snapshot_hash && served.all_objects_verified === true &&
    served.derived_verified === true && served.snapshot_eligible === true &&
    served.sha256_and_sha3_256_equal === true &&
    served.independent_signature_verification === true &&
    served.object_count === signed.payload_count + 3 &&
    served.trusted_key_sha256 === TRUSTED_KEY_SHA256 &&
    served.security_commit === signed.security_commit &&
    served.inventory_sha256 === signed.inventory_sha256 &&
    served.signatures_sha256 === signed.signatures_sha256 &&
    served.manifest_signature_sha256 === receipt.manifest_signature.sha256,
    'served-byte verification did not pass for this snapshot');

  const manifest = await fetchHashedJson(fetcher, receipt.manifest.url,
    receipt.manifest.sha256);
  const signature = await fetchBytes(fetcher, receipt.manifest_signature.url,
    { cache: 'no-store' });
  requireValue(await sha256(signature.bytes) === receipt.manifest_signature.sha256 &&
    signature.bytes.length > 100, 'signed manifest signature is unavailable');
  requireValue(manifest.schema === 'theqrl.release-manifest.v1' &&
    manifest.product === 'qrl-v1-testnet-archive' && manifest.tag === receipt.release_id &&
    manifest.context === ARTIFACT_CONTEXT && Array.isArray(manifest.artifacts) &&
    manifest.artifacts.length === signed.payload_count,
    'signed manifest identity differs');
  requireValue(signed.manifest_sha256 === receipt.manifest.sha256 &&
    served.manifest_sha256 === receipt.manifest.sha256,
    'verification reports do not bind to this manifest');

  const indexUrl = new URL('query-packs-index.json', receipt.query_base_url).toString();
  const index = await fetchHashedJson(fetcher, indexUrl, receipt.query_index_sha256);
  requireValue(index.schema === PACK_SCHEMA && index.network === 'testnet' &&
    index.snapshot_height === receipt.snapshot_height &&
    index.snapshot_hash === receipt.snapshot_hash &&
    index.canonical_stream_sha256 === receipt.canonical_stream_sha256 &&
    index.source_sqlite_sha256 === receipt.source_sqlite_sha256 &&
    index.snapshot_kind === 'live-chain-point-in-time' &&
    index.snapshot_balance_label === 'observed-at-cutoff-two-node-agreement' &&
    index.consensus_replayed === false &&
    index.event_record_bytes === EVENT_BYTES && index.height_pack_size === 1000,
    'query index is not bound to this snapshot');
  const signedFiles = new Map(manifest.artifacts.map((item) => [item.filename, item]));
  requireValue(signedFiles.size === manifest.artifacts.length,
    'signed manifest has duplicate artefact names');
  requireValue(signedFiles.get('query-packs-index.json')?.sha256 === receipt.query_index_sha256,
    'query index is absent from signed manifest');
  const names = new Set();
  for (const file of index.files) {
    requireValue(typeof file.path === 'string' && PACK_PATH.test(file.path) &&
      Number.isSafeInteger(file.bytes) && file.bytes >= 0 &&
      file.bytes <= 64 * 1024 * 1024 && HEX_64.test(file.sha256) &&
      HEX_64.test(file.sha3_256),
      'query index contains an invalid file');
    const name = file.path.split('/').at(-1);
    requireValue(!names.has(name), 'query pack basenames are not unique');
    names.add(name);
    requireValue(signedFiles.get(name)?.sha256 === file.sha256 &&
      signedFiles.get(name)?.size === file.bytes,
      'query pack is absent from signed manifest');
  }
  return new SnapshotQuery(receipt, index, signed, fetcher);
}
