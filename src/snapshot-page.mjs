import { openSnapshot } from './snapshot-query.js';

const page = document.body.dataset.snapshotPage;
const result = document.getElementById('snapshot-result');

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = String(text);
  if (className) node.className = className;
  return node;
}

function link(label, href) {
  const node = element('a', label, 'link link-primary break-all');
  node.href = href;
  return node;
}

function detail(list, label, value) {
  const item = element('div', null, 'grid gap-1 border-b border-base-content/10 py-2 sm:grid-cols-3');
  item.append(element('dt', label, 'text-base-content/65'));
  const description = element('dd', null, 'break-all font-mono text-sm sm:col-span-2');
  description.append(value instanceof Node ? value : document.createTextNode(String(value ?? 'Unavailable')));
  item.append(description);
  list.append(item);
}

function card(title) {
  result.hidden = false;
  result.replaceChildren();
  const article = element('article', null, 'card card-border bg-base-200');
  const body = element('div', null, 'card-body gap-4');
  body.append(element('h2', title, 'card-title'));
  article.append(body);
  result.append(article);
  return body;
}

function error(message) {
  const body = card('Lookup unavailable');
  body.append(element('p', message, 'text-base-content/75'));
}

function renderBlock(block) {
  const body = card(`Block #${block.height.toLocaleString()}`);
  const list = element('dl');
  detail(list, 'Hash', block.hash);
  detail(list, 'Previous hash', block.previous_hash);
  detail(list, 'Time (UTC)', new Date(block.timestamp * 1000).toISOString());
  detail(list, 'Transactions', block.transactions.length);
  detail(list, 'Block reward (shor)', block.block_reward_shor);
  detail(list, 'Fee reward (shor)', block.fee_reward_shor);
  body.append(list);
  body.append(element('h3', 'Transactions', 'font-semibold'));
  const transactions = element('ul', null, 'grid gap-2');
  for (const tx of block.transactions) {
    const item = element('li');
    item.append(link(`${tx.kind}: ${tx.hash}`,
      `/testnet/transactions/?hash=${encodeURIComponent(tx.hash)}`));
    transactions.append(item);
  }
  body.append(transactions);
}

function renderTransaction(location) {
  const tx = location.transaction;
  const body = card('Transaction');
  const list = element('dl');
  detail(list, 'Hash', tx.hash);
  detail(list, 'Type', tx.kind);
  detail(list, 'Block', link(`#${location.block_height.toLocaleString()}`,
    `/testnet/blocks/?height=${location.block_height}`));
  detail(list, 'Sender', tx.from_address || 'None');
  detail(list, 'Signer', tx.signer_address || 'None');
  detail(list, 'Master address', tx.master_address || 'None');
  detail(list, 'Fee (shor)', tx.fee_shor);
  body.append(list);
  body.append(element('h3', 'Outputs', 'font-semibold'));
  if (tx.outputs.length === 0) {
    body.append(element('p', 'This transaction has no transfer outputs.'));
  } else {
    const tableWrap = element('div', null, 'overflow-x-auto');
    const table = element('table', null, 'table table-zebra');
    const head = element('thead');
    const headRow = element('tr');
    for (const label of ['Output', 'Recipient', 'Amount (raw units)', 'Asset ID']) headRow.append(element('th', label));
    head.append(headRow);
    const tableBody = element('tbody');
    for (const output of tx.outputs) {
      const row = element('tr');
      row.append(element('td', output.index));
      const address = element('td');
      address.append(link(output.address,
        `/testnet/addresses/?address=${encodeURIComponent(output.address)}`));
      row.append(address, element('td', output.amount_shor, 'font-mono'),
        element('td', output.asset_id ?? 'QRL', 'font-mono break-all'));
      tableBody.append(row);
    }
    table.append(head, tableBody);
    tableWrap.append(table);
    body.append(tableWrap);
    body.append(element('p',
      'QRL amounts are in shor. Token amounts are raw token units and identify their asset ID above.',
      'text-sm text-base-content/65'));
  }
  const disclosure = element('details');
  disclosure.append(element('summary', 'Decoded transaction fields', 'cursor-pointer font-semibold'));
  disclosure.append(element('pre', JSON.stringify(tx.details, null, 2),
    'mt-3 overflow-x-auto whitespace-pre-wrap break-all text-xs'));
  body.append(disclosure);
}

function renderAddress(address, query) {
  const body = card('Address history');
  const list = element('dl');
  detail(list, 'Address', address.address);
  detail(list, `Balance at block ${query.release.height.toLocaleString()} (shor)`,
    address.balance_shor === null ? 'Unavailable for this snapshot' : address.balance_shor);
  detail(list, 'Balance source', address.balance_shor === null
    ? 'Not published for this address'
    : 'Observed QRL node state at the cutoff, matched by two independently sourced testnet nodes. Consensus replay has not been completed.');
  detail(list, 'History events', address.event_count.toLocaleString());
  detail(list, 'Page', `${address.page + 1} of ${Math.max(1, address.pages)}`);
  body.append(list);
  if (address.events.length) {
    const tableWrap = element('div', null, 'overflow-x-auto');
    const table = element('table', null, 'table table-zebra');
    const head = element('thead');
    const headRow = element('tr');
    for (const label of ['Block', 'Transaction', 'Role', 'Amount (raw units)']) headRow.append(element('th', label));
    head.append(headRow);
    const tableBody = element('tbody');
    for (const event of address.events) {
      const row = element('tr');
      const blockCell = element('td');
      blockCell.append(link(`#${event.height}`,
        `/testnet/blocks/?height=${event.height}`));
      const txCell = element('td', null, 'max-w-52 truncate');
      txCell.append(link(event.tx_hash,
        `/testnet/transactions/?hash=${encodeURIComponent(event.tx_hash)}`));
      row.append(blockCell, txCell, element('td', event.role),
        element('td', event.amount_shor ?? '—', 'font-mono'));
      tableBody.append(row);
    }
    table.append(head, tableBody);
    tableWrap.append(table);
    body.append(tableWrap);
    body.append(element('p',
      'QRL transfer and coinbase amounts are in shor. Token quantities use their own raw units; open the transaction for the token asset ID and details.',
      'text-sm text-base-content/65'));
  } else {
    body.append(element('p', 'No historical events appear for this address.'));
  }
  if (address.pages > 1) {
    const controls = element('nav', null, 'flex flex-wrap gap-2');
    controls.setAttribute('aria-label', 'Address history pages');
    for (const [label, target] of [['Previous', address.page - 1], ['Next', address.page + 1]]) {
      if (target < 0 || target >= address.pages) continue;
      const control = link(label,
        `/testnet/addresses/?address=${encodeURIComponent(address.address)}&page=${target}`);
      control.className = 'btn btn-outline btn-sm';
      controls.append(control);
    }
    body.append(controls);
  }
}

function activateBanner(query) {
  const height = query.release.height.toLocaleString();
  document.getElementById('snapshot-badge').textContent = `Snapshot #${height}`;
  document.getElementById('snapshot-alert-title').textContent =
    `Operator-verified rehearsal snapshot through block ${height}`;
  document.getElementById('snapshot-alert-description').textContent =
    'This is a point-in-time record of an ongoing public testnet. Operators checked the signed release and served bytes before activation; the browser checks queried file hashes. Later blocks and current balances are outside this release.';
  document.getElementById('snapshot-footer').textContent =
    `QRL v1 testnet snapshot ${query.release.id}, cutoff block ${height}. The public testnet continues.`;
  if (page === 'home') {
    document.getElementById('testnet-heading').textContent =
      `Browse testnet through block ${height}`;
    document.getElementById('testnet-intro').textContent =
      'This operator-verified rehearsal snapshot records the public QRL v1 testnet at a fixed cutoff. The network continues, so later blocks and current balances are not shown.';
    document.getElementById('testnet-explore-link').textContent = 'Explore the snapshot';
  }
  if (page === 'release') {
    document.getElementById('page-intro').textContent =
      'This point-in-time release records the public testnet through its stated cutoff. Operators independently verified signatures and public served bytes before activation.';
    document.getElementById('release-details').textContent = 'Snapshot release';
    document.getElementById('release-id').textContent = query.release.id;
    document.getElementById('release-cutoff').textContent = `Block ${height}`;
    document.getElementById('release-hash').textContent = query.release.hash;
    document.getElementById('release-manifest').replaceChildren(
      link('Download signed manifest', query.release.manifestUrl));
    document.getElementById('release-signature').replaceChildren(
      link('Download manifest signature', query.release.manifestSignatureUrl));
    document.getElementById('release-signatures').replaceChildren(
      link('Download artefact signatures', query.release.signaturesUrl));
    document.getElementById('release-key-hash').textContent = query.release.trustedKeySha256;
    document.getElementById('release-security-commit').replaceChildren(link(
      query.release.securityCommit,
      `https://github.com/theQRL/security/commit/${query.release.securityCommit}`));
    document.getElementById('release-key-link').href =
      `https://github.com/theQRL/security/blob/${query.release.securityCommit}/theqrl-release-key.pub`;
  }
}

function activateSearch(query) {
  const fieldset = document.querySelector('fieldset[disabled]');
  if (!fieldset) return;
  fieldset.disabled = false;
  fieldset.querySelector('legend').textContent = 'Search the snapshot';
  const help = document.getElementById('search-help');
  if (help && page === 'blocks') help.textContent =
    `Search published blocks from genesis through ${query.release.height.toLocaleString()}.`;
  const button = fieldset.querySelector('button');
  const params = new URLSearchParams(location.search);
  let run;
  if (page === 'blocks') {
    const height = document.getElementById('block-height');
    const hash = document.getElementById('block-hash');
    height.value = params.get('height') || '';
    hash.value = params.get('hash') || '';
    run = async () => {
      const value = hash.value.trim();
      const heightText = height.value.trim();
      if (!value && !/^(0|[1-9][0-9]*)$/.test(heightText)) {
        throw new Error('enter a block height or hash');
      }
      const block = value ? await query.blockByHash(value) :
        await query.blockByHeight(Number(heightText));
      if (block) renderBlock(block);
      else error('No block matches that hash in this snapshot.');
    };
  } else if (page === 'transactions') {
    const hash = document.getElementById('transaction-hash');
    hash.value = params.get('hash') || '';
    run = async () => {
      const transaction = await query.transactionByHash(hash.value.trim());
      if (transaction) renderTransaction(transaction);
      else error('No transaction matches that hash in this snapshot.');
    };
  } else if (page === 'addresses') {
    const input = document.getElementById('qrl-address');
    input.value = params.get('address') || '';
    run = async () => {
      const address = await query.addressPage(input.value.trim(),
        Number(params.get('page') || 0));
      if (address) renderAddress(address, query);
      else error('No history or final state exists for this address in this snapshot.');
    };
  }
  if (!run) return;
  async function submit(event) {
    event?.preventDefault();
    button.disabled = true;
    try {
      await run();
    } catch (cause) {
      error('The lookup failed or release data did not pass its integrity checks.');
    } finally {
      button.disabled = false;
    }
  }
  button.addEventListener('click', submit);
  fieldset.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') submit(event);
  });
  if (location.search) submit();
}

try {
  const query = await openSnapshot();
  if (query) {
    activateBanner(query);
    activateSearch(query);
  }
} catch {
  // Fail closed and distinguish a failed release check from an absent release.
  document.getElementById('snapshot-badge').textContent = 'Release check failed';
  document.getElementById('snapshot-alert-title').textContent =
    'Snapshot release check failed';
  document.getElementById('snapshot-alert-description').textContent =
    'Lookups remain unavailable because release metadata or queried data did not pass the browser checks. Operators should inspect the signed release and served bytes.';
}
