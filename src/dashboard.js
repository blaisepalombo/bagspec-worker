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
    <section class="metrics" aria-label="Scanner summary"><div class="metric"><small>Deals shown</small><strong id="m-deals">—</strong><em>Up to 100 BUY and WATCH leads</em></div><div class="metric"><small>Listings shown</small><strong id="m-listings">—</strong><em>Latest 100 listings</em></div><div class="metric"><small>New in latest scan</small><strong id="m-new">—</strong><em id="m-scan-time">Waiting for data</em></div><div class="metric"><small>Scanner status</small><strong id="m-cycle">—</strong><em id="m-cycle-time">Waiting for data</em></div></section>
    <div class="section-top"><h2>Results</h2><span class="caution" id="load-state" role="status" aria-live="polite"></span></div>
    <div class="controls"><div class="tabs" role="tablist" aria-label="Dashboard sections"><button id="tab-deals" class="tab active" data-tab="deals" type="button" role="tab" aria-controls="deals" aria-selected="true" tabindex="0">Deals</button><button id="tab-listings" class="tab" data-tab="listings" type="button" role="tab" aria-controls="listings" aria-selected="false" tabindex="-1">New listings</button><button id="tab-operations" class="tab" data-tab="operations" type="button" role="tab" aria-controls="operations" aria-selected="false" tabindex="-1">Operations</button></div><label class="visually-hidden" for="search">Search titles and categories</label><input id="search" class="input" type="search" placeholder="Search titles and categories" autocomplete="off"><label class="visually-hidden" for="sort">Sort results</label><select id="sort" class="select"><option value="newest">Newest first</option><option value="score">Highest score</option><option value="profit">Projected profit</option></select></div>
    <div id="chips" class="chips" role="group" aria-label="Filter by category"></div>
    <section id="deals" class="cards" role="tabpanel" aria-labelledby="tab-deals" tabindex="0"></section><section id="listings" class="list" role="tabpanel" aria-labelledby="tab-listings" tabindex="0" hidden></section><section id="operations" role="tabpanel" aria-labelledby="tab-operations" tabindex="0" hidden><div class="panel"><h3>Recent cycles</h3><div id="runs" class="runs"></div></div><div class="panel"><h3>Queue by category</h3><div id="queue" class="runs"></div></div></section>
    <p class="foot">Resale figures come from active asking prices. Check sold prices, condition, shipping, fees, and parts before buying. The scanner runs on its Cloudflare schedule even when this page is closed.</p>
  </main>
</div>
<script>
(() => {
  const $ = id => document.getElementById(id);
  const state = { tab:'deals', category:'All', deals:[], listings:[], diagnostics:null };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) ? '$' + Number(value).toFixed(2) : '—';
  const date = value => { if (!value) return null; const d = new Date(String(value).includes('T') ? value : String(value).replace(' ', 'T') + 'Z'); return Number.isNaN(d.getTime()) ? null : d; };
  const when = value => { const d = date(value); return d ? new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(d) : 'Unknown'; };
  const ebayUrl = value => { try { const u = new URL(value); return u.protocol === 'https:' && /(^|\\.)ebay\\.com$/.test(u.hostname) ? u.href : ''; } catch { return ''; } };
  const imageUrl = value => { try { const u = new URL(value); return u.protocol === 'https:' && /(^|\\.)ebayimg\\.com$/.test(u.hostname) ? u.href : ''; } catch { return ''; } };
  const empty = (title,body) => '<div class="empty"><strong>' + esc(title) + '</strong>' + esc(body) + '</div>';
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
      return '<article class="deal"><div class="deal-head">' + pic + '<div class="deal-body"><div class="meta"><span class="tag ' + (x.recommendation === 'BUY' ? '' : 'watch') + '">' + label + '</span>' + esc(x.category || 'Other') + ' · ' + esc(when(x.first_seen_at)) + '</div><h3>' + heading + '</h3><div class="meta">Score ' + esc(x.deal_score ?? '—') + '/100 · ' + esc(x.recommended_channel || 'Channel unconfirmed') + '</div></div></div><div class="facts"><div><small>Buy cost</small><strong>' + money(x.total_buy_cost) + '</strong></div><div><small>Suggested offer</small><strong>' + money(x.suggested_offer) + '</strong></div><div><small>Projected profit</small><strong class="profit">' + money(x.estimated_profit) + '</strong></div></div><p class="reason">Possible repair: ' + esc(x.likely_issue || 'Unknown') + ' · Parts estimate ' + money(x.estimated_parts_cost) + ' · Local asking-price estimate ' + money(x.estimated_resale_local) + '</p><div class="actions">' + (url ? '<a class="link" target="_blank" rel="noopener noreferrer" href="' + esc(url) + '">Inspect on eBay ↗</a>' : '<span class="caution">Listing link unavailable</span>') + '<span class="caution">Verify before buying</span></div></article>';
    }).join('') : empty('No matching deals','Try another category or check back after the next scan.');
  }
  function renderListings() {
    const rows = filtered(state.listings);
    $('listings').innerHTML = rows.length ? rows.map(x => {
      const url=ebayUrl(x.item_url), title=esc(x.title || 'Untitled listing');
      const label=esc(x.recommendation || x.analysis_status || 'REVIEW');
      return '<div class="list-row"><span class="tag ' + (x.recommendation === 'PASS' ? 'pass' : 'watch') + '">' + label + '</span><div class="item"><strong>' + (url ? '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + title + '</a>' : title) + '</strong><small>' + esc(x.category || 'Other') + ' · ' + esc(when(x.first_seen_at)) + '</small></div><div class="numbers">' + money(x.total_buy_cost) + '<br>Score ' + esc(x.deal_score ?? '—') + '</div></div>';
    }).join('') : empty('No matching listings','Try clearing the search or category filter.');
  }
  function renderOperations() {
    const d=state.diagnostics || {};
    $('runs').innerHTML = (d.recentCycles || []).slice(0,8).map(x => { let summary={}; try {summary=JSON.parse(x.summary || '{}');} catch {} return '<div class="run"><span>' + esc(when(x.started_at)) + '</span><strong>' + esc(x.status || 'Unknown') + (x.error ? ' · ' + esc(x.error) : '') + '</strong><span>' + esc(summary.newListings ?? '—') + ' new · ' + esc(summary.alerted ?? '—') + ' alerts</span></div>'; }).join('') || empty('No cycle history','Diagnostics are unavailable or scans have not run yet.');
    $('queue').innerHTML = (d.queue || []).filter(x => x.analysis_status === 'details_ready' || x.recommendation === 'BUY' || x.recommendation === 'WATCH').map(x => '<div class="run"><span>' + esc(x.category || 'Other') + '</span><strong>' + esc(x.analysis_status || '') + ' · ' + esc(x.recommendation || '') + '</strong><span>' + esc(x.count || 0) + ' listings</span></div>').join('') || empty('Queue is clear','No current ready items were reported.');
  }
  function render() {
    document.querySelectorAll('.tab').forEach(x => { const on=x.dataset.tab === state.tab; x.classList.toggle('active',on); x.setAttribute('aria-selected',String(on)); x.tabIndex=on ? 0 : -1; });
    ['deals','listings','operations'].forEach(id => $(id).hidden = id !== state.tab);
    $('search').hidden = $('sort').hidden = state.tab === 'operations';
    renderChips(); renderDeals(); renderListings(); renderOperations();
  }
  async function read(path) { const r=await fetch(path,{cache:'no-store'}); if (!r.ok) throw new Error(path + ' returned ' + r.status); return r.json(); }
  async function refresh() {
    $('refresh').disabled=true; $('load-state').textContent='Updating…';
    const results=await Promise.allSettled([read('/deals'),read('/listings'),read('/diagnostics')]);
    if (results[0].status==='fulfilled') state.deals=results[0].value.deals || [];
    if (results[1].status==='fulfilled') state.listings=results[1].value.listings || [];
    if (results[2].status==='fulfilled') state.diagnostics=results[2].value;
    const scan=state.diagnostics?.recentScans?.[0], cycle=state.diagnostics?.recentCycles?.[0];
    $('m-deals').textContent=results[0].status==='fulfilled' ? String(state.deals.length) : '—';
    $('m-listings').textContent=results[1].status==='fulfilled' ? String(state.listings.length) : '—';
    $('m-new').textContent=scan ? String(scan.new_listings ?? '—') : '—'; $('m-scan-time').textContent=scan ? when(scan.completed_at || scan.started_at) : 'Scan data unavailable';
    const cycleTime=date(cycle?.completed_at || cycle?.started_at);
    const fresh=cycleTime && Date.now()-cycleTime.getTime() < 15*60*1000;
    $('m-cycle').textContent=cycle ? (cycle.status === 'completed' && fresh ? 'Running' : 'Check') : '—'; $('m-cycle-time').textContent=cycle ? 'Last cycle ' + when(cycle.completed_at || cycle.started_at) : 'Cycle data unavailable';
    const failures=results.filter(x => x.status==='rejected').length;
    $('load-state').textContent=failures ? failures + ' data source' + (failures===1 ? '' : 's') + ' unavailable' : 'Live data loaded';
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
