import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';

const outputRoot = new URL('../public/testnet/', import.meta.url);

const pages = [
  {
    slug: 'explore',
    title: 'Explore the testnet archive',
    intro: 'Browse a point-in-time testnet snapshot after this page checks its release details.',
    content: `
      <section class="container-site py-12 sm:py-16" aria-labelledby="lookup-routes">
        <p class="section-eyebrow">Lookup routes</p>
        <h2 id="lookup-routes" class="section-heading mt-2">Choose a record type</h2>
        <div class="mt-8 grid gap-4 md:grid-cols-3">
          <article class="card card-border bg-base-200">
            <div class="card-body">
              <h3 class="card-title">Blocks</h3>
              <p class="text-base-content/75">Find a block by height or hash in an operator-verified snapshot release.</p>
              <div class="card-actions mt-3"><a class="btn btn-outline" href="/testnet/blocks/">View block lookup</a></div>
            </div>
          </article>
          <article class="card card-border bg-base-200">
            <div class="card-body">
              <h3 class="card-title">Transactions</h3>
              <p class="text-base-content/75">Find a transaction by its hash, including multi-output transfers.</p>
              <div class="card-actions mt-3"><a class="btn btn-outline" href="/testnet/transactions/">View transaction lookup</a></div>
            </div>
          </article>
          <article class="card card-border bg-base-200">
            <div class="card-body">
              <h3 class="card-title">Addresses</h3>
              <p class="text-base-content/75">View archived activity and a balance at the release cutoff.</p>
              <div class="card-actions mt-3"><a class="btn btn-outline" href="/testnet/addresses/">View address lookup</a></div>
            </div>
          </article>
        </div>
        <p class="mt-6 text-sm text-base-content/60">No live balances, confirmations or network status will be inferred from this archive.</p>
      </section>`,
  },
  {
    slug: 'blocks',
    title: 'Block lookup',
    intro: 'Find blocks by height or hash in a verified point-in-time testnet snapshot.',
    content: `
      <section class="container-site py-12 sm:py-16" aria-labelledby="block-search">
        <p class="section-eyebrow">Blocks</p>
        <h2 id="block-search" class="section-heading mt-2">Search the snapshot</h2>
        <div class="card card-border mt-8 max-w-3xl bg-base-200">
          <div class="card-body gap-5">
            <fieldset disabled class="grid gap-5">
              <legend class="font-semibold">Search is unavailable</legend>
              <div class="grid gap-4 sm:grid-cols-2">
                <label class="grid gap-2" for="block-height"><span>Block height</span><input id="block-height" class="input w-full" type="text" inputmode="numeric" placeholder="Height" autocomplete="off"></label>
                <label class="grid gap-2" for="block-hash"><span>Block hash</span><input id="block-hash" class="input w-full" type="text" placeholder="Hex hash" autocomplete="off"></label>
              </div>
              <div><button class="btn btn-primary" type="button">Find block</button></div>
            </fieldset>
            <p id="search-help" class="text-sm text-base-content/70">Block lookup becomes available after the release check.</p>
          </div>
        </div>
      </section>`,
  },
  {
    slug: 'transactions',
    title: 'Transaction lookup',
    intro: 'Find a transaction by hash in a verified point-in-time testnet snapshot.',
    content: `
      <section class="container-site py-12 sm:py-16" aria-labelledby="transaction-search">
        <p class="section-eyebrow">Transactions</p>
        <h2 id="transaction-search" class="section-heading mt-2">Search by transaction hash</h2>
        <div class="card card-border mt-8 max-w-3xl bg-base-200">
          <div class="card-body gap-5">
            <fieldset disabled class="grid gap-5">
              <legend class="font-semibold">Search is unavailable</legend>
              <label class="grid gap-2" for="transaction-hash"><span>Transaction hash</span><input id="transaction-hash" class="input w-full" type="text" placeholder="Hex hash" autocomplete="off"></label>
              <div><button class="btn btn-primary" type="button">Find transaction</button></div>
            </fieldset>
            <p id="search-help" class="text-sm text-base-content/70">A published result will list every recipient and amount for a multi-output transfer.</p>
          </div>
        </div>
      </section>`,
  },
  {
    slug: 'addresses',
    title: 'Address lookup',
    intro: 'Find historical address activity through the snapshot cutoff. A balance appears only when independently checked final state is included.',
    content: `
      <section class="container-site py-12 sm:py-16" aria-labelledby="address-search">
        <p class="section-eyebrow">Addresses</p>
        <h2 id="address-search" class="section-heading mt-2">Search by QRL address</h2>
        <div class="card card-border mt-8 max-w-3xl bg-base-200">
          <div class="card-body gap-5">
            <fieldset disabled class="grid gap-5">
              <legend class="font-semibold">Search is unavailable</legend>
              <label class="grid gap-2" for="qrl-address"><span>QRL address</span><input id="qrl-address" class="input w-full" type="text" placeholder="QRL address" autocomplete="off"></label>
              <div><button class="btn btn-primary" type="button">Find address</button></div>
            </fieldset>
            <p id="search-help" class="text-sm text-base-content/70">Balances, when available, refer only to the snapshot cutoff. They do not describe the live network.</p>
          </div>
        </div>
      </section>`,
  },
  {
    slug: 'release',
    title: 'Release status',
    intro: 'This page checks the testnet snapshot release and shows its identity, cutoff and verification links when available.',
    content: `
      <section class="container-site py-12 sm:py-16" aria-labelledby="release-details">
        <p class="section-eyebrow">Release identity</p>
        <h2 id="release-details" class="section-heading mt-2">Release details</h2>
        <div class="card card-border mt-8 max-w-4xl bg-base-200">
          <div class="card-body">
            <dl class="divide-y divide-base-content/10">
              <div class="grid gap-1 py-3 sm:grid-cols-2"><dt class="text-base-content/65">Rehearsal release ID</dt><dd id="release-id" class="font-semibold">Checking release</dd></div>
              <div class="grid gap-1 py-3 sm:grid-cols-2"><dt class="text-base-content/65">Snapshot cutoff</dt><dd id="release-cutoff" class="font-semibold">Checking release</dd></div>
              <div class="grid gap-1 py-3 sm:grid-cols-2"><dt class="text-base-content/65">Snapshot hash</dt><dd id="release-hash" class="font-semibold break-all">Checking release</dd></div>
              <div class="grid gap-1 py-3 sm:grid-cols-2"><dt class="text-base-content/65">Signed manifest</dt><dd id="release-manifest" class="font-semibold">Checking release</dd></div>
              <div class="grid gap-1 py-3 sm:grid-cols-2"><dt class="text-base-content/65">Manifest signature</dt><dd id="release-signature" class="font-semibold">Checking release</dd></div>
              <div class="grid gap-1 py-3 sm:grid-cols-2"><dt class="text-base-content/65">Artefact signatures</dt><dd id="release-signatures" class="font-semibold">Checking release</dd></div>
              <div class="grid gap-1 py-3 sm:grid-cols-2"><dt class="text-base-content/65">Trusted key SHA-256</dt><dd id="release-key-hash" class="font-mono text-sm break-all">Checking release</dd></div>
              <div class="grid gap-1 py-3 sm:grid-cols-2"><dt class="text-base-content/65">Pinned key repository commit</dt><dd id="release-security-commit" class="font-mono text-sm break-all">Checking release</dd></div>
            </dl>
          </div>
        </div>
        <div class="card card-border mt-6 max-w-4xl bg-base-200"><div class="card-body gap-3">
          <h3 class="card-title">Verify independently</h3>
          <p class="text-sm text-base-content/70">The browser checks SHA-256 of query files it reads; it does not verify ML-DSA. Download the manifest, its signature and the pinned <a id="release-key-link" class="link link-primary" href="https://github.com/theQRL/security/blob/master/theqrl-release-key.pub">QRL release public key</a>, then verify the manifest with <a class="link link-primary" href="https://github.com/theQRL/qrlft">qrlft</a>:</p>
          <pre class="overflow-x-auto whitespace-pre-wrap break-all text-xs"><code>qrlft verify -a mldsa --context=qrl-v1-testnet-archive-release-manifest --sigfile=manifest.json.sig --pkfile=theqrl-release-key.pub manifest.json</code></pre>
          <p class="text-sm text-base-content/70">Check the key digest shown above. Each artefact signature in <code>signatures.txt</code> uses the separate <code>qrl-v1-testnet-archive-release-signatures</code> context. Verify every signed artefact against its manifest digest before trusting the complete release.</p>
        </div></div>
        <div class="card card-border mt-6 max-w-4xl bg-base-200"><div class="card-body gap-3">
          <h3 class="card-title">Reconstruct the block history</h3>
          <p class="text-sm text-base-content/70">The canonical archive has 163 ordered block shards. The format guide gives the byte layout, signed download checks and exact-byte reconstruction procedure.</p>
          <div class="card-actions"><a class="btn btn-outline" href="/testnet/shard-format/">Read the shard format guide</a></div>
        </div></div>
        <p class="mt-6 max-w-3xl text-sm text-base-content/65">A point-in-time snapshot records testnet only through its stated cutoff. The public testnet can continue producing later blocks.</p>
      </section>`,
  },
  {
    slug: 'shard-format',
    title: 'Reconstruct the block history',
    intro: 'Read and verify every canonical block shard, then recover the exact stored protobuf bytes for each testnet block through height 1,620,000.',
    content: await readFile(new URL('./shard-format.html', import.meta.url), 'utf8'),
  },
];

function render(page) {
  return `<!doctype html>
<html lang="en" data-brand="dawn" data-theme="qrl-dawn" class="scheme-only-dark antialiased">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex,nofollow,noarchive">
    <meta name="theme-color" content="#0a1720">
    <title>${page.title} | QRL v1 testnet archive rehearsal</title>
    <link rel="preload" href="/assets/fonts/archivo.woff2" as="font" type="font/woff2" crossorigin>
    <link rel="preload" href="/assets/fonts/source-sans-3.woff2" as="font" type="font/woff2" crossorigin>
    <link rel="stylesheet" href="/assets/site.css">
  </head>
  <body class="flex min-h-dvh flex-col" data-snapshot-page="${page.slug}">
    <a class="skip-link" href="#main">Skip to content</a>
    <header class="site-header">
      <div class="container-site navbar min-h-16 gap-3">
        <div class="navbar-start min-w-0">
          <a href="/" aria-label="QRL v1 archive home" class="flex min-w-0 items-center gap-3">
            <img src="/assets/qrl-logo.svg" width="96" height="34" alt="QRL" class="h-8 w-auto shrink-0">
            <span class="hidden border-l border-base-content/20 pl-3 font-display font-semibold tracking-tight sm:inline">v1 archive</span>
          </a>
        </div>
        <div class="navbar-end"><span id="snapshot-badge" class="badge badge-warning badge-outline min-h-7 whitespace-nowrap text-base sm:text-sm">Checking release</span></div>
      </div>
    </header>

    <main id="main" class="isolate flex-1">
      <section class="hero-surface border-b border-base-content/10">
        <div class="container-site py-12 sm:py-16">
          <p class="kicker">Testnet archive rehearsal</p>
          <h1 class="mt-3 max-w-[22ch] font-display text-hero font-semibold tracking-tight text-balance">${page.title}</h1>
          <p id="page-intro" class="mt-5 max-w-[64ch] text-lead text-base-content/75 text-pretty">${page.intro}</p>
          <div role="alert" class="alert alert-warning alert-outline mt-8 max-w-4xl">
            <div>
              <p id="snapshot-alert-title" class="font-semibold">This is a testnet archive rehearsal.</p>
              <p id="snapshot-alert-description" class="mt-1">This page checks the snapshot release before enabling read-only lookups. The public QRL v1 testnet and mainnet remain live.</p>
            </div>
          </div>
          <nav class="mt-8 flex flex-wrap gap-2" aria-label="Testnet archive pages">
            <a class="btn btn-outline btn-sm min-h-12 sm:min-h-9" href="/testnet/">Testnet status</a>
            <a class="btn btn-outline btn-sm min-h-12 sm:min-h-9" href="/testnet/explore/">Lookups</a>
            <a class="btn btn-outline btn-sm min-h-12 sm:min-h-9" href="/testnet/release/">Release status</a>
            <a class="btn btn-outline btn-sm min-h-12 sm:min-h-9" href="/testnet/shard-format/">Shard format</a>
          </nav>
        </div>
      </section>
      ${page.content}
      <section id="snapshot-result" class="container-site pb-12 sm:pb-16" hidden aria-live="polite"></section>
    </main>

    <footer class="footer footer-center border-t border-base-content/10 bg-base-200 p-6 text-base text-base-content/60 sm:text-sm">
      <aside><p id="snapshot-footer">QRL v1 testnet archive rehearsal. Checking snapshot release details.</p></aside>
    </footer>
    <script type="module" src="/assets/snapshot-page.js"></script>
  </body>
</html>
`;
}

for (const page of pages) {
  const dir = new URL(`${page.slug}/`, outputRoot);
  await mkdir(dir, { recursive: true });
  await writeFile(new URL('index.html', dir), render(page));
  console.log(`Built public/testnet/${page.slug}/index.html`);
}

await copyFile(new URL('./snapshot-query.mjs', import.meta.url),
  new URL('../public/assets/snapshot-query.js', import.meta.url));
await copyFile(new URL('./snapshot-page.mjs', import.meta.url),
  new URL('../public/assets/snapshot-page.js', import.meta.url));
