// ============================================================
//  ReelOra – app.js  (clean build)
// ============================================================

const TMDB_BASE     = 'https://api.themoviedb.org/3';
const IMG_BASE      = 'https://image.tmdb.org/t/p/w342';
const BACKDROP_BASE = 'https://image.tmdb.org/t/p/w780';

let library    = JSON.parse(localStorage.getItem('reelora_library')    || '[]');
let watchlists = JSON.parse(localStorage.getItem('reelora_watchlists') || JSON.stringify([
  { id:1, name:'Watchlist', items:[], created:Date.now() },
  { id:2, name:'Favoriten', items:[], created:Date.now() }
]));
let settings = JSON.parse(localStorage.getItem('reelora_settings') || JSON.stringify({
  tmdb_key:'', lang:'de-DE', drive_connected:false, drive_account:'', vercel_url:''
}));

let currentMovie = null, libView = 'grid', libFilter = 'all';
let importQueue = [], trendingCache = [], searchCache = [], toastTimer = null;
let deleteMode = false, selectedForDelete = new Set();
let kodiMoviesCache = [], kodiMoviesFiltered = [];

// ─── INIT ────────────────────────────────────────────────────
window.addEventListener('load', () => {
  if (settings.tmdb_key) {
    const el = document.getElementById('tmdb-key-input');
    if (el) el.value = settings.tmdb_key;
    const st = document.getElementById('api-status-row');
    if (st) st.style.display = 'flex';
  }
  if (settings.vercel_url) {
    const el = document.getElementById('vercel-url-input');
    if (el) el.value = settings.vercel_url;
  }
  const lang = document.getElementById('lang-select');
  if (lang) lang.value = settings.lang || 'de-DE';
  syncKodiFields();
  updateDriveUI();
  const params = new URLSearchParams(window.location.search);
  if (params.get('drive_connected') === '1') {
    const email = params.get('drive_email') || '';
    const tokenData = params.get('drive_token') || '';
    if (tokenData) {
      try { localStorage.setItem('reelora_drive_token', JSON.stringify(JSON.parse(atob(decodeURIComponent(tokenData))))); }
      catch (e) { console.error(e); }
    }
    settings.drive_connected = true; settings.drive_account = email; save();
    history.replaceState({}, '', window.location.pathname);
    toast('✓ Google Drive verbunden: ' + email); updateDriveUI(); loadFromDrive();
  }
  if (params.get('drive_error')) { toast('Drive Fehler: ' + params.get('drive_error'), 'err'); history.replaceState({}, '', window.location.pathname); }
  if (settings.vercel_url && settings.drive_connected) checkDriveStatus();
  // Start auf Filme → Entdecken
  showFilmeTab('entdecken', document.getElementById('ftab-entdecken'));
  renderLibrary(); renderWatchlists();

  // ─── Autocomplete Event Listeners ────────────────────────
  // Film-Suche
  const filmInput = document.getElementById('search-input');
  if (filmInput) {
    filmInput.addEventListener('input', e => autocomplete(e.target.value, 'movie'));
    filmInput.addEventListener('keydown', e => handleAutoKey(e, 'movie'));
  }
  // Serien-Suche
  const seriesInput = document.getElementById('series-search-input');
  if (seriesInput) {
    seriesInput.addEventListener('input', e => autocomplete(e.target.value, 'tv'));
    seriesInput.addEventListener('keydown', e => handleAutoKey(e, 'tv'));
  }
});

function save() {
  localStorage.setItem('reelora_library',    JSON.stringify(library));
  localStorage.setItem('reelora_watchlists', JSON.stringify(watchlists));
  localStorage.setItem('reelora_settings',   JSON.stringify(settings));
  if (settings.drive_connected && settings.vercel_url && document.getElementById('auto-sync-toggle')?.classList.contains('on')) driveSync();
}

function showPage(name, btn) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  // Serien, Import, Einstellungen haben eigene Seiten
  const ownPage = document.getElementById('page-' + name);
  if (ownPage) {
    ownPage.classList.add('active');
  } else {
    // Fallback: bibliothek
    document.getElementById('page-bibliothek').classList.add('active');
  }
  if (btn) btn.classList.add('active');
  if (name === 'serien' && typeof initSerienPage === 'function') initSerienPage();
}

// Filme-Seite mit Sub-Tab anzeigen
function showFilmePage(tab, btn) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  document.getElementById('page-bibliothek').classList.add('active');
  if (btn) btn.classList.add('active');
  showFilmeTab(tab, document.getElementById('ftab-' + tab));
}

function showFilmeTab(tab, btn) {
  ['entdecken','archiv','watchlist','statistiken'].forEach(t => {
    const el = document.getElementById('filme-tab-' + t);
    if (el) el.style.display = 'none';
  });
  document.querySelectorAll('#page-bibliothek .tab-sec').forEach(b => b.classList.remove('active'));
  const active = document.getElementById('filme-tab-' + tab);
  if (active) active.style.display = 'block';
  if (btn) btn.classList.add('active');
  if (tab === 'archiv')      renderLibrary();
  if (tab === 'watchlist')   renderWatchlists();
  if (tab === 'statistiken') renderFilmeStats();
  if (tab === 'entdecken')   { renderTrending(); renderRecentArchive(); }
}

function renderFilmeStats() {
  // Statistik-Karten im Filme-Tab
  const total     = library.length;
  const rated     = library.filter(f=>f.rating>0).length;
  const avgRating = rated ? (library.reduce((s,f)=>s+(f.rating||0),0)/rated).toFixed(1) : '—';
  const totalHours = Math.floor(library.reduce((s,f)=>s+(f.runtime||0),0)/60);
  const el = document.getElementById('filme-stats-cards');
  if (el) el.innerHTML = [
    {val:total,label:'Archivierte Filme',sub:''},
    {val:avgRating,label:'Ø Bewertung',sub:'von 5 Sternen'},
    {val:totalHours+'h',label:'Geschaute Zeit',sub:Math.floor(totalHours/24)+' Tage'},
    {val:watchlists.reduce((s,w)=>s+w.items.length,0),label:'Watchlist-Einträge',sub:''},
  ].map(s=>`<div class="stat-card"><div class="stat-val">${s.val}</div><div class="stat-label">${s.label}</div>${s.sub?`<div class="stat-sub">${s.sub}</div>`:''}</div>`).join('');

  // Charts (shared elements)
  const now = new Date(), months = ['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'];
  const mc = Array(6).fill(0);
  library.forEach(f=>{const d=new Date(f.added),diff=(now.getFullYear()-d.getFullYear())*12+(now.getMonth()-d.getMonth());if(diff>=0&&diff<6)mc[5-diff]++;});
  const maxM = Math.max(...mc,1);
  const mc_el = document.getElementById('monthly-chart');
  if (mc_el) mc_el.innerHTML = mc.map((c,i)=>{const mo=new Date(now.getFullYear(),now.getMonth()-(5-i),1);return `<div class="bar-col"><div class="bar-wrap"><div class="bar" style="height:${Math.round(c/maxM*100)}%"></div></div><div class="bar-label">${months[mo.getMonth()]}</div></div>`;}).join('');

  const genreCounts={};
  library.forEach(f=>(f.genres||[]).forEach(g=>{genreCounts[g]=(genreCounts[g]||0)+1;}));
  const topGenres=Object.entries(genreCounts).sort((a,b)=>b[1]-a[1]).slice(0,6);
  const maxG=topGenres.length?topGenres[0][1]:1;
  const gc_el = document.getElementById('genre-chart');
  if (gc_el) gc_el.innerHTML = topGenres.length ? topGenres.map(([g,c])=>`<div class="genre-row"><div class="genre-name">${g}</div><div class="genre-bar-wrap"><div class="genre-bar" style="width:${Math.round(c/maxG*100)}%"></div></div><div class="genre-pct">${Math.round(c/Math.max(total,1)*100)}%</div></div>`).join('') : '<div style="color:var(--text3);font-size:13px;padding:10px 0">Noch keine Daten</div>';

  const decades={};
  library.forEach(f=>{if(f.year){const d=Math.floor(parseInt(f.year)/10)*10;if(!decades[d])decades[d]=0;decades[d]++;}});
  const decArr=Object.entries(decades).sort((a,b)=>a[0]-b[0]),maxD=Math.max(...decArr.map(([,v])=>v),1);
  const dc_el = document.getElementById('decade-chart');
  if (dc_el) dc_el.innerHTML = decArr.length ? decArr.map(([d,v])=>`<div class="bar-col"><div class="bar-wrap"><div class="bar" style="height:${Math.round(v/maxD*100)}%"></div></div><div class="bar-label">${d}er</div></div>`).join('') : '<div style="color:var(--text3);font-size:13px">Noch keine Daten</div>';

  const topRated=[...library].filter(f=>f.rating>0).sort((a,b)=>b.rating-a.rating).slice(0,5);
  const tr_el = document.getElementById('top-rated-list');
  if (tr_el) tr_el.innerHTML = topRated.map((f,i)=>{
    const b64=encodeMovie({id:f.tmdb_id,title:f.title,year:f.year,poster_path:f.poster_path,vote_average:(f.rating||0)*2,overview:f.overview,genres:[]});
    return `<div class="lib-item" onclick="openMovieDetail('${b64}')"><div style="font-family:'Cinzel',serif;font-size:14px;color:var(--text3);width:24px;text-align:center;flex-shrink:0">${i+1}</div><div class="lib-poster">${f.poster_path?`<img src="${IMG_BASE}${f.poster_path}" loading="lazy">`:'🎬'}</div><div class="lib-info"><div class="lib-title">${esc(f.title)}</div><div class="lib-meta">${f.year||''}</div></div><div class="lib-rating">★ ${f.rating}</div></div>`;
  }).join('') || '<div style="color:var(--text3);font-size:13px;padding:20px 0;text-align:center">Noch keine bewerteten Filme</div>';
}

// ─── TMDB ────────────────────────────────────────────────────
async function tmdbFetch(endpoint, params = '') {
  if (!settings.tmdb_key) { toast('⚠ TMDB API Key fehlt', 'warn'); return null; }
  try {
    const res = await fetch(`${TMDB_BASE}${endpoint}?api_key=${settings.tmdb_key}&language=${settings.lang||'de-DE'}${params}`);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } catch (e) { toast('TMDB: ' + e.message, 'err'); return null; }
}

async function renderTrending() {
  const data = await tmdbFetch('/trending/movie/week');
  if (!data) { renderSampleGrid('trending-grid'); return; }
  trendingCache = data.results.slice(0, 12); renderDiscoverGrid();
}

function renderDiscoverGrid() {
  const wlIds  = new Set(watchlists.flatMap(wl => wl.items.map(i => i.id)));
  const archIds = new Set(library.map(l => l.tmdb_id));
  const visible = trendingCache.filter(m => !archIds.has(m.id) && !wlIds.has(m.id));
  const g = document.getElementById('trending-grid');
  if (!visible.length) { if (g) g.innerHTML = '<div style="color:var(--text3);font-size:13px;grid-column:1/-1;padding:10px 0">Alle Empfehlungen bereits archiviert 🎉</div>'; return; }
  renderMovieGrid('trending-grid', visible);
}

function renderSampleGrid(id) {
  renderMovieGrid(id, [
    {id:157336,title:'Interstellar',release_date:'2014',vote_average:8.4,poster_path:''},
    {id:27205,title:'Inception',release_date:'2010',vote_average:8.8,poster_path:''},
    {id:155,title:'The Dark Knight',release_date:'2008',vote_average:9.0,poster_path:''},
    {id:693134,title:'Dune: Part Two',release_date:'2024',vote_average:8.2,poster_path:''},
    {id:872585,title:'Oppenheimer',release_date:'2023',vote_average:8.6,poster_path:''},
    {id:238,title:'The Godfather',release_date:'1972',vote_average:9.2,poster_path:''},
  ]);
}

async function renderRecentArchive() {
  const recent = [...library].sort((a,b) => b.added - a.added).slice(0, 8);
  const g = document.getElementById('recent-archive-grid');
  if (!recent.length) { if (g) g.innerHTML = '<div style="color:var(--text3);font-size:13px;grid-column:1/-1;padding:10px 0">Noch keine Filme archiviert</div>'; return; }
  renderMovieGrid('recent-archive-grid', recent, true);
}

function encodeMovie(obj) { return btoa(unescape(encodeURIComponent(JSON.stringify(obj)))); }
function decodeMovie(b64) { return JSON.parse(decodeURIComponent(escape(atob(b64)))); }

function renderMovieGrid(containerId, movies) {
  const grid = document.getElementById(containerId);
  if (!grid) return;
  grid.innerHTML = movies.map(m => {
    const id     = m.tmdb_id || m.id;
    const title  = m.title || m.name || 'Unbekannt';
    const year   = (m.release_date || m.year || '').toString().substring(0, 4);
    const rating = m.vote_average ? (m.vote_average/2).toFixed(1) : (m.rating || '');
    const poster = m.poster_path ? `<img src="${IMG_BASE}${m.poster_path}" alt="${esc(title)}" loading="lazy">` : `<div class="movie-poster-placeholder"><div style="font-size:32px">🎬</div></div>`;
    const archived = library.some(l => l.tmdb_id === id);
    const b64 = encodeMovie({id,title,year,poster_path:m.poster_path||'',vote_average:m.vote_average||0,overview:m.overview||'',genres:m.genres||[]});
    return `<div class="movie-card" onclick="openMovieDetail('${b64}')">
      <div class="movie-poster">${poster}
        <div class="movie-actions">
          <button class="action-btn" onclick="event.stopPropagation();quickArchive(${id},'${esc(title)}')" title="Archivieren">${archived?'✓':'+'}</button>
          <button class="action-btn" onclick="event.stopPropagation();showWatchlistPicker(${id},'${esc(title)}','${m.poster_path||''}','${year}')" title="Zur Liste hinzufügen">🔖</button>
        </div>
        ${archived ? '<div class="badge-archived">✓ Archiviert</div>' : ''}
      </div>
      <div class="movie-info">
        <div class="movie-title">${title}</div>
        <div class="movie-meta">${year}</div>
        ${rating ? `<div class="movie-rating">★ ${rating}</div>` : ''}
      </div>
    </div>`;
  }).join('');
}

async function searchMovies() {
  const q = document.getElementById('search-input')?.value.trim(); if (!q) return;
  if (!settings.tmdb_key) {
    toast('⚠ Bitte zuerst TMDB API Key in den Einstellungen eintragen', 'warn');
    showPage('einstellungen', document.querySelectorAll('.nav-tab')[4]);
    return;
  }
  document.getElementById('search-loading').classList.add('visible');
  document.getElementById('search-results-section').style.display = 'none';
  const data = await tmdbFetch('/search/movie', `&query=${encodeURIComponent(q)}&include_adult=false`);
  document.getElementById('search-loading').classList.remove('visible');
  if (!data?.results?.length) { toast('Keine Ergebnisse gefunden'); return; }
  searchCache = data.results.slice(0, 15); renderSearchResults();
}

function renderSearchResults() {
  if (!searchCache.length) return;
  const archIds = new Set(library.map(l => l.tmdb_id));
  const wlIds   = new Set(watchlists.flatMap(wl => wl.items.map(i => i.id)));
  const visible = searchCache.filter(m => !archIds.has(m.id) && !wlIds.has(m.id));
  const hidden  = searchCache.length - visible.length;
  document.getElementById('search-results-section').style.display = 'block';
  document.getElementById('search-results-title').textContent = hidden > 0 ? `SUCHERGEBNISSE (${visible.length} von ${searchCache.length} · ${hidden} archiviert)` : `SUCHERGEBNISSE (${searchCache.length})`;
  renderMovieGrid('search-results', visible.length ? visible : searchCache);
}

const genreMap = {action:28,drama:18,scifi:878,thriller:53,horror:27,animation:16};
async function setFilter(f, btn) {
  document.querySelectorAll('#filter-row .filter-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active');
  if (f === 'all') { renderTrending(); return; }
  const data = await tmdbFetch('/discover/movie', `&with_genres=${genreMap[f]}&sort_by=popularity.desc`);
  if (data) { trendingCache = data.results.slice(0, 12); renderDiscoverGrid(); }
}

// ─── FILM DETAIL ─────────────────────────────────────────────
function openMovieDetail(b64) {
  try { currentMovie = decodeMovie(b64); } catch { return; }
  const existing = library.find(l => l.tmdb_id === currentMovie.id);
  document.getElementById('modal-title').textContent    = currentMovie.title;
  document.getElementById('modal-overview').textContent = currentMovie.overview || 'Keine Beschreibung.';
  document.getElementById('modal-meta').innerHTML = `<span class="modal-meta-item">${currentMovie.year}</span><span class="modal-meta-item" style="color:var(--border2)">•</span><span class="modal-meta-item">★ ${((currentMovie.vote_average||0)/2).toFixed(1)}/5</span>`;
  const img = document.getElementById('modal-backdrop-img');
  if (currentMovie.poster_path) { img.src = `${BACKDROP_BASE}${currentMovie.poster_path}`; img.style.display='block'; } else img.style.display='none';
  document.getElementById('modal-stars').innerHTML = [1,2,3,4,5].map(i => `<button class="star-btn ${i<=(existing?.rating||0)?'active':''}" onclick="setRating(${i})" data-val="${i}">★</button>`).join('');
  document.getElementById('modal-note').value = existing?.note || '';
  renderModalActions();
  document.getElementById('movie-modal').classList.add('open');
  if (settings.tmdb_key) loadFullDetails(currentMovie.id);
}

async function loadFullDetails(id) {
  const data = await tmdbFetch(`/movie/${id}`, '&append_to_response=credits'); if (!data) return;
  currentMovie = {...currentMovie,...data};
  const genres  = data.genres?.slice(0,3).map(g=>`<span class="tag gold">${g.name}</span>`).join('')||'';
  const runtime = data.runtime ? `<span class="modal-meta-item">${Math.floor(data.runtime/60)}h ${data.runtime%60}m</span><span class="modal-meta-item" style="color:var(--border2)">•</span>` : '';
  document.getElementById('modal-meta').innerHTML += `<span class="modal-meta-item" style="color:var(--border2)">•</span>${runtime}<span class="modal-meta-item">${genres}</span>`;
}

function renderModalActions() {
  const isArchived = library.some(l => l.tmdb_id === currentMovie?.id);
  const tmdbUrl = currentMovie?.id ? `https://www.themoviedb.org/movie/${currentMovie.id}` : null;
  document.getElementById('modal-actions').innerHTML = `
    <button class="btn-gold" onclick="archiveCurrentMovie()">${isArchived?'✓ Archiviert':'+ Archivieren'}</button>
    <button class="btn-outline" onclick="addCurrentToWatchlist()">🔖 Watchlist</button>
    ${isArchived ? `<button class="btn-outline" onclick="removeFromLibrary('${currentMovie.id}')" style="border-color:var(--red);color:var(--red)">🗑 Löschen</button>` : `<button class="btn-outline" style="opacity:0.35;pointer-events:none">🗑 Löschen</button>`}
    ${tmdbUrl ? `<a href="${tmdbUrl}" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:6px;padding:10px 16px;border-radius:8px;border:1px solid var(--border2);color:var(--text2);font-family:'Jost',sans-serif;font-size:13px;text-decoration:none;transition:all 0.2s" onmouseover="this.style.borderColor='var(--gold-dim)';this.style.color='var(--gold)'" onmouseout="this.style.borderColor='var(--border2)';this.style.color='var(--text2)'">🌐 TMDB</a>` : ''}`;
}

function setRating(val) {
  document.querySelectorAll('#modal-stars .star-btn').forEach(b => b.classList.toggle('active', parseInt(b.dataset.val) <= val));
  if (!currentMovie) return;
  const idx = library.findIndex(l => l.tmdb_id === currentMovie.id);
  if (idx >= 0) { library[idx].rating = val; save(); } else archiveCurrentMovie(val);
}

function archiveCurrentMovie(forceRating = 0) {
  if (!currentMovie) return;
  let myRating = forceRating;
  document.querySelectorAll('#modal-stars .star-btn').forEach(s => { if (s.classList.contains('active')) myRating = parseInt(s.dataset.val); });
  const entry = { tmdb_id:currentMovie.id, title:currentMovie.title, year:currentMovie.year, poster_path:currentMovie.poster_path||'', overview:currentMovie.overview||'', rating:myRating, note:document.getElementById('modal-note').value, added:Date.now(), genres:currentMovie.genres?.map(g=>g.name)||[], runtime:currentMovie.runtime||0 };
  const idx = library.findIndex(l => l.tmdb_id === currentMovie.id);
  if (idx >= 0) library[idx] = {...library[idx],...entry}; else library.unshift(entry);
  save(); toast('✓ "'+currentMovie.title+'" archiviert'); renderModalActions(); renderRecentArchive(); renderLibrary(); renderDiscoverGrid(); renderSearchResults();
}

function removeFromLibrary(id, skipConfirm = false) {
  const film = library.find(l => l.tmdb_id == id); if (!film) return;
  if (!skipConfirm) { showDeleteConfirm(`"${film.title}" wirklich löschen?`, 'Der Film wird aus deiner Bibliothek entfernt.', () => removeFromLibrary(id, true)); return; }
  library = library.filter(l => l.tmdb_id != id);
  watchlists.forEach(wl => { wl.items = wl.items.filter(i => i.id != id); });
  save(); toast('🗑 "'+film.title+'" gelöscht'); closeModal(); renderLibrary(); renderRecentArchive(); renderStats();
}

function closeModal() { document.getElementById('movie-modal').classList.remove('open'); currentMovie = null; }

function quickArchive(id, title) {
  if (library.some(l => l.tmdb_id === id)) { toast('"'+title+'" bereits archiviert'); return; }
  library.unshift({tmdb_id:id,title,year:'',poster_path:'',overview:'',rating:0,note:'',added:Date.now(),genres:[],runtime:0});
  save(); toast('✓ "'+title+'" archiviert'); renderLibrary(); renderRecentArchive(); renderDiscoverGrid(); renderSearchResults();
}

// ─── BIBLIOTHEK ──────────────────────────────────────────────
function setLibView(v) {
  libView = v;
  document.getElementById('view-grid-btn').classList.toggle('active', v==='grid');
  document.getElementById('view-list-btn').classList.toggle('active', v==='list');
  renderLibrary();
}

function setLibFilter(f, btn) {
  libFilter = f;
  document.querySelectorAll('#lib-filter-row .filter-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active'); renderLibrary();
}

function renderLibrary() {
  const container = document.getElementById('library-container');
  const sort = document.getElementById('sort-select')?.value || 'added';
  const search = (document.getElementById('lib-search')?.value || '').toLowerCase();
  let films = [...library];
  if (search) films = films.filter(f => (f.title||'').toLowerCase().includes(search) || (f.year||'').includes(search));
  if (libFilter === 'gesehen')   films = films.filter(f => f.rating > 0);
  if (libFilter === 'favoriten') films = films.filter(f => f.rating >= 5);
  if (sort === 'rating')     films.sort((a,b) => b.rating - a.rating);
  else if (sort === 'year')  films.sort((a,b) => (b.year||0) - (a.year||0));
  else if (sort === 'title') films.sort((a,b) => (a.title||'').localeCompare(b.title||''));
  else                       films.sort((a,b) => b.added - a.added);
  const bulkBar = document.getElementById('bulk-delete-bar');
  if (bulkBar) bulkBar.style.display = deleteMode ? 'flex' : 'none';
  if (!films.length) { container.innerHTML = `<div class="empty-state"><div class="empty-icon">🎬</div><div class="empty-title">KEINE FILME</div><div class="empty-sub">Suche nach Filmen und archiviere sie</div></div>`; return; }
  if (libView === 'grid') {
    container.innerHTML = `<div class="movie-grid">${films.map(m => {
      const isSel = selectedForDelete.has(m.tmdb_id);
      const poster = m.poster_path ? `<img src="${IMG_BASE}${m.poster_path}" loading="lazy">` : '<div class="movie-poster-placeholder"><div style="font-size:28px">🎬</div></div>';
      const stars = m.rating ? '★'.repeat(m.rating)+'☆'.repeat(5-m.rating) : '';
      const b64 = encodeMovie({id:m.tmdb_id,title:m.title,year:m.year,poster_path:m.poster_path,vote_average:(m.rating||0)*2,overview:m.overview,genres:[]});
      const click = deleteMode ? `onclick="toggleSelectFilm('${m.tmdb_id}',event)"` : `onclick="openMovieDetail('${b64}')"`;
      return `<div class="movie-card ${isSel?'selected-for-delete':''}" id="film-card-${m.tmdb_id}" ${click}>
        <div class="movie-poster">${poster}
          ${deleteMode ? `<div class="delete-select-overlay">${isSel?'<div class="delete-check">✓</div>':'<div class="delete-check-empty"></div>'}</div>` : `<div class="movie-actions"><button class="action-btn" onclick="event.stopPropagation();removeFromLibrary('${m.tmdb_id}')" style="color:var(--red)">🗑</button></div>`}
          ${!deleteMode ? '<div class="badge-archived">✓</div>' : ''}
        </div>
        <div class="movie-info"><div class="movie-title">${esc(m.title)}</div><div class="movie-meta">${m.year}</div>${stars?`<div class="movie-rating" style="font-size:10px">${stars}</div>`:''}</div>
      </div>`;
    }).join('')}</div>`;
  } else {
    container.innerHTML = `<div class="lib-list">${films.map(m => {
      const isSel = selectedForDelete.has(m.tmdb_id);
      const poster = m.poster_path ? `<img src="${IMG_BASE}${m.poster_path}" loading="lazy">` : '';
      const tags = (m.genres||[]).slice(0,3).map(g=>`<span class="tag">${g}</span>`).join('');
      const b64 = encodeMovie({id:m.tmdb_id,title:m.title,year:m.year,poster_path:m.poster_path,vote_average:(m.rating||0)*2,overview:m.overview,genres:[]});
      const click = deleteMode ? `onclick="toggleSelectFilm('${m.tmdb_id}',event)"` : `onclick="openMovieDetail('${b64}')"`;
      return `<div class="lib-item ${isSel?'selected-for-delete':''}" id="film-card-${m.tmdb_id}" ${click}>
        ${deleteMode ? `<div style="width:24px;height:24px;border-radius:50%;border:2px solid ${isSel?'var(--red)':'var(--border2)'};background:${isSel?'rgba(224,82,82,0.2)':'transparent'};display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:13px;color:var(--red)">${isSel?'✓':''}</div>` : ''}
        <div class="lib-poster">${poster}</div>
        <div class="lib-info"><div class="lib-title">${esc(m.title)}</div><div class="lib-meta">${m.year}${m.runtime?' · '+Math.floor(m.runtime/60)+'h '+m.runtime%60+'m':''}</div><div class="lib-tags">${tags}${m.note?'<span class="tag gold">📝</span>':''}</div></div>
        ${m.rating?`<div class="lib-rating">★ ${m.rating}</div>`:'<div class="lib-rating" style="color:var(--text3)">—</div>'}
        ${!deleteMode?`<div class="lib-actions"><button class="action-btn" onclick="event.stopPropagation();removeFromLibrary('${m.tmdb_id}')" style="color:var(--red)">🗑</button></div>`:''}
      </div>`;
    }).join('')}</div>`;
  }
  if (deleteMode) setTimeout(updateBulkBar, 0);
}

function toggleDeleteMode() {
  deleteMode = !deleteMode; selectedForDelete.clear(); renderLibrary();
  const btn = document.getElementById('delete-mode-btn');
  if (btn) { btn.textContent = deleteMode ? '✕ Abbrechen' : '🗑 Auswählen'; btn.style.borderColor = deleteMode?'var(--red)':''; btn.style.color = deleteMode?'var(--red)':''; }
}

function toggleSelectFilm(id, evt) {
  evt.stopPropagation();
  if (selectedForDelete.has(id)) selectedForDelete.delete(id); else selectedForDelete.add(id);
  updateBulkBar();
  document.getElementById('film-card-'+id)?.classList.toggle('selected-for-delete', selectedForDelete.has(id));
}

function updateBulkBar() {
  const count = selectedForDelete.size;
  const label = document.getElementById('bulk-delete-label');
  const btn   = document.getElementById('bulk-delete-confirm-btn');
  const all   = document.getElementById('select-all-btn');
  if (label) label.textContent = count===0 ? 'Filme zum Löschen auswählen' : `${count} Film${count!==1?'e':''} ausgewählt`;
  if (btn)   btn.style.display = count>0 ? 'inline-block' : 'none';
  if (all)   all.textContent   = selectedForDelete.size>=library.length ? 'Alle abwählen' : 'Alle auswählen';
}

function selectAllFilms() {
  const ids = Array.from(document.querySelectorAll('[id^="film-card-"]')).map(el => el.id.replace('film-card-',''));
  const allSel = ids.every(id => selectedForDelete.has(id));
  if (allSel) ids.forEach(id => selectedForDelete.delete(id)); else ids.forEach(id => selectedForDelete.add(id));
  renderLibrary(); updateBulkBar();
}

function bulkDeleteSelected() {
  if (!selectedForDelete.size) return;
  const count = selectedForDelete.size;
  showDeleteConfirm(`${count} Film${count!==1?'e':''} löschen?`, 'Diese Filme werden unwiderruflich entfernt.', () => {
    library = library.filter(f => !selectedForDelete.has(f.tmdb_id));
    watchlists.forEach(wl => { wl.items = wl.items.filter(i => !selectedForDelete.has(i.id)); });
    selectedForDelete.clear(); deleteMode = false; save(); renderLibrary(); renderStats(); renderRecentArchive();
    toast(`🗑 ${count} Film${count!==1?'e':''} gelöscht`);
  });
}

function showDeleteConfirm(title, subtitle, onConfirm) {
  document.getElementById('delete-confirm-dialog')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'delete-confirm-dialog';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:400;display:flex;align-items:center;justify-content:center;padding:20px';
  overlay.innerHTML = `<div style="background:var(--bg2);border:1px solid var(--border2);border-radius:16px;padding:28px;max-width:400px;width:100%;text-align:center"><div style="font-size:36px;margin-bottom:12px">🗑</div><div style="font-family:'Cinzel',serif;font-size:16px;color:var(--text);margin-bottom:8px">${title}</div><div style="font-size:13px;color:var(--text2);margin-bottom:24px;line-height:1.5">${subtitle}</div><div style="display:flex;gap:12px;justify-content:center"><button onclick="document.getElementById('delete-confirm-dialog').remove()" style="padding:10px 24px;border-radius:8px;border:1px solid var(--border2);background:transparent;color:var(--text2);font-family:'Jost',sans-serif;font-size:14px;cursor:pointer">Abbrechen</button><button id="delete-confirm-ok" style="padding:10px 24px;border-radius:8px;border:1px solid var(--red);background:rgba(224,82,82,0.12);color:var(--red);font-family:'Cinzel',serif;font-size:13px;letter-spacing:1px;cursor:pointer">LÖSCHEN</button></div></div>`;
  document.body.appendChild(overlay);
  document.getElementById('delete-confirm-ok').onclick = () => { overlay.remove(); onConfirm(); };
  overlay.onclick = e => { if (e.target===overlay) overlay.remove(); };
}

// ─── WATCHLIST ───────────────────────────────────────────────
function addToWatchlistById(id, title, posterPath='', year='') {
  // Bereits archiviert?
  if (library.some(l => l.tmdb_id === id)) { toast('"'+title+'" ist bereits im Archiv'); return; }
  // Bereits in einer Watchlist?
  const alreadyIn = watchlists.filter(wl => wl.items.some(i => i.id === id));
  if (alreadyIn.length) { toast('"'+title+'" ist bereits in: '+alreadyIn.map(w=>w.name).join(', ')); return; }
  // Immer Picker zeigen (mit Archivieren-Option)
  showWatchlistPicker(id, title, posterPath, year);
}

function showWatchlistPicker(id, title, posterPath, year) {
  document.getElementById('watchlist-picker-dialog')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'watchlist-picker-dialog';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:400;display:flex;align-items:center;justify-content:center;padding:20px';
  const listButtons = watchlists.map(wl => `
    <button onclick="addToList(${id},'${esc(title)}','${posterPath}','${year}',${wl.id})"
      style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:var(--bg3);border:1px solid var(--border);border-radius:10px;color:var(--text);font-family:'Jost',sans-serif;font-size:14px;cursor:pointer;text-align:left;width:100%"
      onmouseover="this.style.borderColor='var(--gold-dim)'" onmouseout="this.style.borderColor='var(--border)'">
      <div style="display:flex;align-items:center;gap:10px"><span>🔖</span><span>${esc(wl.name)}</span></div>
      <span style="font-size:12px;color:var(--text2)">${wl.items.length} Filme</span>
    </button>`).join('');
  overlay.innerHTML = `
    <div style="background:var(--bg2);border:1px solid var(--border2);border-radius:16px;padding:24px;max-width:380px;width:100%">
      <div style="font-family:'Cinzel',serif;font-size:14px;color:var(--gold);letter-spacing:2px;margin-bottom:6px">WAS MÖCHTEST DU TUN?</div>
      <div style="font-size:13px;color:var(--text2);margin-bottom:16px">${esc(title)}</div>
      <div style="display:flex;flex-direction:column;gap:8px;max-height:320px;overflow-y:auto">
        <button onclick="quickArchive(${id},'${esc(title)}');document.getElementById('watchlist-picker-dialog').remove()"
          style="display:flex;align-items:center;gap:12px;padding:12px 16px;background:rgba(201,168,76,0.1);border:1px solid rgba(201,168,76,0.4);border-radius:10px;color:var(--gold);font-family:'Jost',sans-serif;font-size:14px;cursor:pointer;text-align:left;width:100%">
          <span style="font-size:20px">🎬</span>
          <div><div style="font-weight:600">Zu Mein Archiv hinzufügen</div><div style="font-size:11px;opacity:0.7">Film direkt archivieren</div></div>
        </button>
        ${listButtons}
      </div>
      <button onclick="document.getElementById('watchlist-picker-dialog').remove()"
        style="margin-top:14px;width:100%;padding:10px;border-radius:8px;border:1px solid var(--border2);background:transparent;color:var(--text2);font-family:'Jost',sans-serif;font-size:13px;cursor:pointer">
        Abbrechen
      </button>
    </div>`;
  document.body.appendChild(overlay);
  overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
}


function addToList(id, title, posterPath, year, listId) {
  document.getElementById('watchlist-picker-dialog')?.remove();
  const wl = watchlists.find(w => w.id === listId);
  if (!wl) return;
  wl.items.push({id, title, added:Date.now(), done:false, poster_path:posterPath, year, rating:0});
  save(); toast('🔖 "'+title+'" → '+wl.name); renderWatchlists(); renderDiscoverGrid(); renderSearchResults();
}

function addCurrentToWatchlist() {
  if (currentMovie) addToWatchlistById(currentMovie.id, currentMovie.title, currentMovie.poster_path||'', currentMovie.year||'');
}
function toggleNewListForm() { document.getElementById('new-list-form').classList.toggle('open'); }

function createNewList() {
  const name = document.getElementById('new-list-name').value.trim(); if (!name) return;
  watchlists.push({id:Date.now(),name,items:[],created:Date.now()});
  save(); renderWatchlists();
  document.getElementById('new-list-name').value = '';
  document.getElementById('new-list-form').classList.remove('open');
  toast('✓ Liste "'+name+'" erstellt');
}

function renderWatchlists() {
  const c = document.getElementById('watchlist-container');
  if (!watchlists.length) { c.innerHTML = `<div class="empty-state"><div class="empty-icon">🔖</div><div class="empty-title">KEINE LISTEN</div></div>`; return; }
  c.innerHTML = watchlists.map(wl => `
    <div class="list-section">
      <div class="list-header">
        <div style="display:flex;align-items:center;gap:10px"><div class="section-title" style="margin:0">${esc(wl.name)}</div><span style="font-size:12px;color:var(--text2)">${wl.items.length} Filme</span></div>
        <button class="btn-outline" style="font-size:11px;padding:5px 10px" onclick="deleteList(${wl.id})">✕ Löschen</button>
      </div>
      <div style="background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:0 16px">
        ${!wl.items.length ? '<div style="padding:20px;text-align:center;color:var(--text3);font-size:13px">Noch keine Filme</div>' : ''}
        ${wl.items.map((item,i) => {
          // Film-Daten aus Bibliothek holen falls vorhanden
          const libEntry = library.find(l => l.tmdb_id === item.id);
          const b64 = encodeMovie({
            id:           item.id,
            title:        item.title,
            year:         libEntry?.year        || item.year        || '',
            poster_path:  libEntry?.poster_path || item.poster_path || '',
            vote_average: (libEntry?.rating||0) * 2,
            overview:     libEntry?.overview    || '',
            genres:       libEntry?.genres?.map(g=>({name:g})) || []
          });
          return `<div class="wl-item" style="cursor:pointer" onclick="openMovieDetail('${b64}')">
            <div class="wl-num">${i+1}</div>
            <div class="wl-poster">${(libEntry?.poster_path||item.poster_path)?`<img src="${IMG_BASE}${libEntry?.poster_path||item.poster_path}" loading="lazy">`:'🎬'}</div>
            <div class="wl-info">
              <div class="wl-title">${esc(item.title)}</div>
              ${libEntry?.year||item.year ? `<div class="wl-meta">${libEntry?.year||item.year}</div>` : ''}
            </div>
            <button class="wl-check ${item.done?'done':''}" onclick="event.stopPropagation();toggleWLItem(${wl.id},${item.id})">${item.done?'✓':'○'}</button>
            <button class="action-btn" onclick="event.stopPropagation();removeFromWL(${wl.id},${item.id})" style="color:var(--red)">✕</button>
          </div>`;
        }).join('')}
      </div>
    </div>`).join('');
}

function toggleWLItem(listId, itemId) {
  const item = watchlists.find(w=>w.id===listId)?.items.find(i=>i.id===itemId); if (!item) return;
  item.done = !item.done; save(); renderWatchlists();
}
function removeFromWL(listId, itemId) {
  const wl = watchlists.find(w=>w.id===listId); if (!wl) return;
  wl.items = wl.items.filter(i=>i.id!==itemId); save(); renderWatchlists();
}
function deleteList(id) { watchlists = watchlists.filter(w=>w.id!==id); save(); renderWatchlists(); toast('Liste gelöscht'); }

// ─── STATISTIKEN ─────────────────────────────────────────────
function renderStats() {
  const total = library.length, rated = library.filter(f=>f.rating>0).length;
  const avgRating = rated ? (library.reduce((s,f)=>s+(f.rating||0),0)/rated).toFixed(1) : '—';
  const totalHours = Math.floor(library.reduce((s,f)=>s+(f.runtime||0),0)/60);
  const totalSeries    = (typeof seriesLibrary!=='undefined') ? seriesLibrary.length : 0;
  const watchingSeries = (typeof seriesLibrary!=='undefined') ? seriesLibrary.filter(s=>s.status==='watching').length : 0;
  document.getElementById('stats-cards').innerHTML = [
    {val:total,label:'Archivierte Filme',sub:''},
    {val:avgRating,label:'Ø Bewertung',sub:'von 5 Sternen'},
    {val:totalHours+'h',label:'Geschaute Zeit',sub:Math.floor(totalHours/24)+' Tage'},
    {val:watchlists.reduce((s,w)=>s+w.items.length,0),label:'Watchlist-Einträge',sub:''},
    {val:totalSeries,label:'Serien archiviert',sub:''},
    {val:watchingSeries,label:'Serien am Schauen',sub:''},
  ].map(s=>`<div class="stat-card"><div class="stat-val">${s.val}</div><div class="stat-label">${s.label}</div>${s.sub?`<div class="stat-sub">${s.sub}</div>`:''}</div>`).join('');

  const now = new Date(), months = ['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'];
  const mc = Array(6).fill(0);
  library.forEach(f=>{const d=new Date(f.added),diff=(now.getFullYear()-d.getFullYear())*12+(now.getMonth()-d.getMonth());if(diff>=0&&diff<6)mc[5-diff]++;});
  const maxM = Math.max(...mc,1);
  document.getElementById('monthly-chart').innerHTML = mc.map((c,i)=>{const mo=new Date(now.getFullYear(),now.getMonth()-(5-i),1);return `<div class="bar-col"><div class="bar-wrap"><div class="bar" style="height:${Math.round(c/maxM*100)}%"></div></div><div class="bar-label">${months[mo.getMonth()]}</div></div>`;}).join('');

  const genreCounts={};
  library.forEach(f=>(f.genres||[]).forEach(g=>{genreCounts[g]=(genreCounts[g]||0)+1;}));
  const topGenres=Object.entries(genreCounts).sort((a,b)=>b[1]-a[1]).slice(0,6);
  const maxG=topGenres.length?topGenres[0][1]:1;
  document.getElementById('genre-chart').innerHTML = topGenres.length
    ? topGenres.map(([g,c])=>`<div class="genre-row"><div class="genre-name">${g}</div><div class="genre-bar-wrap"><div class="genre-bar" style="width:${Math.round(c/maxG*100)}%"></div></div><div class="genre-pct">${Math.round(c/Math.max(total,1)*100)}%</div></div>`).join('')
    : '<div style="color:var(--text3);font-size:13px;padding:10px 0">Noch keine Daten</div>';

  const decades={};
  library.forEach(f=>{if(f.year){const d=Math.floor(parseInt(f.year)/10)*10;if(!decades[d])decades[d]=0;decades[d]++;}});
  const decArr=Object.entries(decades).sort((a,b)=>a[0]-b[0]), maxD=Math.max(...decArr.map(([,v])=>v),1);
  document.getElementById('decade-chart').innerHTML = decArr.length ? decArr.map(([d,v])=>`<div class="bar-col"><div class="bar-wrap"><div class="bar" style="height:${Math.round(v/maxD*100)}%"></div></div><div class="bar-label">${d}er</div></div>`).join('') : '<div style="color:var(--text3);font-size:13px">Noch keine Daten</div>';

  const topRated=[...library].filter(f=>f.rating>0).sort((a,b)=>b.rating-a.rating).slice(0,5);
  document.getElementById('top-rated-list').innerHTML = topRated.map((f,i)=>{
    const b64=encodeMovie({id:f.tmdb_id,title:f.title,year:f.year,poster_path:f.poster_path,vote_average:(f.rating||0)*2,overview:f.overview,genres:[]});
    return `<div class="lib-item" onclick="openMovieDetail('${b64}')"><div style="font-family:'Cinzel',serif;font-size:14px;color:var(--text3);width:24px;text-align:center;flex-shrink:0">${i+1}</div><div class="lib-poster">${f.poster_path?`<img src="${IMG_BASE}${f.poster_path}" loading="lazy">`:'🎬'}</div><div class="lib-info"><div class="lib-title">${esc(f.title)}</div><div class="lib-meta">${f.year||''}</div></div><div class="lib-rating">★ ${f.rating}</div></div>`;
  }).join('') || '<div style="color:var(--text3);font-size:13px;padding:20px 0;text-align:center">Noch keine bewerteten Filme</div>';
}

// ─── KODI IMPORT ─────────────────────────────────────────────
async function handleKodiImport(event) {
  const files = Array.from(event.target.files); if (!files.length) return;
  importQueue = [];
  for (const file of files) {
    const text = await file.text();
    const titleMatch = text.match(/<title>(.*?)<\/title>/i) || text.match(/"title"\s*:\s*"([^"]+)"/);
    const yearMatch  = text.match(/<year>(\d{4})<\/year>/i) || text.match(/\((\d{4})\)/);
    if (titleMatch) importQueue.push({title:(titleMatch[1]||'').trim(),year:yearMatch?yearMatch[1]:'',status:'wait',source:file.name});
  }
  document.getElementById('import-results').classList.add('visible'); renderImportQueue();
}

async function manualImport() {
  const input = document.getElementById('manual-import-input').value.trim(); if (!input) return;
  importQueue = input.split('\n').map(t=>t.trim()).filter(Boolean).map(title=>({title,year:'',status:'wait',source:'manuell'}));
  document.getElementById('import-results').classList.add('visible'); renderImportQueue();
}

function renderImportQueue() {
  document.getElementById('import-items-list').innerHTML = importQueue.map((item,i)=>`<div class="import-item"><div class="import-status ${item.status}" id="import-status-${i}">${item.status==='ok'?'✓':item.status==='err'?'✕':'…'}</div><div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:500;color:var(--text)">${esc(item.title)}${item.year?' ('+item.year+')':''}</div><div style="font-size:11px;color:var(--text3)">${item.source}</div></div></div>`).join('');
}

async function confirmImport() {
  if (!settings.tmdb_key) { toast('⚠ TMDB API Key fehlt','warn'); return; }
  for (let i=0;i<importQueue.length;i++) {
    const item=importQueue[i],el=document.getElementById('import-status-'+i);
    if(el){el.className='import-status wait';el.textContent='…';}
    const data=await tmdbFetch('/search/movie',`&query=${encodeURIComponent(item.title)}&year=${item.year||''}`);
    await new Promise(r=>setTimeout(r,250));
    if(data?.results?.[0]){const m=data.results[0];item.status='ok';if(!library.some(l=>l.tmdb_id===m.id))library.unshift({tmdb_id:m.id,title:m.title,year:(m.release_date||'').substring(0,4),poster_path:m.poster_path||'',overview:m.overview||'',rating:0,note:'',added:Date.now(),genres:[],runtime:0});}
    else item.status='err';
    if(el){el.className=`import-status ${item.status}`;el.textContent=item.status==='ok'?'✓':'✕';}
  }
  save(); renderLibrary(); renderStats(); toast(`✓ ${importQueue.filter(i=>i.status==='ok').length} von ${importQueue.length} Filmen importiert`);
}

function clearImport() { importQueue=[]; document.getElementById('import-results').classList.remove('visible'); document.getElementById('import-items-list').innerHTML=''; document.getElementById('manual-import-input').value=''; }

// ─── EINSTELLUNGEN ───────────────────────────────────────────
function saveTMDBKey(val) { settings.tmdb_key=val.trim(); save(); document.getElementById('api-status-row').style.display=val?'flex':'none'; }
function saveLang(val) { settings.lang=val; save(); }
function saveVercelUrl(val) { settings.vercel_url=val.trim().replace(/\/$/,''); save(); if(settings.vercel_url) checkDriveStatus(); }

// ─── GOOGLE DRIVE ────────────────────────────────────────────
function getApiBase() { return (settings.vercel_url||'').replace(/\/$/,''); }

function getDriveToken() {
  try { const d=JSON.parse(localStorage.getItem('reelora_drive_token')||''); if(d.expires_at&&d.expires_at<Date.now())return null; return d.access_token||null; }
  catch { return null; }
}

function driveHeaders() { const t=getDriveToken(),h={'Content-Type':'application/json'}; if(t) h['Authorization']='Bearer '+t; return h; }

function connectGoogleDrive() { const api=getApiBase(); if(!api){toast('⚠ Vercel URL fehlt','warn');return;} window.location.href=api+'/api/auth/login'; }

async function disconnectDrive() {
  try { await fetch(getApiBase()+'/api/auth/status',{method:'DELETE',credentials:'include'}); } catch(_){}
  localStorage.removeItem('reelora_drive_token'); settings.drive_connected=false; settings.drive_account=''; save(); updateDriveUI(); toast('Google Drive getrennt');
}

async function checkDriveStatus() {
  const api=getApiBase(); if(!api) return;
  try { const res=await fetch(api+'/api/auth/status',{credentials:'include',headers:driveHeaders()}),data=await res.json(); if(data.connected&&!data.expired){settings.drive_connected=true;settings.drive_account=data.email||'';save();updateDriveUI();return true;} } catch(_){}
  return false;
}

async function loadFromDrive() {
  const api=getApiBase(); if(!api||!settings.drive_connected) return;
  try {
    const res=await fetch(api+'/api/drive/sync',{credentials:'include',headers:driveHeaders()});
    if(res.status===401){toast('⚠ Drive: Bitte neu anmelden','warn');settings.drive_connected=false;save();updateDriveUI();return;}
    if(!res.ok){toast('Drive Fehler: '+res.status,'err');return;}
    const data=await res.json();
    if(!data.exists){toast('☁ Drive bereit – MeineApps/ReelOra angelegt');return;}
    if(data.library?.length) library=data.library;
    if(data.watchlists?.length) watchlists=data.watchlists;
    if(data.seriesLibrary?.length&&typeof seriesLibrary!=='undefined'){seriesLibrary=data.seriesLibrary;saveSeries();}
    if(data.seriesWatchlist?.length&&typeof seriesWatchlist!=='undefined'){seriesWatchlist=data.seriesWatchlist;saveSeries();}
    save(); renderLibrary(); renderWatchlists(); renderStats(); renderRecentArchive();
    toast('☁ Geladen (Stand: '+(data.lastSync?new Date(data.lastSync).toLocaleString('de-DE'):'—')+')');
    const sub=document.getElementById('drive-account-sub'); if(sub) sub.textContent=(settings.drive_account||'')+' · MeineApps/ReelOra';
  } catch(e) { toast('Drive Ladefehler: '+e.message,'err'); }
}

async function driveSync() {
  const api=getApiBase(); if(!api||!settings.drive_connected) return;
  try {
    const res=await fetch(api+'/api/drive/sync',{method:'POST',credentials:'include',headers:driveHeaders(),body:JSON.stringify({library,watchlists,seriesLibrary:(typeof seriesLibrary!=='undefined')?seriesLibrary:[],seriesWatchlist:(typeof seriesWatchlist!=='undefined')?seriesWatchlist:[]})});
    if(!res.ok){const err=await res.json().catch(()=>({}));if(err.error==='NOT_AUTHENTICATED'){settings.drive_connected=false;save();updateDriveUI();toast('⚠ Drive: Bitte neu anmelden','warn');return;}throw new Error(err.error||res.status);}
    const now=new Date().toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'});
    const sub=document.getElementById('last-sync-sub'); if(sub) sub.textContent='Zuletzt synchronisiert: '+now;
    toast('☁ Synchronisiert → MeineApps/ReelOra');
  } catch(e) { toast('Drive Sync Fehler: '+e.message,'err'); }
}

async function manualSync() { if(!settings.drive_connected){toast('⚠ Nicht verbunden','warn');return;} await driveSync(); }

function updateDriveUI() {
  const badge=document.getElementById('drive-status-badge'),btn=document.getElementById('drive-connect-btn'),syncRow=document.getElementById('drive-sync-row'),manualRow=document.getElementById('drive-manual-row'),sub=document.getElementById('drive-account-sub');
  const logo=document.getElementById('user-avatar');
  if(!badge) return;
  if(settings.drive_connected){
    badge.className='drive-status connected'; badge.innerHTML='<div class="dot green"></div>Verbunden';
    btn.textContent='Trennen'; btn.onclick=disconnectDrive;
    if(syncRow) syncRow.style.display='flex'; if(manualRow) manualRow.style.display='flex';
    if(sub) sub.textContent=settings.drive_account||'Verbunden';
    // Logo: grüner Ring wenn verbunden
    if(logo) logo.style.outline='2px solid var(--green)';
    if(logo) logo.title='Drive verbunden: '+(settings.drive_account||'');
  } else {
    badge.className='drive-status disconnected'; badge.innerHTML='<div class="dot gray"></div>Nicht verbunden';
    btn.textContent='Mit Google anmelden'; btn.onclick=connectGoogleDrive;
    if(syncRow) syncRow.style.display='none'; if(manualRow) manualRow.style.display='none';
    if(sub) sub.textContent='Nicht verbunden';
    if(logo) logo.style.outline='none';
    if(logo) logo.title='Einstellungen';
  }
}

// ─── EXPORT / IMPORT ─────────────────────────────────────────
function exportLibrary() {
  const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([JSON.stringify({library,watchlists,exported:new Date().toISOString(),version:'1.0'},null,2)],{type:'application/json'}));
  a.download=`reelora_export_${new Date().toISOString().split('T')[0]}.json`; a.click(); toast('✓ Export heruntergeladen');
}

function importBackup(event) {
  const file=event.target.files[0]; if(!file) return;
  const reader=new FileReader();
  reader.onload=e=>{try{const data=JSON.parse(e.target.result);if(data.library)library=data.library;if(data.watchlists)watchlists=data.watchlists;save();renderLibrary();renderWatchlists();renderStats();renderRecentArchive();toast('✓ '+library.length+' Filme importiert');}catch{toast('⚠ Ungültige Datei','err');}};
  reader.readAsText(file);
}

function clearAll() {
  if(!confirm('Wirklich alle Daten löschen?')) return;
  library=[]; watchlists=[{id:1,name:'Watchlist',items:[],created:Date.now()},{id:2,name:'Favoriten',items:[],created:Date.now()}];
  save(); renderLibrary(); renderWatchlists(); renderStats(); renderRecentArchive(); toast('Alle Daten gelöscht');
}

// ─── KODI NETZWERK ───────────────────────────────────────────
function saveKodiSettings() {
  settings.kodi_host=document.getElementById('kodi-host')?.value.trim()||document.getElementById('kodi-host-settings')?.value.trim()||'';
  settings.kodi_port=document.getElementById('kodi-port')?.value.trim()||'8080';
  settings.kodi_user=document.getElementById('kodi-user')?.value.trim()||'';
  settings.kodi_pass=document.getElementById('kodi-pass')?.value||'';
  save(); syncKodiFields();
}

function syncKodiFields() {
  const h=settings.kodi_host||'',p=settings.kodi_port||'8080',u=settings.kodi_user||'';
  ['kodi-host','kodi-host-settings'].forEach(id=>{const el=document.getElementById(id);if(el)el.value=h;});
  ['kodi-port','kodi-port-settings'].forEach(id=>{const el=document.getElementById(id);if(el)el.value=p;});
  const ku=document.getElementById('kodi-user'); if(ku) ku.value=u;
}

function loadKodiSettingsIntoFields() { syncKodiFields(); if(settings.kodi_host) document.getElementById('kodi-import-panel').style.display='block'; }

async function kodiRPC(method,params={}) {
  const host=settings.kodi_host,port=settings.kodi_port||'8080',user=settings.kodi_user,pass=settings.kodi_pass;
  if(!host) throw new Error('Keine Kodi-IP konfiguriert');
  const headers={'Content-Type':'application/json'}; if(user) headers['Authorization']='Basic '+btoa(user+':'+(pass||''));
  const ctrl=new AbortController(),timeout=setTimeout(()=>ctrl.abort(),8000);
  try {
    const res=await fetch(`http://${host}:${port}/jsonrpc`,{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',method,params,id:Date.now()}),signal:ctrl.signal});
    clearTimeout(timeout); if(!res.ok) throw new Error('HTTP '+res.status);
    const data=await res.json(); if(data.error) throw new Error(data.error.message); return data.result;
  } catch(e){clearTimeout(timeout);if(e.name==='AbortError')throw new Error('Zeitüberschreitung');throw e;}
}

async function testKodiConnection() {
  saveKodiSettings();
  const badge=document.getElementById('kodi-conn-badge'),sub=document.getElementById('kodi-conn-sub');
  if(badge){badge.className='drive-status disconnected';badge.innerHTML='<div class="dot gray"></div>Verbinde...';}
  try {
    const result=await kodiRPC('Application.GetProperties',{properties:['name','version']});
    const name=result?.name||'Kodi',ver=result?.version?.major?`v${result.version.major}.${result.version.minor}`:'';
    if(badge){badge.className='drive-status connected';badge.innerHTML='<div class="dot green"></div>Verbunden';}
    if(sub) sub.textContent=`${name} ${ver}`;
    document.getElementById('kodi-import-panel').style.display='block';
    settings.kodi_connected=true; save(); toast('✓ Kodi verbunden: '+name+' '+ver); loadKodiLibrary();
  } catch(e) {
    if(badge){badge.className='drive-status disconnected';badge.innerHTML='<div class="dot" style="background:var(--red)"></div>Fehler';}
    if(sub) sub.textContent=e.message; toast('✗ '+e.message,'err');
  }
}

async function loadKodiLibrary() {
  const statusEl=document.getElementById('kodi-load-status'),listEl=document.getElementById('kodi-movie-list'),importBtn=document.getElementById('kodi-import-all-btn');
  if(statusEl) statusEl.classList.add('visible'); if(listEl) listEl.innerHTML=''; if(importBtn) importBtn.style.display='none';
  try {
    const result=await kodiRPC('VideoLibrary.GetMovies',{properties:['title','year','rating','playcount','genre','runtime','plot','thumbnail','imdbnumber','originaltitle','file'],limits:{start:0,end:10000},sort:{order:'ascending',method:'title'}});
    if(statusEl) statusEl.classList.remove('visible');
    const movies=result?.movies||[];
    if(!movies.length){if(listEl)listEl.innerHTML='<div class="empty-state"><div class="empty-icon">🎬</div><div class="empty-title">KEINE FILME</div></div>';return;}
    kodiMoviesCache=kodiMoviesFiltered=movies; renderKodiMovieList(movies);
    if(importBtn) importBtn.style.display='inline-block'; toast(`✓ ${movies.length} Filme geladen`);
  } catch(e) {
    if(statusEl) statusEl.classList.remove('visible');
    if(listEl) listEl.innerHTML=`<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-title">FEHLER</div><div class="empty-sub">${esc(e.message)}</div></div>`;
    toast('Kodi Fehler: '+e.message,'err');
  }
}

function renderKodiMovieList(movies) {
  const listEl=document.getElementById('kodi-movie-list'); if(!listEl) return;
  const archived=movies.filter(m=>library.some(l=>l.title.toLowerCase()===(m.title||'').toLowerCase())).length;
  listEl.innerHTML=`<div style="display:flex;gap:16px;margin-bottom:16px;flex-wrap:wrap">
    <div class="stat-card" style="flex:1;min-width:120px;padding:14px"><div class="stat-val" style="font-size:24px">${movies.length}</div><div class="stat-label">Kodi Filme</div></div>
    <div class="stat-card" style="flex:1;min-width:120px;padding:14px"><div class="stat-val" style="font-size:24px;color:var(--green)">${archived}</div><div class="stat-label">Archiviert</div></div>
    <div class="stat-card" style="flex:1;min-width:120px;padding:14px"><div class="stat-val" style="font-size:24px;color:var(--gold)">${movies.length-archived}</div><div class="stat-label">Neu</div></div>
  </div><div class="lib-list">${movies.map(m=>renderKodiMovieRow(m)).join('')}</div>`;
}

function renderKodiMovieRow(m) {
  const title=m.title||m.originaltitle||'Unbekannt',year=m.year||'',genres=(m.genre||[]).slice(0,3).join(', '),runtime=m.runtime?Math.floor(m.runtime/60)+'h '+(m.runtime%60)+'m':'';
  const isArch=library.some(l=>l.title.toLowerCase()===title.toLowerCase());
  return `<div class="lib-item" id="kodi-row-${m.movieid}"><div class="lib-poster">🎬</div><div class="lib-info"><div class="lib-title">${esc(title)}</div><div class="lib-meta">${year}${runtime?' · '+runtime:''}${genres?' · '+genres:''}</div><div class="lib-tags">${m.playcount>0?'<span class="tag green">✓ Gesehen</span>':'<span class="tag">Nicht gesehen</span>'}${isArch?'<span class="tag gold">✓ Archiviert</span>':''}</div></div>${isArch?'<span style="font-size:11px;color:var(--green);padding:6px">✓</span>':`<button class="btn-outline" style="font-size:11px;padding:6px 12px" onclick="importSingleKodiMovie(${m.movieid})">+ Importieren</button>`}</div>`;
}

async function importSingleKodiMovie(kodiId) {
  const movie=kodiMoviesCache.find(m=>m.movieid===kodiId); if(!movie) return;
  await archiveKodiMovie(movie);
  const row=document.getElementById('kodi-row-'+kodiId); if(row) row.outerHTML=renderKodiMovieRow(movie);
  save(); renderLibrary(); renderStats();
}

async function importAllKodiMovies() {
  const toImport=kodiMoviesFiltered.filter(m=>!library.some(l=>l.title.toLowerCase()===(m.title||'').toLowerCase()));
  if(!toImport.length){toast('Alle Filme bereits archiviert');return;}
  let count=0;
  for(const m of toImport){await archiveKodiMovie(m);count++;if(count%10===0)toast(`${count}/${toImport.length} importiert...`);}
  save(); renderKodiMovieList(kodiMoviesFiltered); renderLibrary(); renderStats(); renderRecentArchive(); toast(`✓ ${count} Filme importiert`);
}

async function archiveKodiMovie(m) {
  const title=m.title||m.originaltitle||'';
  let poster='',genres=m.genre||[],overview=m.plot||'',runtime=m.runtime||0,tmdbId=null;
  if(settings.tmdb_key&&title){
    try{const res=await tmdbFetch('/search/movie',`&query=${encodeURIComponent(title)}&year=${m.year||''}&include_adult=false`);if(res?.results?.[0]){const t=res.results[0];tmdbId=t.id;poster=t.poster_path||'';if(!overview)overview=t.overview||'';if(!genres.length&&t.genre_ids)genres=t.genre_ids.map(id=>tmdbGenreName(id)).filter(Boolean);}await new Promise(r=>setTimeout(r,150));}catch(_){}
  }
  const entry={tmdb_id:tmdbId||('kodi_'+(m.movieid||Date.now())),title,year:String(m.year||''),poster_path:poster,overview,rating:m.rating?Math.round(m.rating/2):0,note:m.playcount>0?'▶ In Kodi gesehen':'',added:Date.now(),genres,runtime,kodi_id:m.movieid,source:'kodi'};
  const idx=library.findIndex(l=>l.tmdb_id===entry.tmdb_id||l.title.toLowerCase()===title.toLowerCase());
  if(idx>=0) library[idx]={...library[idx],...entry}; else library.unshift(entry);
}

function filterKodiMovies() {
  const q=(document.getElementById('kodi-filter-input')?.value||'').toLowerCase();
  kodiMoviesFiltered=q?kodiMoviesCache.filter(m=>(m.title||'').toLowerCase().includes(q)||String(m.year||'').includes(q)||(m.genre||[]).some(g=>g.toLowerCase().includes(q))):[...kodiMoviesCache];
  renderKodiMovieList(kodiMoviesFiltered);
}

function tmdbGenreName(id) {
  return {28:'Action',12:'Abenteuer',16:'Animation',35:'Komödie',80:'Krimi',99:'Dokumentation',18:'Drama',10751:'Familie',14:'Fantasy',36:'Geschichte',27:'Horror',10402:'Musik',9648:'Mystery',10749:'Romanze',878:'Science-Fiction',53:'Thriller',10752:'Kriegsfilm',37:'Western'}[id]||'';
}

// ─── AUTOCOMPLETE ────────────────────────────────────────────
let autoTimer   = null;
let autoIndex   = -1;
let autoResults = [];

function autocomplete(q, type) {
  const inputId = type === 'movie' ? 'search-input' : 'series-search-input';
  const input   = document.getElementById(inputId);
  clearTimeout(autoTimer);
  autoIndex = -1;

  if (q.length < 2) { closeAutocomplete(type); return; }

  autoTimer = setTimeout(() => doAutocomplete(q, type, input), 350);
}

async function doAutocomplete(q, type, input) {
  if (!settings.tmdb_key || !input) return;

  // Backdrop – alles darunter abdecken
  let backdrop = document.getElementById('autocomplete-backdrop');
  if (!backdrop) {
    backdrop = document.createElement('div');
    backdrop.id = 'autocomplete-backdrop';
    backdrop.style.cssText = 'position:fixed;inset:0;z-index:9997;background:transparent';
    backdrop.onclick = () => { closeAutocomplete('movie'); closeAutocomplete('tv'); };
    document.body.appendChild(backdrop);
  }
  backdrop.style.display = 'block';
  document.body.classList.add('autocomplete-open');

  // Dropdown am body
  let drop = document.getElementById('autocomplete-' + type);
  if (!drop) {
    drop = document.createElement('div');
    drop.id        = 'autocomplete-' + type;
    drop.className = 'autocomplete-dropdown';
    document.body.appendChild(drop);
  }

  // Wrapper-Div (flex:1) als Referenz für Breite und Position
  const wrapper  = input.parentElement;
  const rect     = wrapper ? wrapper.getBoundingClientRect() : input.getBoundingClientRect();
  const maxH     = Math.min(400, window.innerHeight - rect.bottom - 20);
  drop.style.cssText = `
    position:fixed;
    top:${rect.bottom+2}px;
    left:${rect.left}px;
    width:${rect.width}px;
    max-height:${maxH}px;
    z-index:99999;
    display:block;
    overflow-y:auto;
    overflow-x:hidden;
  `;
  drop.innerHTML = '<div class="autocomplete-loading"><div class="spinner"></div> Suche...</div>';

  const endpoint = type === 'movie' ? '/search/movie' : '/search/tv';
  const data = await tmdbFetch(endpoint, `&query=${encodeURIComponent(q)}&include_adult=false`);

  if (!data?.results?.length) {
    drop.innerHTML = '<div class="autocomplete-loading" style="color:var(--text3)">Keine Ergebnisse</div>';
    return;
  }

  autoResults = data.results.slice(0, 8);
  renderAutocomplete(type, autoResults, rect);
}

function renderAutocomplete(type, results, rect) {
  let drop = document.getElementById('autocomplete-' + type);
  if (!drop) { drop = document.createElement('div'); drop.id='autocomplete-'+type; drop.className='autocomplete-dropdown'; document.body.appendChild(drop); }
  if (rect) { drop.style.top=rect.bottom+6+'px'; drop.style.left=rect.left+'px'; drop.style.width=rect.width+'px'; }

  drop.innerHTML = results.map((m, i) => {
    const title  = m.title || m.name || '';
    const year   = (m.release_date || m.first_air_date || '').substring(0, 4);
    const rating = m.vote_average ? '★ ' + (m.vote_average / 2).toFixed(1) : '';
    const poster = m.poster_path
      ? `<img src="${IMG_BASE}${m.poster_path}" loading="lazy">`
      : (type === 'movie' ? '🎬' : '📺');
    const b64 = encodeMovie({
      id: m.id, title, year,
      poster_path:  m.poster_path || '',
      vote_average: m.vote_average || 0,
      overview:     m.overview || '',
      genres:       m.genres || [],
      ...(type === 'tv' ? { number_of_seasons: m.number_of_seasons || 0 } : {})
    });
    const clickFn = type === 'movie'
      ? `closeAutocomplete('${type}');openMovieDetail('${b64}')`
      : `closeAutocomplete('${type}');openSeriesDetail('${b64}')`;
    return `
      <div class="autocomplete-item" id="auto-item-${i}" onclick="${clickFn}">
        <div class="autocomplete-poster">${poster}</div>
        <div style="flex:1;min-width:0">
          <div class="autocomplete-title">${esc(title)}</div>
          <div class="autocomplete-meta">${year}${year && rating ? ' · ' : ''}${rating}</div>
        </div>
      </div>`;
  }).join('');

  drop.style.display = 'block';
}

function handleAutoKey(event, type) {
  const drop = document.getElementById('autocomplete-' + type);
  if (!drop || drop.style.display === 'none') {
    if (event.key === 'Enter') {
      type === 'movie' ? searchMovies() : searchSeries();
    }
    return;
  }

  if (event.key === 'ArrowDown') {
    event.preventDefault();
    autoIndex = Math.min(autoIndex + 1, autoResults.length - 1);
    updateAutoHighlight(type);
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    autoIndex = Math.max(autoIndex - 1, -1);
    updateAutoHighlight(type);
  } else if (event.key === 'Enter') {
    event.preventDefault();
    if (autoIndex >= 0 && autoResults[autoIndex]) {
      const m = autoResults[autoIndex];
      closeAutocomplete(type);
      const b64 = encodeMovie({
        id: m.id, title: m.title || m.name || '',
        year: (m.release_date || m.first_air_date || '').substring(0, 4),
        poster_path: m.poster_path || '', vote_average: m.vote_average || 0,
        overview: m.overview || '', genres: m.genres || []
      });
      if (type === 'movie') openMovieDetail(b64);
      else if (typeof openSeriesDetail === 'function') openSeriesDetail(b64);
    } else {
      closeAutocomplete(type);
      type === 'movie' ? searchMovies() : (typeof searchSeries === 'function' && searchSeries());
    }
  } else if (event.key === 'Escape') {
    closeAutocomplete(type);
  }
}

function updateAutoHighlight(type) {
  document.querySelectorAll(`#autocomplete-${type} .autocomplete-item`).forEach((el, i) => {
    el.classList.toggle('active', i === autoIndex);
  });
}

function closeAutocomplete(type) {
  const drop = document.getElementById('autocomplete-' + type);
  if (drop) { drop.style.display = 'none'; drop.innerHTML = ''; }
  // Backdrop nur verstecken wenn beide Dropdowns zu sind
  const other = type === 'movie' ? 'tv' : 'movie';
  const otherDrop = document.getElementById('autocomplete-' + other);
  if (!otherDrop || otherDrop.style.display === 'none') {
    const backdrop = document.getElementById('autocomplete-backdrop');
    if (backdrop) backdrop.style.display = 'none';
    document.body.classList.remove('autocomplete-open');
  }
  autoIndex   = -1;
  autoResults = [];
}

// Klick außerhalb schließt Dropdown
document.addEventListener('click', e => {
  if (!e.target.closest('.autocomplete-dropdown') &&
      !e.target.closest('#search-input') &&
      !e.target.closest('#series-search-input')) {
    closeAutocomplete('movie');
    closeAutocomplete('tv');
  }
});

// ─── TOAST ───────────────────────────────────────────────────
function toast(msg, type='ok') {
  const t=document.getElementById('toast'); t.textContent=msg;
  t.style.borderLeftColor=type==='err'?'var(--red)':type==='warn'?'#E8A240':'var(--gold)';
  t.classList.add('show'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>t.classList.remove('show'),3000);
}

function esc(str) { return String(str||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
