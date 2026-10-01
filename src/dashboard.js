export function renderDashboard() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#101713">
  <title>BagSpec — Deal desk</title>
  <style>
    :root { color-scheme: dark; --bg:#101713; --surface:#19231d; --surface2:#202e26; --line:#344439; --ink:#ecf5e9; --muted:#9eb2a0; --accent:#bbef72; --warn:#f9c87a; --red:#f5a7a1; }
    * { box-sizing:border-box; } body { margin:0; font:15px/1.5 Inter,ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif; background:radial-gradient(circle at 85% -20%,#30452e 0,transparent 37%),var(--bg); color:var(--ink); }
    button,input,select { font:inherit; } button { cursor:pointer; } a { color:inherit; }
    .shell { max-width:1220px; margin:auto; padding:0 28px 80px; }
    header { display:flex; align-items:center; justify-content:space-between; gap:16px; border-bottom:1px solid var(--line); padding:22px 0; }
    .brand { font-size:23px; font-weight:850; letter-spacing:-.055em; text-decoration:none; display:flex; align-items:center; gap:10px; }
    .brand-mark { display:inline-grid; place-items:center; width:32px; height:32px; border-radius:9px; background:var(--accent); color:#182219; font-size:20px; font-weight:900; }
    .header-right,.status { display:flex; align-items:center; gap:12px; color:var(--muted); font-size:13px; }
    .dot { display:inline-block; width:8px; height:8px; border-radius:50%; background:var(--accent); box-shadow:0 0 0 4px #bbef7220; margin-right:7px; }
    .btn { border:1px solid var(--line); background:var(--surface2); color:var(--ink); border-radius:10px; padding:9px 14px; font-weight:650; }
    .btn:hover,.pill:hover { border-color:var(--accent); } .btn:disabled { opacity:.5; cursor:wait; }
    .hero { display:flex; align-items:end; justify-content:space-between; gap:24px; padding:42px 0 30px; }
    .eyebrow { color:var(--accent); text-transform:uppercase; letter-spacing:.16em; font-size:11px; font-weight:800; }
    h1 { font-size:clamp(34px,5vw,56px); line-height:1.04; letter-spacing:-.065em; margin:9px 0; } h2 { font-size:22px; letter-spacing:-.035em; margin:0; }
    .sub { color:var(--muted); max-width:600px; margin:0; } .hero-note { font-size:12px; color:var(--muted); text-align:right; max-width:260px; }
    .metrics { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin-bottom:32px; }
    .metric,.panel,.deal,.list-row { background:var(--surface); border:1px solid var(--line); border-radius:15px; }
    .metric { padding:20px; min-height:118px; } .metric small { color:var(--muted); display:block; } .metric strong { font-size:30px; letter-spacing:-.06em; display:block; margin-top:7px; line-height:1; } .metric em { display:block; color:var(--muted); font-size:12px; font-style:normal; margin-top:8px; }
    .section-top { display:flex; align-items:center; justify-content:space-between; gap:16px; margin:0 0 16px; }
    .controls { display:flex; flex-wrap:wrap; align-items:center; gap:10px; margin-bottom:14px; }
    .tabs { display:flex; gap:5px; background:var(--surface); border:1px solid var(--line); border-radius:11px; padding:4px; }
    .tab { background:transparent; border:0; color:var(--muted); border-radius:8px; padding:7px 12px; font-weight:650; }
    .tab.active { background:#38503b; color:var(--ink); }
    .input,.select { background:var(--surface); color:var(--ink); border:1px solid var(--line); border-radius:10px; padding:10px 12px; min-height:40px; }
    .input { flex:1; min-width:190px; } .select { max-width:185px; }
    .chips { display:flex; flex-wrap:wrap; gap:7px; margin-bottom:17px; }
    .pill { border:1px solid var(--line); background:transparent; color:var(--muted); border-radius:99px; padding:6px 11px; font-size:12px; }
    .pill.active { color:#142013; background:var(--accent); border-color:var(--accent); font-weight:750; }
    .cards { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:14px; }
    .deal { padding:18px; display:flex; flex-direction:column; gap:15px; min-width:0; }
    .deal-head { display:flex; gap:14px; min-width:0; }
    .thumb { width:90px; height:90px; object-fit:contain; background:#ecf0e9; border-radius:10px; flex:none; }
    .no-thumb { display:grid; place-items:center; color:#95a996; background:var(--surface2); font-size:25px; }
    .deal-body { min-width:0; flex:1; } .meta { display:flex; flex-wrap:wrap; align-items:center; gap:7px; color:var(--muted); font-size:12px; }
    .tag { display:inline-block; background:#334533; color:var(--accent); border-radius:5px; padding:2px 7px; font-size:11px; font-weight:800; letter-spacing:.05em; }
    .tag.watch { background:#51412b; color:var(--warn); } .tag.pass { color:var(--muted); background:#2a332c; }
    .deal h3 { margin:9px 0 2px; font-size:17px; line-height:1.32; letter-spacing:-.025em; } .deal h3 a { text-decoration:none; } .deal h3 a:hover { color:var(--accent); }
    .facts { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; border-top:1px solid var(--line); padding-top:14px; }
    .facts small { display:block; color:var(--muted); font-size:11px; } .facts strong { font-size:16px; font-weight:750; } .facts .profit { color:var(--accent); }
    .reason { color:var(--muted); font-size:13px; margin:0; } .actions { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-top:auto; }
    .link { color:var(--accent); text-decoration:none; font-weight:750; font-size:13px; } .link:hover { text-decoration:underline; }
    .caution { color:var(--muted); font-size:11px; } .empty { border:1px dashed var(--line); border-radius:14px; padding:48px 24px; text-align:center; color:var(--muted); grid-column:1/-1; }
    .empty strong { display:block; color:var(--ink); font-size:18px; margin-bottom:5px; }
    .list { display:grid; gap:9px; } .list-row { display:flex; align-items:center; gap:13px; padding:12px 16px; }
    .list-row .item { min-width:0; flex:1; } .list-row .item strong { display:block; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; } .list-row .item small { color:var(--muted); }
    .list-row .numbers { color:var(--muted); white-space:nowrap; font-size:13px; text-align:right; }
    .panel { padding:18px; margin-top:14px; } .panel h3 { margin:0 0 14px; } .runs { display:grid; gap:8px; }
    .run { display:grid; grid-template-columns:145px 1fr 90px; gap:10px; border-top:1px solid var(--line); padding:9px 0; font-size:13px; color:var(--muted); }
    .run strong { color:var(--ink); font-weight:600; } .error { color:var(--red); } .foot { color:var(--muted); font-size:12px; margin-top:24px; }
    [hidden] { display:none !important; }
    @media(max-width:850px) { .metrics { grid-template-columns:repeat(2,1fr); } .cards { grid-template-columns:1fr; } .hero-note { display:none; } }
    @media(max-width:540px) { .shell { padding:0 15px 55px; } header { padding:16px 0; } .status { display:none; } .hero { padding:30px 0 22px; } .metrics { gap:8px; margin-bottom:26px; } .metric { min-height:104px; padding:14px; } .metric strong { font-size:25px; } .controls { align-items:stretch; } .tabs,.input,.select { width:100%; max-width:none; } .tab { flex:1; } .deal { padding:14px; } .facts strong { font-size:14px; } .run { grid-template-columns:1fr 1fr; } .run span:last-child { text-align:right; } }
  </style>
</head>
<body>
<div class="shell">
  <header><a class="brand" href="/dashboard"><span class="brand-mark">b</span> bagspec<span style="color:var(--accent)">.</span></a><div class="header-right"><span class="status"><span class="dot"></span>Scanner dashboard</span><button class="btn" id="refresh" type="button">↻ Refresh</button></div></header>
  <main>
    <div class="hero"><div><div class="eyebrow">Your repair deal desk</div><h1>Find the worth fixing.</h1><p class="sub">A live view of BagSpec’s eBay scanner. Every estimate is a lead for your own inspection, not a guaranteed profit.</p></div><p class="hero-note" id="updated">Loading live results…</p></div>
    <section class="metrics" aria-label="Scanner summary"><div class="metric"><small>Deals to review</small><strong id="m-deals">—</strong><em>BUY + WATCH labels</em></div><div class="metric"><small>Recent listings</small><strong id="m-listings">—</strong><em>Latest 100 shown</em></div><div class="metric"><small>Newest scan</small><strong id="m-new">—</strong><em id="m-scan-time">Waiting for data</em></div><div class="metric"><small>Last cycle</small><strong id="m-cycle">—</strong><em id="m-cycle-time">Waiting for data</em></div></section>
    <div class="section-top"><h2>Scanner activity</h2><span class="caution" id="load-state" role="status"></span></div>
    <div class="controls"><div class="tabs" role="tablist"><button class="tab active" data-tab="deals" role="tab" aria-selected="true">Deals</button><button class="tab" data-tab="listings" role="tab" aria-selected="false">New listings</button><button class="tab" data-tab="operations" role="tab" aria-selected="false">Operations</button></div><input id="search" class="input" type="search" placeholder="Search title or category" aria-label="Search listings"><select id="sort" class="select" aria-label="Sort results"><option value="newest">Newest first</option><option value="score">Highest score</option><option value="profit">Projected profit</option></select></div>
    <div id="chips" class="chips" aria-label="Filter by category"></div>
    <section id="deals" class="cards" aria-label="Deals"></section><section id="listings" class="list" aria-label="Recent listings" hidden></section><section id="operations" hidden><div class="panel"><h3>Recent cycles</h3><div id="runs" class="runs"></div></div><div class="panel"><h3>Queue by category</h3><div id="queue" class="runs"></div></div></section>
    <p class="foot">Resale figures come from active asking prices. Check sold prices, condition, shipping, fees, and parts before buying. The scanner runs on its Cloudflare schedule even when this page is closed.</p>
  </main>
</div>
<script>
(() => {
  const $ = id => document.getElementById(id);
  const state = { tab:'deals', category:'All', deals:[], listings:[], diagnostics:null };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = value => Number.isFinite(Number(value)) ? '$' + Number(value).toFixed(2) : '—';
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
    $('chips').innerHTML = cats.map(c => '<button class="pill ' + (c === state.category ? 'active' : '') + '" type="button" data-category="' + esc(c) + '">' + esc(c) + '</button>').join('');
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
    document.querySelectorAll('.tab').forEach(x => { const on=x.dataset.tab === state.tab; x.classList.toggle('active',on); x.setAttribute('aria-selected',String(on)); });
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
    $('m-deals').textContent=String(state.deals.length); $('m-listings').textContent=String(state.listings.length);
    $('m-new').textContent=scan ? String(scan.new_listings ?? '—') : '—'; $('m-scan-time').textContent=scan ? when(scan.completed_at || scan.started_at) : 'Scan data unavailable';
    $('m-cycle').textContent=cycle ? (cycle.status === 'completed' ? 'Healthy' : 'Check') : '—'; $('m-cycle-time').textContent=cycle ? when(cycle.completed_at || cycle.started_at) : 'Cycle data unavailable';
    const failures=results.filter(x => x.status==='rejected').length;
    $('load-state').textContent=failures ? failures + ' data source' + (failures===1 ? '' : 's') + ' unavailable' : 'Live data loaded';
    $('updated').textContent='Updated ' + new Intl.DateTimeFormat(undefined,{hour:'numeric',minute:'2-digit'}).format(new Date());
    $('refresh').disabled=false; render();
  }
  document.querySelectorAll('.tab').forEach(x => x.addEventListener('click',() => {state.tab=x.dataset.tab;state.category='All';render();}));
  $('chips').addEventListener('click',e => {const b=e.target.closest('[data-category]');if(b){state.category=b.dataset.category;render();}});
  $('search').addEventListener('input',render); $('sort').addEventListener('change',render); $('refresh').addEventListener('click',refresh);
  refresh();
})();
</script>
</body>
</html>`;
}
