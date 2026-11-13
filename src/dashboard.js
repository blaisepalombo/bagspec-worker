export function renderDashboard() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#0b0d0c">
  <title>Dashboard | BagSpec</title>
  <style>
    :root { color-scheme:dark; --bg:#0b0d0c; --surface:#131714; --line:#303a33; --ink:#f2f5f2; --muted:#afbeb1; --accent:#93d5a6; --warn:#f0c384; --red:#ffa7a1; }
    * { box-sizing:border-box; }
    html { scroll-behavior:smooth; }
    body { margin:0; background:var(--bg); color:var(--ink); font:16px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif; }
    button,input,select { font:inherit; } button { cursor:pointer; } a { color:inherit; text-underline-offset:3px; }
    :focus-visible { outline:3px solid var(--accent); outline-offset:3px; }
    .visually-hidden { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
    .skip { position:absolute; left:16px; top:-100px; z-index:5; background:var(--accent); color:#08110b; padding:10px 14px; border-radius:6px; font-weight:700; }
    .skip:focus { top:12px; }
    .shell { max-width:1120px; margin:auto; padding:0 24px 72px; }
    header { display:flex; align-items:center; justify-content:space-between; gap:16px; min-height:74px; border-bottom:1px solid var(--line); }
    .brand { font-size:22px; font-weight:760; letter-spacing:-.04em; text-decoration:none; }
    .brand-mark { display:none; }
    .header-right { display:flex; align-items:center; gap:20px; }
    .status { display:flex; align-items:center; gap:4px; font-size:13px; color:var(--muted); }
    .dot { display:inline-block; width:8px; height:8px; border-radius:50%; background:var(--accent); margin-right:6px; }
    .btn { min-height:42px; border:1px solid var(--line); background:transparent; color:var(--ink); border-radius:7px; padding:8px 15px; font-weight:650; }
    .btn:hover { border-color:var(--accent); } .btn:disabled { opacity:.55; cursor:wait; }
    .hero { display:flex; align-items:end; justify-content:space-between; gap:24px; padding:38px 0 27px; }
    .eyebrow { color:var(--accent); font-size:13px; font-weight:720; }
    h1 { font-size:clamp(30px,4vw,42px); line-height:1.18; letter-spacing:-.045em; margin:7px 0 9px; }
    h2 { font-size:20px; letter-spacing:-.025em; margin:0; }
    .sub { color:var(--muted); max-width:690px; margin:0; }
    .hero-note { font-size:13px; color:var(--muted); white-space:nowrap; margin:0 0 3px; }
    .metrics { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:12px; margin-bottom:35px; }
    .metric,.panel,.deal,.list-row { background:var(--surface); border:1px solid var(--line); border-radius:8px; }
    .metric { padding:16px 18px; min-height:112px; }
    .metric small,.facts small { display:block; color:var(--muted); font-size:13px; }
    .metric strong { font-size:27px; letter-spacing:-.04em; display:block; margin-top:5px; line-height:1.15; }
    .metric em { display:block; color:var(--muted); font-size:12px; font-style:normal; margin-top:7px; }
    .section-top { display:flex; align-items:center; justify-content:space-between; gap:16px; margin:0 0 14px; }
    .controls { display:flex; flex-wrap:wrap; align-items:center; gap:12px; margin-bottom:14px; }
    .tabs { display:flex; gap:3px; border-bottom:1px solid var(--line); width:100%; }
    .tab { background:transparent; border:0; border-bottom:3px solid transparent; color:var(--muted); padding:10px 15px; min-height:44px; font-weight:650; }
    .tab.active { border-bottom-color:var(--accent); color:var(--ink); }
    .tab:hover { color:var(--ink); }
    .input,.select { background:var(--surface); color:var(--ink); border:1px solid var(--line); border-radius:7px; padding:9px 12px; min-height:44px; }
    .input { flex:1; min-width:190px; } .select { min-width:170px; }
    .chips { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:18px; }
    .pill { border:1px solid var(--line); background:transparent; color:var(--muted); border-radius:6px; padding:7px 12px; min-height:40px; font-size:13px; }
    .pill.active { color:#07120b; background:var(--accent); border-color:var(--accent); font-weight:700; }
    .pill:hover { border-color:var(--accent); }
    .cards { display:grid; grid-template-columns:1fr; gap:10px; }
    .deal { padding:18px 20px; display:grid; grid-template-columns:minmax(0,1fr) minmax(290px,39%); column-gap:24px; row-gap:13px; min-width:0; }
    .deal-head { display:flex; gap:15px; min-width:0; }
    .thumb { width:74px; height:74px; object-fit:contain; background:#e5eae5; border-radius:5px; flex:none; }
    .no-thumb { display:grid; place-items:center; color:var(--muted); background:#1c241e; font-size:20px; }
    .deal-body { min-width:0; flex:1; }
    .meta { display:flex; flex-wrap:wrap; align-items:center; gap:6px; color:var(--muted); font-size:12px; }
    .tag { display:inline-block; border:1px solid #487353; color:#a4deb0; border-radius:4px; padding:2px 7px; font-size:11px; font-weight:750; }
    .tag.watch { color:var(--warn); border-color:#665136; } .tag.pass { color:var(--muted); border-color:var(--line); }
    .deal h3 { margin:8px 0 3px; font-size:17px; line-height:1.35; font-weight:690; }
    .deal h3 a:hover,.list-row a:hover { color:var(--accent); }
    .facts { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; align-content:center; }
    .facts strong { font-size:17px; font-weight:700; } .facts .profit { color:var(--accent); }
    .reason { color:var(--muted); font-size:13px; margin:0; }
    .actions { display:flex; align-items:center; justify-content:space-between; gap:12px; }
    .link { color:var(--accent); font-weight:700; font-size:14px; padding:6px 0; }
    .caution { color:var(--muted); font-size:12px; }
    .empty { border:1px dashed var(--line); border-radius:8px; padding:44px 24px; text-align:center; color:var(--muted); }
    .empty strong { display:block; color:var(--ink); font-size:17px; margin-bottom:5px; }
    .list { display:grid; gap:8px; }
    .list-row { display:flex; align-items:center; gap:14px; padding:14px 16px; }
    .list-row .item { min-width:0; flex:1; }
    .list-row .item strong { display:block; font-size:14px; }
    .list-row .item small { color:var(--muted); }
    .list-row .numbers { color:var(--muted); white-space:nowrap; font-size:13px; text-align:right; }
    .panel { padding:18px; margin-top:12px; }
    .panel h3 { margin:0 0 12px; font-size:17px; }
    .runs { display:grid; }
    .run { display:grid; grid-template-columns:160px 1fr 135px; gap:12px; border-top:1px solid var(--line); padding:10px 0; font-size:13px; color:var(--muted); }
    .run strong { color:var(--ink); font-weight:600; overflow-wrap:anywhere; }
    .error { color:var(--red); } .foot { color:var(--muted); font-size:13px; margin-top:30px; max-width:760px; }
    .btn.small { min-height:38px; padding:6px 12px; font-size:13px; }
    .btn.primary { background:var(--accent); color:#07120b; border-color:var(--accent); }
    .tag.auction { color:#9fc7ff; border-color:#3d5f86; } .tag.mine { color:#07120b; background:var(--accent); border-color:var(--accent); }
    .ends { color:#9fc7ff; font-weight:650; }
    .more { display:flex; justify-content:center; padding:8px 0 4px; }
    .flip-tools { display:flex; flex-wrap:wrap; gap:8px; margin:0 0 14px; }
    .ebay-box { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:10px 16px; padding:14px 16px; margin:0 0 14px; background:var(--surface); border:1px solid var(--line); border-radius:8px; }
    .ebay-box p { margin:4px 0 0; }
    .sub { font-size:15px; margin:18px 0 4px; }
    .flip-row { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:10px 16px; padding:14px 16px; background:var(--surface); border:1px solid var(--line); border-radius:8px; }
    .flip-row .item strong { display:block; font-size:15px; } .flip-row .item small { color:var(--muted); font-size:13px; }
    .flip-row .money { text-align:right; font-size:13px; color:var(--muted); white-space:nowrap; }
    .flip-row .money strong { display:block; font-size:16px; color:var(--ink); }
    .flip-row .buttons { grid-column:1/-1; display:flex; flex-wrap:wrap; gap:8px; }
    .gain { color:var(--accent) !important; } .loss { color:var(--red) !important; }
    dialog { background:var(--surface); color:var(--ink); border:1px solid var(--line); border-radius:10px; padding:0; width:min(440px,calc(100vw - 32px)); }
    dialog::backdrop { background:rgba(0,0,0,.6); }
    .dlg-body { padding:20px; display:grid; gap:12px; }
    .dlg-body h3 { margin:0; font-size:18px; }
    .dlg-body label { display:grid; gap:4px; font-size:13px; color:var(--muted); }
    .dlg-body label .input, .dlg-body label .select { width:100%; min-width:0; }
    .dlg-actions { display:flex; justify-content:flex-end; gap:8px; margin-top:4px; }
    .hint { font-size:12px; color:var(--muted); margin:0; }
    @media(max-width:560px) { .flip-row { grid-template-columns:1fr; } .flip-row .money { text-align:left; } }
    [hidden] { display:none !important; }
    @media(max-width:850px) { .metrics { grid-template-columns:repeat(2,1fr); } .deal { grid-template-columns:1fr; } }
    @media(max-width:560px) { .shell { padding:0 16px 55px; } header { min-height:64px; } .status { display:none; } .hero { padding:27px 0 23px; display:block; } .hero-note { margin-top:12px; } .metrics { gap:8px; margin-bottom:30px; } .metric { padding:13px; min-height:100px; } .metric strong { font-size:23px; } .controls { gap:9px; } .input,.select { width:100%; } .tab { flex:1; padding:10px 5px; font-size:13px; } .deal { padding:14px; } .thumb { width:64px; height:64px; } .facts { gap:6px; } .facts strong { font-size:15px; } .actions { flex-wrap:wrap; } .list-row { flex-wrap:wrap; } .list-row .item { flex-basis:calc(100% - 100px); } .list-row .numbers { margin-left:auto; } .run { grid-template-columns:1fr 1fr; } .run span:last-child { text-align:right; } }
    @media(prefers-reduced-motion:reduce) { html { scroll-behavior:auto; } }
    @media(forced-colors:active) { .tab.active,.pill.active,.tag { border:2px solid ButtonText; } }
  </style>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<div class="shell">
  <header><a class="brand" href="/dashboard" aria-label="BagSpec dashboard">BagSpec</a><div class="header-right"><span class="status"><span class="dot" aria-hidden="true"></span>Scanner runs every 5 minutes</span><button class="btn" id="refresh" type="button">Refresh data</button></div></header>
  <main id="main">
    <div class="hero"><div><div class="eyebrow">eBay repair scanner</div><h1>Dashboard</h1><p class="sub">Review new listings and scanner results. Check every listing yourself before buying.</p></div><p class="hero-note" id="updated">Loading data…</p></div>
    <section class="metrics" aria-label="Scanner summary"><div class="metric"><small>Deals shown</small><strong id="m-deals">—</strong><em>BUY and WATCH history</em></div><div class="metric"><small>Listings shown</small><strong id="m-listings">—</strong><em>Latest 100 listings</em></div><div class="metric"><small>New in latest scan</small><strong id="m-new">—</strong><em id="m-scan-time">Waiting for data</em></div><div class="metric"><small>Scanner status</small><strong id="m-cycle">—</strong><em id="m-cycle-time">Waiting for data</em></div></section>
    <div class="section-top"><h2>Results</h2><span class="caution" id="load-state" role="status" aria-live="polite"></span></div>
    <div class="controls"><div class="tabs" role="tablist" aria-label="Dashboard sections"><button id="tab-deals" class="tab active" data-tab="deals" type="button" role="tab" aria-controls="deals" aria-selected="true" tabindex="0">Deals</button><button id="tab-listings" class="tab" data-tab="listings" type="button" role="tab" aria-controls="listings" aria-selected="false" tabindex="-1">New listings</button><button id="tab-flips" class="tab" data-tab="flips" type="button" role="tab" aria-controls="flips" aria-selected="false" tabindex="-1">My flips</button><button id="tab-operations" class="tab" data-tab="operations" type="button" role="tab" aria-controls="operations" aria-selected="false" tabindex="-1">Operations</button></div><label class="visually-hidden" for="search">Search titles and categories</label><input id="search" class="input" type="search" placeholder="Search titles and categories" autocomplete="off"><label class="visually-hidden" for="sort">Sort results</label><select id="sort" class="select"><option value="newest">Newest first</option><option value="score">Highest score</option><option value="profit">Projected profit</option></select></div>
    <div id="chips" class="chips" role="group" aria-label="Filter by category"></div>
    <section id="deals" class="cards" role="tabpanel" aria-labelledby="tab-deals" tabindex="0"></section><section id="listings" class="list" role="tabpanel" aria-labelledby="tab-listings" tabindex="0" hidden></section><section id="flips" role="tabpanel" aria-labelledby="tab-flips" tabindex="0" hidden></section><section id="operations" role="tabpanel" aria-labelledby="tab-operations" tabindex="0" hidden><div class="panel"><h3>Recent cycles</h3><div id="runs" class="runs"></div></div><div class="panel"><h3>Queue by category</h3><div id="queue" class="runs"></div></div></section>
    <p class="foot">Only items up to $50 all-in are shown. A BUY needs matching comparables, a known no-solder repair, at least $25 profit and a 50% return, and Claude's final check. Resale estimates come from asking prices, so check eBay sold listings before buying. For auctions, "Bid up to" is the most to bid. The scanner runs every 5 minutes even when this page is closed.</p>
  </main>
</div>
<dialog id="dlg" aria-labelledby="dlg-title"><form id="dlg-form" class="dlg-body" method="dialog"><h3 id="dlg-title"></h3><div id="dlg-fields" class="dlg-body" style="padding:0"></div><p class="hint error" id="dlg-error" role="alert"></p><div class="dlg-actions"><button class="btn small" type="button" id="dlg-cancel">Cancel</button><button class="btn small primary" type="submit" id="dlg-submit">Save</button></div></form></dialog>
<script>
(() => {
  const $ = id => document.getElementById(id);
  const state = { tab: location.hash === '#flips' ? 'flips' : 'deals', category:'All', deals:[], nextBefore:null, loadingOlder:false, stale:null, listings:[], diagnostics:null, inventory:{ items:[], summary:{} }, inventoryLocked:false, ebay:null, ebayBusy:false };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) ? '$' + Number(value).toFixed(2) : '—';
  const date = value => { if (!value) return null; const d = new Date(String(value).includes('T') ? value : String(value).replace(' ', 'T') + 'Z'); return Number.isNaN(d.getTime()) ? null : d; };
  const when = value => { const d = date(value); return d ? new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(d) : 'Unknown'; };
  const ebayUrl = value => { try { const u = new URL(value); return u.protocol === 'https:' && /(^|\\.)ebay\\.com$/.test(u.hostname) ? u.href : ''; } catch { return ''; } };
  const imageUrl = value => { try { const u = new URL(value); return u.protocol === 'https:' && /(^|\\.)ebayimg\\.com$/.test(u.hostname) ? u.href : ''; } catch { return ''; } };
  const empty = (title,body) => '<div class="empty"><strong>' + esc(title) + '</strong>' + esc(body) + '</div>';
  const timeLeft = value => { const d = date(value); if (!d) return ''; const ms = d.getTime() - Date.now(); if (ms <= 0) return 'ended'; const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000); return 'ends in ' + (h ? h + 'h ' : '') + m + 'm'; };
  const kind = x => x.deal_type === 'auction' ? 'Auction' : x.deal_type === 'flip' ? 'Flip' : 'Repair';
  function filtered(rows) {
    const q = $('search').value.trim().toLowerCase();
    const result = rows.filter(x => (state.category === 'All' || x.category === state.category) && (String(x.title || '').toLowerCase().includes(q) || String(x.category || '').toLowerCase().includes(q)));
    const sort = $('sort').value;
    result.sort((a,b) => sort === 'score' ? Number(b.deal_score || 0)-Number(a.deal_score || 0) : sort === 'profit' ? Number(b.estimated_profit || 0)-Number(a.estimated_profit || 0) : (date(b.first_seen_at)?.getTime() || 0)-(date(a.first_seen_at)?.getTime() || 0));
    return result;
  }
  function renderChips() {
    const rows = state.tab === 'listings' ? state.listings : state.deals;
    const cats = ['All',...new Set(rows.map(x => x.category).filter(Boolean))];
    if (!cats.includes(state.category)) state.category='All';
    $('chips').hidden = state.tab === 'operations';
    $('chips').innerHTML = cats.map(c => '<button class="pill ' + (c === state.category ? 'active' : '') + '" type="button" aria-pressed="' + (c === state.category ? 'true' : 'false') + '" data-category="' + esc(c) + '">' + esc(c) + '</button>').join('');
  }
  function renderDeals() {
    const rows = filtered(state.deals);
    $('deals').innerHTML = rows.length ? rows.map(x => {
      const url = ebayUrl(x.item_url), img = imageUrl(x.image_url);
      const title = esc(x.title || 'Untitled listing');
      const heading = url ? '<a target="_blank" rel="noopener noreferrer" href="' + esc(url) + '">' + title + '</a>' : title;
      const pic = img ? '<img class="thumb" loading="lazy" alt="" src="' + esc(img) + '">' : '<span class="thumb no-thumb">⌁</span>';
      const label = x.recommendation === 'BUY' ? 'BUY lead' : 'WATCH';
      const auction = x.deal_type === 'auction';
      const typeTag = auction ? '<span class="tag auction">Auction</span> <span class="ends">' + esc(timeLeft(x.item_end_date)) + '</span>' : kind(x);
      const mine = x.inventory_id ? '<span class="tag mine">In My flips</span>' : '<button class="btn small" type="button" data-buy="' + esc(x.id) + '">I bought this</button>';
      return '<article class="deal"><div class="deal-head">' + pic + '<div class="deal-body"><div class="meta"><span class="tag ' + (x.recommendation === 'BUY' ? '' : 'watch') + '">' + label + '</span>' + typeTag + ' · ' + esc(x.category || 'Other') + ' · ' + esc(when(x.first_seen_at)) + '</div><h3>' + heading + '</h3><div class="meta">Score ' + esc(x.deal_score ?? '—') + '/100 · ' + esc(x.recommended_channel || 'Channel unconfirmed') + '</div></div></div><div class="facts"><div><small>' + (auction ? 'Cost at current bid' : 'Buy cost') + '</small><strong>' + money(x.total_buy_cost) + '</strong></div><div><small>' + (auction ? 'Bid up to' : 'Suggested offer') + '</small><strong>' + money(x.suggested_offer) + '</strong></div><div><small>Projected profit</small><strong class="profit">' + money(x.estimated_profit) + '</strong></div></div><p class="reason">' + (x.deal_type === 'flip' ? 'Working flip, no repair planned' : 'Possible repair: ' + esc(x.likely_issue || 'Unknown') + ' · Parts estimate ' + money(x.estimated_parts_cost)) + ' · Local asking-price estimate ' + money(x.estimated_resale_local) + '</p><div class="actions">' + (url ? '<a class="link" target="_blank" rel="noopener noreferrer" href="' + esc(url) + '">Inspect on eBay ↗</a>' : '<span class="caution">Listing link unavailable</span>') + mine + '</div></article>';
    }).join('') + olderButton() : empty('No matching deals','Try another category or check back after the next scan.') + olderButton();
  }
  function olderButton() {
    if (!state.nextBefore) return '';
    return '<div class="more"><button class="btn" type="button" data-older="1"' + (state.loadingOlder ? ' disabled' : '') + '>' + (state.loadingOlder ? 'Loading…' : 'Load older deals') + '</button></div>';
  }
  async function loadOlder() {
    if (!state.nextBefore || state.loadingOlder) return;
    state.loadingOlder = true; renderDeals();
    try {
      const page = await read('/deals?before=' + encodeURIComponent(state.nextBefore));
      const seen = new Set(state.deals.map(x => x.id));
      state.deals = state.deals.concat((page.deals || []).filter(x => !seen.has(x.id)));
      state.nextBefore = page.nextBefore || null;
      $('m-deals').textContent = String(state.deals.length);
    } catch (error) { alert('Could not load older deals: ' + error.message); }
    finally { state.loadingOlder = false; renderDeals(); }
  }
  function renderListings() {
    const rows = filtered(state.listings);
    $('listings').innerHTML = rows.length ? rows.map(x => {
      const url=ebayUrl(x.item_url), title=esc(x.title || 'Untitled listing');
      const label=esc(x.recommendation || x.analysis_status || 'REVIEW');
      return '<div class="list-row"><span class="tag ' + (x.recommendation === 'PASS' ? 'pass' : 'watch') + '">' + label + '</span><div class="item"><strong>' + (url ? '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + title + '</a>' : title) + '</strong><small>' + esc(kind(x)) + ' · ' + esc(x.category || 'Other') + ' · ' + esc(when(x.first_seen_at)) + '</small></div><div class="numbers">' + money(x.total_buy_cost) + '<br>Score ' + esc(x.deal_score ?? '—') + '</div></div>';
    }).join('') : empty('No matching listings','Try clearing the search or category filter.');
  }
  function renderOperations() {
    const d=state.diagnostics || {};
    $('runs').innerHTML = (d.recentCycles || []).slice(0,8).map(x => { let summary={}; try {summary=JSON.parse(x.summary || '{}');} catch {} return '<div class="run"><span>' + esc(when(x.started_at)) + '</span><strong>' + esc(x.status || 'Unknown') + (x.error ? ' · ' + esc(x.error) : '') + '</strong><span>' + esc(summary.newListings ?? '—') + ' new · ' + esc(summary.alerted ?? '—') + ' alerts</span></div>'; }).join('') || empty('No cycle history','Diagnostics are unavailable or scans have not run yet.');
    $('queue').innerHTML = (d.queue || []).filter(x => x.analysis_status === 'details_ready' || x.recommendation === 'BUY' || x.recommendation === 'WATCH').map(x => '<div class="run"><span>' + esc(x.category || 'Other') + '</span><strong>' + esc(x.analysis_status || '') + ' · ' + esc(x.recommendation || '') + '</strong><span>' + esc(x.count || 0) + ' listings</span></div>').join('') || empty('Queue is clear','No current ready items were reported.');
  }
  const STATUS_LABELS = { purchased:'Bought', repairing:'Repairing', listed:'Listed for sale', sold:'Sold', failed:'Could not fix' };
  function renderFlips() {
    if (state.inventoryLocked) {
      $('flips').innerHTML = '<div class="empty"><strong>Sign in to track your flips</strong>Your flips are private. <a class="link" href="/login">Sign in</a></div>';
      return;
    }
    const s = state.inventory.summary || {}, items = state.inventory.items || [];
    const signed = v => v === null || v === undefined ? '—' : (Number(v) < 0 ? '-$' + Math.abs(Number(v)).toFixed(2) : '$' + Number(v).toFixed(2));
    const metrics = '<section class="metrics" aria-label="Flip results"><div class="metric"><small>Profit so far</small><strong class="' + (Number(s.totalProfit) < 0 ? 'loss' : 'gain') + '">' + signed(s.totalProfit ?? 0) + '</strong><em>' + esc(s.sold || 0) + ' sold · ' + esc(s.failed || 0) + ' could not fix</em></div><div class="metric"><small>Average per flip</small><strong>' + signed(s.averageProfit) + '</strong><em>After fees, parts and shipping</em></div><div class="metric"><small>Money tied up</small><strong>' + signed(s.moneyTiedUp ?? 0) + '</strong><em>' + esc(s.open || 0) + ' item' + (s.open === 1 ? '' : 's') + ' not sold yet</em></div><div class="metric"><small>vs BagSpec estimate</small><strong>' + signed(s.averageVsEstimate) + '</strong><em>Average per sold flip (+ means better)</em></div></section>';
    const tools = '<div class="flip-tools"><button class="btn small primary" type="button" data-add="1">+ Add an item</button><span class="hint">Use this for things you bought anywhere, like Facebook Marketplace.</span></div>';
    const rows = items.map(x => {
      const url = ebayUrl(x.item_url);
      const name = esc(x.item_name || 'Item');
      const profit = x.profit;
      const right = x.status === 'sold' || x.status === 'failed'
        ? '<strong class="' + (Number(profit) < 0 ? 'loss' : 'gain') + '">' + signed(profit) + '</strong>' + (x.status === 'sold' ? 'sold ' + money(x.sale_price) + (x.sale_channel === 'Local' ? ' locally' : x.sale_channel ? ' on ' + esc(x.sale_channel) : '') : 'loss')
        : '<strong>' + money(x.cost) + '</strong>spent so far' + (x.estimated_profit !== null && x.estimated_profit !== undefined ? '<br>BagSpec guessed ' + money(x.estimated_profit) + ' profit' : '');
      return '<div class="flip-row"><div class="item"><strong>' + (url ? '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + name + '</a>' : name) + '</strong><small><span class="tag ' + (x.status === 'sold' ? '' : x.status === 'failed' ? 'pass' : 'watch') + '">' + esc(STATUS_LABELS[x.status] || x.status) + '</span> · paid ' + money(x.purchase_price) + ' + ' + money(x.inbound_shipping) + ' shipping + ' + money(x.sales_tax) + ' tax · parts ' + money(x.parts_cost) + ' · ' + esc(when(x.purchased_at)) + (x.notes ? ' · ' + esc(x.notes) : '') + '</small></div><div class="money">' + right + '</div><div class="buttons"><button class="btn small" type="button" data-edit="' + esc(x.id) + '">Update</button>' + (x.status === 'sold' ? '' : '<button class="btn small primary" type="button" data-sold="' + esc(x.id) + '">Mark sold</button>') + '<button class="btn small" type="button" data-delete="' + esc(x.id) + '">Delete</button></div></div>';
    }).join('');
    $('flips').innerHTML = metrics + ebayPanel() + tools + (rows ? '<div class="list">' + rows + '</div>' : empty('No flips yet','When you buy something, press "I bought this" on the deal, or "+ Add an item".'));
  }
  let dlgSubmit = null;
  function openForm(title, fields, submitLabel, onSubmit) {
    $('dlg-title').textContent = title;
    $('dlg-error').textContent = '';
    $('dlg-submit').textContent = submitLabel;
    $('dlg-fields').innerHTML = fields.map(f => {
      if (f.type === 'hidden') return '<input type="hidden" name="' + esc(f.name) + '" value="' + esc(f.value ?? '') + '">';
      const control = f.options
        ? '<select class="select" name="' + esc(f.name) + '">' + f.options.map(o => '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(f.value ?? '') ? ' selected' : '') + '>' + esc(o[1]) + '</option>').join('') + '</select>'
        : '<input class="input" name="' + esc(f.name) + '" ' + (f.type === 'money' ? 'type="number" step="0.01" min="0" inputmode="decimal"' : 'type="text"') + ' value="' + esc(f.value ?? '') + '"' + (f.placeholder ? ' placeholder="' + esc(f.placeholder) + '"' : '') + (f.required ? ' required' : '') + '>';
      return '<label>' + esc(f.label) + control + (f.hint ? '<span class="hint">' + esc(f.hint) + '</span>' : '') + '</label>';
    }).join('');
    dlgSubmit = onSubmit;
    $('dlg').showModal();
    const first = $('dlg-fields').querySelector('input:not([type=hidden]),select');
    if (first) first.focus();
  }
  async function send(path, body) {
    const r = await fetch(path, { method:'POST', headers:{ 'Content-Type':'application/json', 'X-BagSpec-Quiet':'1' }, body: JSON.stringify(body) });
    if (r.status === 401) throw new Error('Please sign in first (link on the My flips tab).');
    if (!r.ok) { let message = 'Could not save'; try { message = (await r.json()).error || message; } catch {} throw new Error(message); }
    return r.json();
  }
  async function loadInventory() {
    const r = await fetch('/api/inventory', { cache:'no-store', headers:{ 'X-BagSpec-Quiet':'1' } });
    if (r.status === 401) { state.inventoryLocked = true; return; }
    if (!r.ok) throw new Error('/api/inventory returned ' + r.status);
    state.inventoryLocked = false;
    state.inventory = await r.json();
    try {
      const e = await fetch('/api/ebay/status', { cache:'no-store', headers:{ 'X-BagSpec-Quiet':'1' } });
      state.ebay = e.ok ? await e.json() : null;
    } catch { state.ebay = null; }
  }
  function ebayPanel() {
    const e = state.ebay;
    if (!e) return '';
    const notice = { connected:'eBay is connected. Your purchases will show up here.', declined:'eBay sign-in was cancelled.', expired:'That eBay sign-in link expired. Please try again.', failed:'Connecting eBay did not work. Please try again.' }[new URLSearchParams(location.search).get('ebay')] || '';
    if (!e.connected) {
      return '<div class="ebay-box"><div><strong>Connect your eBay account</strong><p class="hint">BagSpec checks what you buy on eBay once an hour. Purchases it found as deals go into My flips automatically; anything else waits here for you to add or hide.</p>' + (notice ? '<p class="hint">' + esc(notice) + '</p>' : '') + '</div>' + (e.configured ? '<a class="btn small primary" href="/ebay/connect">Connect eBay</a>' : '<span class="hint">Needs the eBay RuName set up first.</span>') + '</div>';
    }
    const others = (e.otherPurchases || []).map(p => '<div class="flip-row"><div class="item"><strong><a href="https://www.ebay.com/itm/' + encodeURIComponent(p.item_id) + '" target="_blank" rel="noopener noreferrer">' + esc(p.title) + '</a></strong><small>' + money(p.price) + ' + ' + money(p.shipping) + ' shipping · ' + esc(when(p.purchased_at)) + '</small></div><div class="buttons"><button class="btn small primary" type="button" data-ebay-add="' + esc(p.order_line_id) + '">Add to My flips</button><button class="btn small" type="button" data-ebay-hide="' + esc(p.order_line_id) + '">Hide</button></div></div>').join('');
    return '<div class="ebay-box"><div><strong>eBay connected</strong><p class="hint">' + (e.lastSyncAt ? 'Last checked ' + esc(when(e.lastSyncAt)) : 'Not checked yet') + (e.lastSyncError ? ' · Problem: ' + esc(e.lastSyncError) : '') + (notice ? ' · ' + esc(notice) : '') + '</p></div><button class="btn small" type="button" data-ebay-sync="1"' + (state.ebayBusy ? ' disabled' : '') + '>' + (state.ebayBusy ? 'Checking…' : 'Check now') + '</button></div>' +
      (others ? '<h3 class="sub">Other eBay purchases</h3><p class="hint">These did not come from a BagSpec deal. Add the ones you plan to flip.</p><div class="list">' + others + '</div>' : '');
  }
  async function ebayAction(path) {
    state.ebayBusy = true; renderFlips();
    try { await send(path, {}); await loadInventory(); }
    catch (error) { alert(error.message); }
    finally { state.ebayBusy = false; renderFlips(); }
  }
  function startBuy(id) {
    const x = state.deals.find(d => String(d.id) === String(id));
    if (!x) return;
    const auction = x.deal_type === 'auction';
    openForm('I bought this', [
      { name:'listingId', type:'hidden', value:x.id },
      { name:'purchasePrice', label: auction ? 'Winning bid ($)' : 'Price paid ($)', type:'money', value: auction ? '' : x.price, required:true },
      { name:'inboundShipping', label:'Shipping paid ($)', type:'money', value:x.shipping_cost },
      { name:'salesTax', label:'Sales tax ($)', type:'money', value:'', placeholder:'Leave blank to estimate 6%' },
      { name:'partsCost', label:'Parts bought so far ($)', type:'money', value:'' },
      { name:'notes', label:'Notes', value:'', placeholder:'e.g. ordered a hinge from Amazon' },
    ], 'Save to My flips', async values => { await send('/api/inventory', values); });
  }
  function startAdd() {
    openForm('Add an item', [
      { name:'itemName', label:'What is it?', value:'', required:true, placeholder:'e.g. Nintendo 3DS XL, broken hinge' },
      { name:'purchasePrice', label:'Price paid ($)', type:'money', value:'', required:true },
      { name:'inboundShipping', label:'Shipping paid ($)', type:'money', value:'0' },
      { name:'salesTax', label:'Sales tax ($)', type:'money', value:'', placeholder:'Leave blank to estimate 6%', hint:'Put 0 for cash local buys with no tax.' },
      { name:'partsCost', label:'Parts bought so far ($)', type:'money', value:'' },
      { name:'notes', label:'Notes', value:'', placeholder:'e.g. Facebook Marketplace, Rexburg' },
    ], 'Add item', async values => { await send('/api/inventory', values); });
  }
  function startEdit(id) {
    const x = (state.inventory.items || []).find(i => String(i.id) === String(id));
    if (!x) return;
    openForm('Update ' + (x.item_name || 'item'), [
      { name:'status', label:'Status', value:x.status, options:[['purchased','Bought'],['repairing','Repairing'],['listed','Listed for sale'],['failed','Could not fix (count as a loss)']].concat(x.status === 'sold' ? [['sold','Sold']] : []) },
      { name:'partsCost', label:'Total spent on parts ($)', type:'money', value:x.parts_cost },
      { name:'packingCost', label:'Packing supplies ($)', type:'money', value:x.packing_cost },
      { name:'purchasePrice', label:'Price paid ($)', type:'money', value:x.purchase_price },
      { name:'inboundShipping', label:'Shipping paid ($)', type:'money', value:x.inbound_shipping },
      { name:'notes', label:'Notes', value:x.notes || '' },
    ], 'Save', async values => { await send('/api/inventory/' + x.id, values); });
  }
  function startSold(id) {
    const x = (state.inventory.items || []).find(i => String(i.id) === String(id));
    if (!x) return;
    openForm('Mark sold: ' + (x.item_name || 'item'), [
      { name:'status', type:'hidden', value:'sold' },
      { name:'salePrice', label:'Sold for ($)', type:'money', value:'', required:true, hint:'On eBay, use what the buyer paid including shipping.' },
      { name:'saleChannel', label:'Where', value:'eBay', options:[['eBay','eBay'],['Local','Local (Facebook, campus, etc.)'],['Other','Other']] },
      { name:'sellingFees', label:'Selling fees ($)', type:'money', value:'', placeholder:'Leave blank to estimate eBay fees' },
      { name:'outboundShipping', label:'Shipping you paid ($)', type:'money', value:'' },
      { name:'partsCost', label:'Total spent on parts ($)', type:'money', value:x.parts_cost },
    ], 'Mark sold', async values => { await send('/api/inventory/' + x.id, values); });
  }
  $('dlg-cancel').addEventListener('click', () => $('dlg').close());
  $('dlg-form').addEventListener('submit', async event => {
    event.preventDefault();
    const values = {};
    new FormData($('dlg-form')).forEach((v, k) => { if (String(v).trim() !== '') values[k] = String(v).trim(); });
    $('dlg-submit').disabled = true; $('dlg-error').textContent = '';
    try { await dlgSubmit(values); $('dlg').close(); await refresh(); }
    catch (error) { $('dlg-error').textContent = error.message; }
    finally { $('dlg-submit').disabled = false; }
  });
  document.addEventListener('click', async event => {
    const t = event.target.closest('[data-buy],[data-add],[data-edit],[data-sold],[data-delete],[data-older],[data-ebay-sync],[data-ebay-add],[data-ebay-hide]');
    if (!t) return;
    if (t.dataset.ebaySync) return ebayAction('/api/ebay/sync');
    if (t.dataset.ebayAdd) return ebayAction('/api/ebay/purchases/' + encodeURIComponent(t.dataset.ebayAdd) + '/add');
    if (t.dataset.ebayHide) return ebayAction('/api/ebay/purchases/' + encodeURIComponent(t.dataset.ebayHide) + '/hide');
    if (t.dataset.older) return loadOlder();
    if (t.dataset.buy) return startBuy(t.dataset.buy);
    if (t.dataset.add) return startAdd();
    if (t.dataset.edit) return startEdit(t.dataset.edit);
    if (t.dataset.sold) return startSold(t.dataset.sold);
    if (t.dataset.delete && confirm('Delete this item from My flips? This cannot be undone.')) {
      try { await send('/api/inventory/' + t.dataset.delete + '/delete', {}); await refresh(); } catch (error) { alert(error.message); }
    }
  });
  function render() {
    document.querySelectorAll('.tab').forEach(x => { const on=x.dataset.tab === state.tab; x.classList.toggle('active',on); x.setAttribute('aria-selected',String(on)); x.tabIndex=on ? 0 : -1; });
    ['deals','listings','flips','operations'].forEach(id => $(id).hidden = id !== state.tab);
    $('search').hidden = $('sort').hidden = state.tab === 'operations' || state.tab === 'flips';
    renderChips(); if (state.tab === 'flips') $('chips').hidden = true;
    renderDeals(); renderListings(); renderFlips(); renderOperations();
  }
  async function read(path) { const r=await fetch(path,{cache:'no-store'}); if (!r.ok) throw new Error(path + ' returned ' + r.status); return r.json(); }
  async function refresh() {
    $('refresh').disabled=true; $('load-state').textContent='Updating…';
    const results=await Promise.allSettled([read('/deals'),read('/listings'),read('/diagnostics'),loadInventory()]);
    if (results[0].status==='fulfilled') { state.deals=results[0].value.deals || []; state.nextBefore=results[0].value.nextBefore || null; }
    if (results[1].status==='fulfilled') state.listings=results[1].value.listings || [];
    const staleCopy=results.slice(0,2).find(x => x.status==='fulfilled' && x.value.stale);
    state.stale=staleCopy ? staleCopy.value.savedAt : null;
    if (results[2].status==='fulfilled') state.diagnostics=results[2].value;
    const scan=state.diagnostics?.recentScans?.[0], cycle=state.diagnostics?.recentCycles?.[0];
    $('m-deals').textContent=results[0].status==='fulfilled' ? String(state.deals.length) : '—';
    $('m-listings').textContent=results[1].status==='fulfilled' ? String(state.listings.length) : '—';
    $('m-new').textContent=scan ? String(scan.new_listings ?? '—') : '—'; $('m-scan-time').textContent=scan ? when(scan.completed_at || scan.started_at) : 'Scan data unavailable';
    const cycleTime=date(cycle?.completed_at || cycle?.started_at);
    const fresh=cycleTime && Date.now()-cycleTime.getTime() < 15*60*1000;
    $('m-cycle').textContent=cycle ? (cycle.status === 'completed' && fresh ? 'Running' : 'Check') : '—'; $('m-cycle-time').textContent=cycle ? 'Last cycle ' + when(cycle.completed_at || cycle.started_at) : 'Cycle data unavailable';
    const failures=results.filter(x => x.status==='rejected').length;
    $('load-state').textContent=state.stale ? 'Database unavailable · showing saved deals from ' + when(state.stale) : failures ? failures + ' data source' + (failures===1 ? '' : 's') + ' unavailable' : 'Live data loaded';
    $('updated').textContent='Updated ' + new Intl.DateTimeFormat(undefined,{hour:'numeric',minute:'2-digit'}).format(new Date());
    $('refresh').disabled=false; render();
  }
  const tabs=Array.from(document.querySelectorAll('.tab'));
  function activateTab(tab) { state.tab=tab.dataset.tab; state.category='All'; render(); }
  tabs.forEach((tab,index) => {
    tab.addEventListener('click',() => activateTab(tab));
    tab.addEventListener('keydown',event => {
      let target;
      if (event.key === 'ArrowRight') target=tabs[(index+1)%tabs.length];
      if (event.key === 'ArrowLeft') target=tabs[(index-1+tabs.length)%tabs.length];
      if (event.key === 'Home') target=tabs[0];
      if (event.key === 'End') target=tabs[tabs.length-1];
      if (target) { event.preventDefault(); activateTab(target); target.focus(); }
    });
  });
  $('chips').addEventListener('click',e => {const b=e.target.closest('[data-category]');if(b){state.category=b.dataset.category;render();}});
  $('search').addEventListener('input',render); $('sort').addEventListener('change',render); $('refresh').addEventListener('click',refresh);
  refresh();
})();
</script>
</body>
</html>`;
}
