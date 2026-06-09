// ============================================================
//  ReelOra – app.js
//  Vollständige App-Logik: TMDB API, Google Drive OAuth, 
//  Bibliothek, Watchlist, Statistiken, Kodi-Import
// ============================================================

// ─── KONFIGURATION ──────────────────────────────────────────
const TMDB_BASE   = 'https://api.themoviedb.org/3';
const IMG_BASE    = 'https://image.tmdb.org/t/p/w342';
const BACKDROP_BASE = 'https://image.tmdb.org/t/p/w780';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const DRIVE_FILE_NAME = 'reelora_library.json';

// ─── STATE ──────────────────────────────────────────────────
let library    = JSON.parse(localStorage.getItem('reelora_library')   || '[]');
let watchlists = JSON.parse(localStorage.getItem('reelora_watchlists') || JSON.stringify([
  {id:1, name:'Watchlist', items:[], created:Date.now()},
  {id:2, name:'Favoriten', items:[], created:Date.now()}
]));
let settings = JSON.parse(localStorage.getItem('reelora_settings') || JSON.stringify({
  tmdb_key:'', lang:'de-DE', drive_connected:false, drive_account:'',
  google_client_id:'', drive_file_id:''
}));
let currentMovie = null;
let libView      = 'grid';
let libFilter    = 'all';
let importQueue  = [];
let trendingCache = [];   // Cache für Empfehlungen (Trending)
let searchCache   = [];   // Cache für Suchergebnisse
// driveToken entfernt – Auth läuft über Vercel httpOnly Cookie
let toastTimer   = null;

// ─── INIT ────────────────────────────────────────────────────
window.addEventListener('load', () => {
  // Einstellungen laden
  if (settings.tmdb_key) {
    document.getElementById('tmdb-key-input').value = settings.tmdb_key;
    document.getElementById('api-status-row').style.display = 'flex';
  }
  if (settings.google_client_id) {
    document.getElementById('google-client-id-input').value = settings.google_client_id;
  }
  document.getElementById('lang-select').value = settings.lang || 'de-DE';
  updateDriveUI();

  // OAuth wird jetzt über Vercel-Callback in URL-Params gehandhabt (index.html init)

  renderTrending();
  renderRecentArchive();
  renderLibrary();
  renderWatchlists();
  renderStats();
});

// ─── DATEN SPEICHERN ─────────────────────────────────────────
function save() {
  localStorage.setItem('reelora_library',    JSON.stringify(library));
  localStorage.setItem('reelora_watchlists', JSON.stringify(watchlists));
  localStorage.setItem('reelora_settings',   JSON.stringify(settings));
  if (driveToken && settings.drive_connected &&
      document.getElementById('auto-sync-toggle')?.classList.contains('on')) {
    driveSync();
  }
}

// ─── NAVIGATION ──────────────────────────────────────────────
function showPage(name, btn) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  if (btn) btn.classList.add('active');
  if (name === 'statistiken') renderStats();
  if (name === 'bibliothek')  renderLibrary();
  if (name === 'watchlist')   renderWatchlists();
  if (name === 'serien' && typeof initSerienPage === 'function') initSerienPage();
}

// ─── TMDB API ────────────────────────────────────────────────
async function tmdbFetch(endpoint, params = '') {
  const key = settings.tmdb_key;
  if (!key) { toast('⚠ Bitte zuerst TMDB API Key eintragen', 'warn'); return null; }
  try {
    const lang = settings.lang || 'de-DE';
    const url  = `${TMDB_BASE}${endpoint}?api_key=${key}&language=${lang}${params}`;
    const res  = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } catch (e) {
    toast('TMDB Fehler: ' + e.message, 'err');
    return null;
  }
}

async function renderTrending() {
  const data = await tmdbFetch('/trending/movie/week');
  if (!data) { renderSampleGrid('trending-grid'); return; }
  trendingCache = data.results.slice(0, 12);
  renderDiscoverGrid();
}

function renderDiscoverGrid() {
  // Filtert archivierte und in Watchlist enthaltene Filme heraus
  const watchlistIds = new Set(watchlists.flatMap(wl => wl.items.map(i => i.id)));
  const archivedIds  = new Set(library.map(l => l.tmdb_id));
  const visible = trendingCache.filter(m => !archivedIds.has(m.id) && !watchlistIds.has(m.id));
  if (!visible.length) {
    const grid = document.getElementById('trending-grid');
    if (grid) grid.innerHTML = '<div style="color:var(--text3);font-size:13px;grid-column:1/-1;padding:10px 0">Alle Empfehlungen wurden bereits archiviert oder zur Watchlist hinzugefügt 🎉</div>';
    return;
  }
  renderMovieGrid('trending-grid', visible);
}

async function renderRecentArchive() {
  const recent = [...library].sort((a, b) => b.added - a.added).slice(0, 8);
  if (!recent.length) {
    document.getElementById('recent-archive-grid').innerHTML =
      '<div style="color:var(--text3);font-size:13px;grid-column:1/-1;padding:10px 0">Noch keine Filme archiviert</div>';
    return;
  }
  renderMovieGrid('recent-archive-grid', recent, true);
}

function renderMovieGrid(containerId, movies, isLocal = false) {
  const grid = document.getElementById(containerId);
  if (!grid) return;
  grid.innerHTML = movies.map(m => {
    const id       = m.tmdb_id || m.id;
    const title    = m.title   || m.name  || 'Unbekannt';
    const year     = (m.release_date || m.year || '').toString().substring(0, 4);
    const rating   = m.vote_average ? (m.vote_average / 2).toFixed(1) : (m.rating || '');
    const poster   = m.poster_path
      ? `<img src="${IMG_BASE}${m.poster_path}" alt="${esc(title)}" loading="lazy">`
      : `<div class="movie-poster-placeholder"><div style="font-size:32px">🎬</div></div>`;
    const archived = library.some(l => l.tmdb_id === id);
    const mData    = JSON.stringify({id, title, year, poster_path: m.poster_path||'',
                       vote_average: m.vote_average||0, overview: m.overview||'', genres: m.genres||[]})
                       .replace(/"/g, '&quot;');
    return `
      <div class="movie-card" onclick="openMovieDetail('${btoa(unescape(encodeURIComponent(JSON.stringify({id,title,year,poster_path:m.poster_path||'',vote_average:m.vote_average||0,overview:m.overview||'',genres:m.genres||[]}))))}')">
        <div class="movie-poster">${poster}
          <div class="movie-actions">
            <button class="action-btn" onclick="event.stopPropagation();quickArchive(${id},'${esc(title)}')" title="Archivieren">${archived ? '✓' : '+'}</button>
            <button class="action-btn" onclick="event.stopPropagation();addToWatchlistById(${id},'${esc(title)}')" title="Watchlist">🔖</button>
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

function renderSampleGrid(containerId) {
  const samples = [
    {id:157336, title:'Interstellar',       year:'2014', vote_average:8.4, poster_path:''},
    {id:27205,  title:'Inception',          year:'2010', vote_average:8.8, poster_path:''},
    {id:155,    title:'The Dark Knight',    year:'2008', vote_average:9.0, poster_path:''},
    {id:693134, title:'Dune: Part Two',     year:'2024', vote_average:8.2, poster_path:''},
    {id:872585, title:'Oppenheimer',        year:'2023', vote_average:8.6, poster_path:''},
    {id:238,    title:'The Godfather',      year:'1972', vote_average:9.2, poster_path:''},
  ];
  renderMovieGrid(containerId, samples);
}

// ─── SUCHE ───────────────────────────────────────────────────
async function searchMovies() {
  const q = document.getElementById('search-input').value.trim();
  if (!q) return;
  const loading = document.getElementById('search-loading');
  loading.classList.add('visible');
  document.getElementById('search-results-section').style.display = 'none';
  const data = await tmdbFetch('/search/movie', `&query=${encodeURIComponent(q)}&include_adult=false`);
  loading.classList.remove('visible');
  if (!data || !data.results.length) { toast('Keine Ergebnisse gefunden'); return; }
  searchCache = data.results.slice(0, 15);
  document.getElementById('search-results-section').style.display = 'block';
  document.getElementById('search-results-title').textContent = `SUCHERGEBNISSE (${data.results.length})`;
  renderSearchResults();
}

function renderSearchResults() {
  const watchlistIds = new Set(watchlists.flatMap(wl => wl.items.map(i => i.id)));
  const archivedIds  = new Set(library.map(l => l.tmdb_id));
  const visible = searchCache.filter(m => !archivedIds.has(m.id) && !watchlistIds.has(m.id));
  const total   = searchCache.length;
  const hidden  = total - visible.length;
  const titleEl = document.getElementById('search-results-title');
  if (titleEl) titleEl.textContent = hidden > 0
    ? `SUCHERGEBNISSE (${visible.length} von ${total} · ${hidden} bereits archiviert)`
    : `SUCHERGEBNISSE (${total})`;
  if (!visible.length) {
    const grid = document.getElementById('search-results');
    if (grid) grid.innerHTML = '<div style="color:var(--text3);font-size:13px;grid-column:1/-1;padding:10px 0">Alle Ergebnisse bereits archiviert oder in Watchlist</div>';
    return;
  }
  renderMovieGrid('search-results', visible);

}

const genreMap = {action:28, drama:18, scifi:878, thriller:53, horror:27, animation:16};

async function setFilter(f, btn) {
  document.querySelectorAll('#filter-row .filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  if (f === 'all') { renderTrending(); return; }
  const data = await tmdbFetch('/discover/movie', `&with_genres=${genreMap[f]}&sort_by=popularity.desc`);
  if (data) {
    trendingCache = data.results.slice(0, 12);
    renderDiscoverGrid();
  }
}

// ─── FILM DETAIL MODAL ────────────────────────────────────────
function openMovieDetail(b64) {
  let movie;
  try { movie = JSON.parse(decodeURIComponent(escape(atob(b64)))); }
  catch { return; }
  currentMovie = movie;
  const existing = library.find(l => l.tmdb_id === movie.id);

  document.getElementById('modal-title').textContent    = movie.title;
  document.getElementById('modal-overview').textContent = movie.overview || 'Keine Beschreibung verfügbar.';

  const meta = document.getElementById('modal-meta');
  meta.innerHTML = `<span class="modal-meta-item">${movie.year}</span>
    <span class="modal-meta-item" style="color:var(--border2)">•</span>
    <span class="modal-meta-item">★ ${((movie.vote_average||0)/2).toFixed(1)}/5</span>`;

  const img = document.getElementById('modal-backdrop-img');
  if (movie.poster_path) { img.src = `${BACKDROP_BASE}${movie.poster_path}`; img.style.display = 'block'; }
  else { img.style.display = 'none'; }

  const myRating = existing?.rating || 0;
  document.getElementById('modal-stars').innerHTML =
    [1,2,3,4,5].map(i => `<button class="star-btn ${i<=myRating?'active':''}" onclick="setRating(${i})" data-val="${i}">★</button>`).join('');

  document.getElementById('modal-note').value = existing?.note || '';
  renderModalActions();

  if (settings.tmdb_key) loadFullDetails(movie.id);
  document.getElementById('movie-modal').classList.add('open');
}

function renderModalActions() {
  const isArchived = library.some(l => l.tmdb_id === currentMovie?.id);
  const deleteBtn = isArchived
    ? `<button class="btn-outline" onclick="removeFromLibrary('${currentMovie.id}')" style="border-color:var(--red);color:var(--red)">🗑 Löschen</button>`
    : `<button class="btn-outline" style="opacity:0.35;cursor:default;pointer-events:none" title="Zuerst archivieren">🗑 Löschen</button>`;
  document.getElementById('modal-actions').innerHTML =
    `<button class="btn-gold" onclick="archiveCurrentMovie()">${isArchived ? '✓ Archiviert' : '+ Archivieren'}</button>
    <button class="btn-outline" onclick="addCurrentToWatchlist()">🔖 Watchlist</button>
    ${deleteBtn}`;
}

async function loadFullDetails(id) {
  const data = await tmdbFetch(`/movie/${id}`, '&append_to_response=credits');
  if (!data) return;
  currentMovie = {...currentMovie, ...data};
  const meta    = document.getElementById('modal-meta');
  const genres  = data.genres?.slice(0, 3).map(g => `<span class="tag gold">${g.name}</span>`).join('') || '';
  const runtime = data.runtime ? `<span class="modal-meta-item">${Math.floor(data.runtime/60)}h ${data.runtime%60}m</span><span class="modal-meta-item" style="color:var(--border2)">•</span>` : '';
  meta.innerHTML += `<span class="modal-meta-item" style="color:var(--border2)">•</span>${runtime}<span class="modal-meta-item">${genres}</span>`;
}

function setRating(val) {
  document.querySelectorAll('#modal-stars .star-btn').forEach(b => {
    b.classList.toggle('active', parseInt(b.dataset.val) <= val);
  });
  if (!currentMovie) return;
  const idx = library.findIndex(l => l.tmdb_id === currentMovie.id);
  if (idx >= 0) { library[idx].rating = val; save(); }
  else archiveCurrentMovie(val);
}

function archiveCurrentMovie(forceRating = 0) {
  if (!currentMovie) return;
  let myRating = forceRating;
  document.querySelectorAll('#modal-stars .star-btn').forEach(s => {
    if (s.classList.contains('active')) myRating = parseInt(s.dataset.val);
  });
  const entry = {
    tmdb_id:    currentMovie.id,
    title:      currentMovie.title,
    year:       currentMovie.year,
    poster_path:currentMovie.poster_path || '',
    overview:   currentMovie.overview    || '',
    rating:     myRating,
    note:       document.getElementById('modal-note').value,
    added:      Date.now(),
    genres:     currentMovie.genres?.map(g => g.name) || [],
    runtime:    currentMovie.runtime || 0
  };
  const existing = library.findIndex(l => l.tmdb_id === currentMovie.id);
  if (existing >= 0) library[existing] = {...library[existing], ...entry};
  else library.unshift(entry);
  save();
  toast('✓ "' + currentMovie.title + '" archiviert');
  renderModalActions();
  renderRecentArchive();
  renderLibrary();
  renderDiscoverGrid();
  renderSearchResults();
}

function removeFromLibrary(id, skipConfirm = false) {
  const film = library.find(l => l.tmdb_id === id);
  if (!film) return;
  if (!skipConfirm) {
    showDeleteConfirm(
      `"${film.title}" wirklich löschen?`,
      'Der Film wird aus deiner Bibliothek entfernt.',
      () => { removeFromLibrary(id, true); }
    );
    return;
  }
  library = library.filter(l => l.tmdb_id !== id);
  watchlists.forEach(wl => { wl.items = wl.items.filter(i => i.id !== id); });
  save();
  toast('🗑 "' + film.title + '" gelöscht');
  closeModal();
  renderLibrary();
  renderRecentArchive();
  renderStats();
}

// ─── MEHRFACH-LÖSCHUNG ────────────────────────────────────────
let selectedForDelete = new Set();
let deleteMode = false;

function toggleDeleteMode() {
  deleteMode = !deleteMode;
  selectedForDelete.clear();
  renderLibrary();
  const btn = document.getElementById('delete-mode-btn');
  if (btn) {
    btn.textContent       = deleteMode ? '✕ Abbrechen' : '🗑 Auswählen';
    btn.style.borderColor = deleteMode ? 'var(--red)' : '';
    btn.style.color       = deleteMode ? 'var(--red)' : '';
  }
  const bulkBar = document.getElementById('bulk-delete-bar');
  if (bulkBar) bulkBar.style.display = deleteMode ? 'flex' : 'none';
}

function toggleSelectFilm(id, evt) {
  evt.stopPropagation();
  if (selectedForDelete.has(id)) selectedForDelete.delete(id);
  else selectedForDelete.add(id);
  updateBulkBar();
  const card = document.getElementById('film-card-' + id);
  if (card) card.classList.toggle('selected-for-delete', selectedForDelete.has(id));
}

function updateBulkBar() {
  const count = selectedForDelete.size;
  const label = document.getElementById('bulk-delete-label');
  if (label) label.textContent = count === 0 ? 'Filme zum Löschen auswählen' : `${count} Film${count !== 1 ? 'e' : ''} ausgewählt`;
  const btn = document.getElementById('bulk-delete-confirm-btn');
  if (btn) btn.style.display = count > 0 ? 'inline-block' : 'none';
  const selAll = document.getElementById('select-all-btn');
  if (selAll) selAll.textContent = selectedForDelete.size >= library.length ? 'Alle abwählen' : 'Alle auswählen';
}

function selectAllFilms() {
  const visibleIds = Array.from(document.querySelectorAll('[id^="film-card-"]'))
    .map(el => el.id.replace('film-card-', ''));
  const allSelected = visibleIds.every(id => selectedForDelete.has(id));
  if (allSelected) {
    visibleIds.forEach(id => selectedForDelete.delete(id));
  } else {
    visibleIds.forEach(id => selectedForDelete.add(id));
  }
  renderLibrary();
  updateBulkBar();
}

function bulkDeleteSelected() {
  if (!selectedForDelete.size) return;
  const count = selectedForDelete.size;
  showDeleteConfirm(
    `${count} Film${count !== 1 ? 'e' : ''} löschen?`,
    'Diese Filme werden unwiderruflich aus deiner Bibliothek entfernt.',
    () => {
      library = library.filter(f => !selectedForDelete.has(f.tmdb_id));
      watchlists.forEach(wl => { wl.items = wl.items.filter(i => !selectedForDelete.has(i.id)); });
      const deleted = count;
      selectedForDelete.clear();
      deleteMode = false;
      save();
      toast(`🗑 ${deleted} Film${deleted !== 1 ? 'e' : ''} gelöscht`);
      renderLibrary();
      renderStats();
      renderRecentArchive();
    }
  );
}

// ─── BESTÄTIGUNGS-DIALOG ─────────────────────────────────────
function showDeleteConfirm(title, subtitle, onConfirm) {
  const existing = document.getElementById('delete-confirm-dialog');
  if (existing) existing.remove();
  const overlay = document.createElement('div');
  overlay.id = 'delete-confirm-dialog';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:400;display:flex;align-items:center;justify-content:center;padding:20px';
  overlay.innerHTML = `
    <div style="background:var(--bg2);border:1px solid var(--border2);border-radius:16px;padding:28px;max-width:400px;width:100%;text-align:center">
      <div style="font-size:36px;margin-bottom:12px">🗑</div>
      <div style="font-family:'Cinzel',serif;font-size:16px;color:var(--text);margin-bottom:8px;letter-spacing:1px">${title}</div>
      <div style="font-size:13px;color:var(--text2);margin-bottom:24px;line-height:1.5">${subtitle}</div>
      <div style="display:flex;gap:12px;justify-content:center">
        <button onclick="document.getElementById('delete-confirm-dialog').remove()"
          style="padding:10px 24px;border-radius:8px;border:1px solid var(--border2);background:transparent;color:var(--text2);font-family:'Jost',sans-serif;font-size:14px;cursor:pointer">
          Abbrechen
        </button>
        <button id="delete-confirm-ok"
          style="padding:10px 24px;border-radius:8px;border:1px solid var(--red);background:rgba(224,82,82,0.12);color:var(--red);font-family:'Cinzel',serif;font-size:13px;letter-spacing:1px;cursor:pointer;font-weight:600">
          LÖSCHEN
        </button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  document.getElementById('delete-confirm-ok').onclick = () => { overlay.remove(); onConfirm(); };
  overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
}

function closeModal() {
  document.getElementById('movie-modal').classList.remove('open');
  currentMovie = null;
}

function quickArchive(id, title) {
  if (library.some(l => l.tmdb_id === id)) { toast('"' + title + '" bereits archiviert'); return; }
  library.unshift({tmdb_id:id, title, year:'', poster_path:'', overview:'', rating:0, note:'', added:Date.now(), genres:[], runtime:0});
  save();
  toast('✓ "' + title + '" archiviert');
  renderLibrary();
  renderRecentArchive();
  renderDiscoverGrid();
  renderSearchResults();
}

// ─── WATCHLIST ───────────────────────────────────────────────
function addToWatchlistById(id, title) {
  if (!watchlists.length) { toast('Keine Watchlist vorhanden'); return; }
  const wl = watchlists[0];
  if (wl.items.some(i => i.id === id)) { toast('Bereits in Watchlist'); return; }
  wl.items.push({id, title, added:Date.now(), done:false, poster_path:'', year:'', rating:0});
  save();
  toast('🔖 "' + title + '" zur Watchlist hinzugefügt');
  renderWatchlists();
  renderDiscoverGrid();
  renderSearchResults();
}

function addCurrentToWatchlist() {
  if (currentMovie) addToWatchlistById(currentMovie.id, currentMovie.title);
}

function toggleNewListForm() {
  document.getElementById('new-list-form').classList.toggle('open');
}

function createNewList() {
  const name = document.getElementById('new-list-name').value.trim();
  if (!name) return;
  watchlists.push({id:Date.now(), name, items:[], created:Date.now()});
  save();
  renderWatchlists();
  document.getElementById('new-list-name').value = '';
  document.getElementById('new-list-form').classList.remove('open');
  toast('✓ Liste "' + name + '" erstellt');
}

function renderWatchlists() {
  const c = document.getElementById('watchlist-container');
  if (!watchlists.length) {
    c.innerHTML = `<div class="empty-state"><div class="empty-icon">🔖</div><div class="empty-title">KEINE LISTEN</div><div class="empty-sub">Erstelle eine neue Liste</div></div>`;
    return;
  }
  c.innerHTML = watchlists.map(wl => `
    <div class="list-section">
      <div class="list-header">
        <div style="display:flex;align-items:center;gap:10px">
          <div class="section-title" style="margin:0">${esc(wl.name)}</div>
          <span style="font-size:12px;color:var(--text2)">${wl.items.length} Filme</span>
        </div>
        <button class="btn-outline" style="font-size:11px;padding:5px 10px" onclick="deleteList(${wl.id})">✕ Liste löschen</button>
      </div>
      <div style="background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:0 16px">
        ${!wl.items.length ? '<div style="padding:20px;text-align:center;color:var(--text3);font-size:13px">Noch keine Filme</div>' : ''}
        ${wl.items.map((item, i) => `
          <div class="wl-item">
            <div class="wl-num">${i+1}</div>
            <div class="wl-poster">${item.poster_path ? `<img src="${IMG_BASE}${item.poster_path}" loading="lazy">` : '🎬'}</div>
            <div class="wl-info">
              <div class="wl-title">${esc(item.title)}</div>
              <div class="wl-meta">${item.year || ''}</div>
            </div>
            <button class="wl-check ${item.done?'done':''}" onclick="toggleWLItem(${wl.id},${item.id})">${item.done?'✓':'○'}</button>
            <button class="action-btn" onclick="removeFromWL(${wl.id},${item.id})" style="color:var(--red)">✕</button>
          </div>`).join('')}
      </div>
    </div>`).join('');
}

function toggleWLItem(listId, itemId) {
  const wl   = watchlists.find(w => w.id === listId);
  const item = wl?.items.find(i => i.id === itemId);
  if (!item) return;
  item.done = !item.done;
  save(); renderWatchlists();
}

function removeFromWL(listId, itemId) {
  const wl = watchlists.find(w => w.id === listId);
  if (!wl) return;
  wl.items = wl.items.filter(i => i.id !== itemId);
  save(); renderWatchlists();
}

function deleteList(id) {
  watchlists = watchlists.filter(w => w.id !== id);
  save(); renderWatchlists();
  toast('Liste gelöscht');
}

// ─── BIBLIOTHEK ──────────────────────────────────────────────
function setLibView(v) {
  libView = v;
  document.getElementById('view-grid-btn').classList.toggle('active', v === 'grid');
  document.getElementById('view-list-btn').classList.toggle('active', v === 'list');
  renderLibrary();
}

function setLibFilter(f, btn) {
  libFilter = f;
  document.querySelectorAll('#lib-filter-row .filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderLibrary();
}

function renderLibrary() {
  const container = document.getElementById('library-container');
  const sort      = document.getElementById('sort-select')?.value || 'added';
  const search    = (document.getElementById('lib-search')?.value || '').toLowerCase();
  let   films     = [...library];

  if (search)                    films = films.filter(f => (f.title||'').toLowerCase().includes(search) || (f.year||'').includes(search));
  if (libFilter === 'gesehen')   films = films.filter(f => f.rating > 0);
  if (libFilter === 'favoriten') films = films.filter(f => f.rating >= 5);

  if (sort === 'rating')     films.sort((a,b) => b.rating - a.rating);
  else if (sort === 'year')  films.sort((a,b) => (b.year||0) - (a.year||0));
  else if (sort === 'title') films.sort((a,b) => (a.title||'').localeCompare(b.title||''));
  else                       films.sort((a,b) => b.added - a.added);

  // Bulk-Delete-Bar
  const bulkBar = document.getElementById('bulk-delete-bar');
  if (bulkBar) bulkBar.style.display = deleteMode ? 'flex' : 'none';

  if (!films.length) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">🎬</div><div class="empty-title">BIBLIOTHEK LEER</div><div class="empty-sub">Suche nach Filmen und archiviere sie</div></div>`;
    return;
  }

  if (libView === 'grid') {
    container.innerHTML = `<div class="movie-grid">${films.map(m => {
      const isSelected = selectedForDelete.has(m.tmdb_id);
      const poster = m.poster_path
        ? `<img src="${IMG_BASE}${m.poster_path}" alt="${esc(m.title)}" loading="lazy">`
        : '<div class="movie-poster-placeholder"><div style="font-size:28px">🎬</div></div>';
      const stars = m.rating ? '★'.repeat(m.rating) + '☆'.repeat(5 - m.rating) : '';
      const b64   = btoa(unescape(encodeURIComponent(JSON.stringify({id:m.tmdb_id,title:m.title,year:m.year,poster_path:m.poster_path,vote_average:(m.rating||0)*2,overview:m.overview,genres:[]}))));
      const clickHandler = deleteMode
        ? `onclick="toggleSelectFilm('${m.tmdb_id}', event)"`
        : `onclick="openMovieDetail('${b64}')"`;
      return `<div class="movie-card ${isSelected ? 'selected-for-delete' : ''}" id="film-card-${m.tmdb_id}" ${clickHandler}>
        <div class="movie-poster">${poster}
          ${deleteMode
            ? `<div class="delete-select-overlay">${isSelected ? '<div class="delete-check">✓</div>' : '<div class="delete-check-empty"></div>'}</div>`
            : `<div class="movie-actions">
                <button class="action-btn" onclick="event.stopPropagation();removeFromLibrary('${m.tmdb_id}')" style="color:var(--red)" title="Löschen">🗑</button>
               </div>`
          }
          ${!deleteMode ? '<div class="badge-archived">✓</div>' : ''}
        </div>
        <div class="movie-info">
          <div class="movie-title">${esc(m.title)}</div>
          <div class="movie-meta">${m.year}</div>
          ${stars ? `<div class="movie-rating" style="font-size:10px">${stars}</div>` : ''}
        </div>
      </div>`;
    }).join('')}</div>`;
  } else {
    container.innerHTML = `<div class="lib-list">${films.map(m => {
      const isSelected = selectedForDelete.has(m.tmdb_id);
      const poster = m.poster_path ? `<img src="${IMG_BASE}${m.poster_path}" alt="${esc(m.title)}" loading="lazy">` : '';
      const tags   = (m.genres||[]).slice(0,3).map(g => `<span class="tag">${g}</span>`).join('');
      const b64    = btoa(unescape(encodeURIComponent(JSON.stringify({id:m.tmdb_id,title:m.title,year:m.year,poster_path:m.poster_path,vote_average:(m.rating||0)*2,overview:m.overview,genres:[]}))));
      const clickHandler = deleteMode
        ? `onclick="toggleSelectFilm('${m.tmdb_id}', event)"`
        : `onclick="openMovieDetail('${b64}')"`;
      return `<div class="lib-item ${isSelected ? 'selected-for-delete' : ''}" id="film-card-${m.tmdb_id}" ${clickHandler}>
        ${deleteMode ? `<div style="width:24px;height:24px;border-radius:50%;border:2px solid ${isSelected?'var(--red)':'var(--border2)'};background:${isSelected?'rgba(224,82,82,0.2)':'transparent'};display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:13px;color:var(--red)">${isSelected?'✓':''}</div>` : ''}
        <div class="lib-poster">${poster}</div>
        <div class="lib-info">
          <div class="lib-title">${esc(m.title)}</div>
          <div class="lib-meta">${m.year}${m.runtime ? ' · '+Math.floor(m.runtime/60)+'h '+m.runtime%60+'m' : ''}</div>
          <div class="lib-tags">${tags}${m.note?'<span class="tag gold">📝 Notiz</span>':''}</div>
        </div>
        ${m.rating ? `<div class="lib-rating">★ ${m.rating}</div>` : '<div class="lib-rating" style="color:var(--text3);font-size:13px">—</div>'}
        ${!deleteMode ? `<div class="lib-actions"><button class="action-btn" onclick="event.stopPropagation();removeFromLibrary('${m.tmdb_id}')" style="color:var(--red)" title="Löschen">🗑</button></div>` : ''}
      </div>`;
    }).join('')}</div>`;
  }
  if (deleteMode) setTimeout(updateBulkBar, 0);
}

// ─── STATISTIKEN ─────────────────────────────────────────────
function renderStats() {
  const total      = library.length;
  const rated      = library.filter(f => f.rating > 0).length;
  const avgRating  = rated ? (library.reduce((s,f) => s+(f.rating||0), 0)/rated).toFixed(1) : '—';
  const totalMin   = library.reduce((s,f) => s+(f.runtime||0), 0);
  const totalHours = Math.floor(totalMin/60);

  const totalSeries    = (typeof seriesLibrary !== 'undefined') ? seriesLibrary.length : 0;
  const watchingSeries = (typeof seriesLibrary !== 'undefined') ? seriesLibrary.filter(s=>s.status==='watching').length : 0;
  document.getElementById('stats-cards').innerHTML = [
    {val:total,                   label:'Archivierte Filme',   sub:''},
    {val:avgRating,               label:'Ø Bewertung',         sub:'von 5 Sternen'},
    {val:totalHours+'h',          label:'Geschaute Zeit',      sub:Math.floor(totalHours/24)+' Tage'},
    {val:watchlists.reduce((s,w)=>s+w.items.length,0), label:'Watchlist-Einträge', sub:watchlists.length+' Listen'},
    {val:totalSeries,             label:'Serien archiviert',   sub:''},
    {val:watchingSeries,          label:'Serien am Schauen',   sub:''},
  ].map(s => `<div class="stat-card"><div class="stat-val">${s.val}</div><div class="stat-label">${s.label}</div>${s.sub?`<div class="stat-sub">${s.sub}</div>`:''}</div>`).join('');

  // Filme pro Monat (letzte 6 Monate)
  const now = new Date();
  const months = ['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'];
  const mc = Array(6).fill(0);
  library.forEach(f => {
    const d = new Date(f.added);
    const diff = (now.getFullYear()-d.getFullYear())*12 + (now.getMonth()-d.getMonth());
    if (diff >= 0 && diff < 6) mc[5-diff]++;
  });
  const maxM = Math.max(...mc, 1);
  document.getElementById('monthly-chart').innerHTML = mc.map((c, i) => {
    const mo = new Date(now.getFullYear(), now.getMonth()-(5-i), 1);
    return `<div class="bar-col"><div class="bar-wrap"><div class="bar" style="height:${Math.round(c/maxM*100)}%"></div></div><div class="bar-label">${months[mo.getMonth()]}</div></div>`;
  }).join('');

  // Genre-Chart
  const genreCounts = {};
  library.forEach(f => (f.genres||[]).forEach(g => { genreCounts[g] = (genreCounts[g]||0)+1; }));
  const topGenres = Object.entries(genreCounts).sort((a,b) => b[1]-a[1]).slice(0,6);
  const maxG = topGenres.length ? topGenres[0][1] : 1;
  document.getElementById('genre-chart').innerHTML = topGenres.length
    ? topGenres.map(([g,c]) => `
        <div class="genre-row">
          <div class="genre-name">${g}</div>
          <div class="genre-bar-wrap"><div class="genre-bar" style="width:${Math.round(c/maxG*100)}%"></div></div>
          <div class="genre-pct">${Math.round(c/Math.max(total,1)*100)}%</div>
        </div>`).join('')
    : '<div style="color:var(--text3);font-size:13px;padding:10px 0">Noch keine Daten</div>';

  // Jahrzehnt-Chart
  const decades = {};
  library.forEach(f => {
    if (f.year) {
      const d = Math.floor(parseInt(f.year)/10)*10;
      if (!decades[d]) decades[d] = {sum:0,count:0};
      decades[d].sum   += (f.rating||0);
      decades[d].count++;
    }
  });
  const decArr = Object.entries(decades).sort((a,b) => a[0]-b[0]);
  const maxD   = Math.max(...decArr.map(([,v]) => v.count), 1);
  document.getElementById('decade-chart').innerHTML = decArr.length
    ? decArr.map(([d,v]) => `<div class="bar-col"><div class="bar-wrap"><div class="bar" style="height:${Math.round(v.count/maxD*100)}%"></div></div><div class="bar-label">${d}er</div></div>`).join('')
    : '<div style="color:var(--text3);font-size:13px;padding:10px 0">Noch keine Daten</div>';

  // Top bewertet
  const topRated = [...library].filter(f => f.rating > 0).sort((a,b) => b.rating-a.rating).slice(0,5);
  document.getElementById('top-rated-list').innerHTML = topRated.map((f,i) => {
    const b64 = btoa(unescape(encodeURIComponent(JSON.stringify({id:f.tmdb_id,title:f.title,year:f.year,poster_path:f.poster_path,vote_average:(f.rating||0)*2,overview:f.overview,genres:[]}))));
    return `<div class="lib-item" onclick="openMovieDetail('${b64}')">
      <div style="font-family:'Cinzel',serif;font-size:14px;color:var(--text3);width:24px;text-align:center;flex-shrink:0">${i+1}</div>
      <div class="lib-poster">${f.poster_path?`<img src="${IMG_BASE}${f.poster_path}" loading="lazy">`:'🎬'}</div>
      <div class="lib-info"><div class="lib-title">${esc(f.title)}</div><div class="lib-meta">${f.year||''}</div></div>
      <div class="lib-rating">★ ${f.rating}</div>
    </div>`;
  }).join('') || '<div class="empty-state" style="padding:30px 20px"><div class="empty-sub">Noch keine bewerteten Filme</div></div>';
}

// ─── KODI IMPORT ─────────────────────────────────────────────
async function handleKodiImport(event) {
  const files = Array.from(event.target.files);
  if (!files.length) return;
  importQueue = [];
  for (const file of files) {
    const text       = await file.text();
    const titleMatch = text.match(/<title>(.*?)<\/title>/i) ||
                       text.match(/"title"\s*:\s*"([^"]+)"/) ||
                       text.match(/^(.+?)(?:\s*\(\d{4}\))?$/m);
    const yearMatch  = text.match(/<year>(\d{4})<\/year>/i) ||
                       text.match(/"year"\s*:\s*(\d{4})/)   ||
                       text.match(/\((\d{4})\)/);
    if (titleMatch) {
      importQueue.push({title:(titleMatch[1]||'').trim(), year:yearMatch?yearMatch[1]:'', status:'wait', source:file.name});
    }
  }
  document.getElementById('import-results').classList.add('visible');
  renderImportQueue();
}

async function manualImport() {
  const input = document.getElementById('manual-import-input').value.trim();
  if (!input) return;
  importQueue = input.split('\n').map(t => t.trim()).filter(Boolean)
    .map(title => ({title, year:'', status:'wait', source:'manuell'}));
  document.getElementById('import-results').classList.add('visible');
  renderImportQueue();
}

function renderImportQueue() {
  document.getElementById('import-items-list').innerHTML = importQueue.map((item, i) => `
    <div class="import-item" id="import-item-${i}">
      <div class="import-status ${item.status}" id="import-status-${i}">${item.status==='ok'?'✓':item.status==='err'?'✕':'…'}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:500;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(item.title)}${item.year?' ('+item.year+')':''}</div>
        <div style="font-size:11px;color:var(--text3)">${item.source}</div>
      </div>
      ${item.tmdb_id ? `<div style="font-size:11px;color:var(--green)">TMDB #${item.tmdb_id}</div>` : ''}
    </div>`).join('');
}

async function confirmImport() {
  if (!settings.tmdb_key) { toast('⚠ TMDB API Key fehlt', 'warn'); return; }
  for (let i = 0; i < importQueue.length; i++) {
    const item = importQueue[i];
    const el   = document.getElementById('import-status-' + i);
    if (el) { el.className='import-status wait'; el.textContent='…'; }
    const data = await tmdbFetch('/search/movie', `&query=${encodeURIComponent(item.title)}&year=${item.year||''}`);
    await new Promise(r => setTimeout(r, 250));
    if (data?.results?.[0]) {
      const m       = data.results[0];
      item.tmdb_id  = m.id;
      item.poster_path = m.poster_path || '';
      item.status   = 'ok';
      if (!library.some(l => l.tmdb_id === m.id)) {
        library.unshift({tmdb_id:m.id, title:m.title, year:(m.release_date||'').substring(0,4),
          poster_path:m.poster_path||'', overview:m.overview||'', rating:0, note:'', added:Date.now(), genres:[], runtime:0});
      }
    } else {
      item.status = 'err';
    }
    if (el) { el.className=`import-status ${item.status}`; el.textContent=item.status==='ok'?'✓':'✕'; }
  }
  save(); renderLibrary(); renderStats();
  const ok = importQueue.filter(i => i.status==='ok').length;
  toast(`✓ ${ok} von ${importQueue.length} Filmen importiert`);
}

function clearImport() {
  importQueue = [];
  document.getElementById('import-results').classList.remove('visible');
  document.getElementById('import-items-list').innerHTML = '';
  document.getElementById('manual-import-input').value = '';
}

// ─── EINSTELLUNGEN ────────────────────────────────────────────
function saveTMDBKey(val) {
  settings.tmdb_key = val.trim();
  save();
  document.getElementById('api-status-row').style.display = val ? 'flex' : 'none';
}

function saveLang(val) { settings.lang = val; save(); }

function saveClientId(val) {
  settings.google_client_id = val.trim();
  save();
}

function saveVercelUrl(val) {
  settings.vercel_url = val.trim().replace(/\/$/, '');
  save();
  // Status sofort prüfen
  if (settings.vercel_url) checkDriveStatus();
}

// ─── GOOGLE DRIVE via VERCEL API ─────────────────────────────
function getApiBase() {
  return (settings.vercel_url || '').replace(/\/$/, '');
}

function connectGoogleDrive() {
  const api = getApiBase();
  if (!api) {
    toast('\u26a0 Bitte zuerst die Vercel-URL in den Einstellungen eintragen', 'warn');
    return;
  }
  window.location.href = api + '/api/auth/login';
}

async function disconnectDrive() {
  const api = getApiBase();
  try { await fetch(api + '/api/auth/status', { method: 'DELETE', credentials: 'include' }); } catch (_) {}
  settings.drive_connected = false;
  settings.drive_account   = '';
  save(); updateDriveUI();
  toast('Google Drive getrennt');
}

async function checkDriveStatus() {
  const api = getApiBase();
  if (!api) return false;
  try {
    const res  = await fetch(api + '/api/auth/status', { credentials: 'include' });
    const data = await res.json();
    if (data.connected && !data.expired) {
      settings.drive_connected = true;
      settings.drive_account   = data.email || '';
      save(); updateDriveUI();
      return true;
    }
  } catch (_) {}
  return false;
}

async function loadFromDrive() {
  const api = getApiBase();
  if (!api || !settings.drive_connected) return;
  try {
    const res  = await fetch(api + '/api/drive/sync', { credentials: 'include' });
    if (res.status === 401) {
      toast('\u26a0 Drive: Bitte neu anmelden', 'warn');
      settings.drive_connected = false; save(); updateDriveUI(); return;
    }
    if (!res.ok) { toast('Drive Fehler: ' + res.status, 'err'); return; }
    const data = await res.json();
    if (!data.exists) {
      toast('\u2601 Drive bereit – Ordner MeineApps/ReelOra wurde angelegt');
      return;
    }
    if (data.library?.length)    library    = data.library;
    if (data.watchlists?.length) watchlists = data.watchlists;
    if (data.seriesLibrary?.length   && typeof seriesLibrary   !== 'undefined') { seriesLibrary   = data.seriesLibrary;   saveSeries(); }
    if (data.seriesWatchlist?.length && typeof seriesWatchlist !== 'undefined') { seriesWatchlist = data.seriesWatchlist; saveSeries(); }
    save();
    renderLibrary(); renderWatchlists(); renderStats(); renderRecentArchive();
    const time = data.lastSync ? new Date(data.lastSync).toLocaleString('de-DE') : '—';
    toast('\u2601 Geladen aus ' + (data.folderPath || 'Drive') + ' (Stand: ' + time + ')');
    // Ordnerpfad in UI anzeigen
    const sub = document.getElementById('drive-account-sub');
    if (sub && data.folderPath) sub.textContent = (settings.drive_account || '') + ' · ' + data.folderPath;
  } catch (e) { toast('Drive Ladefehler: ' + e.message, 'err'); }
}

async function driveSync() {
  const api = getApiBase();
  if (!api || !settings.drive_connected) return;
  try {
    const res = await fetch(api + '/api/drive/sync', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        library, watchlists,
        seriesLibrary:   (typeof seriesLibrary   !== 'undefined') ? seriesLibrary   : [],
        seriesWatchlist: (typeof seriesWatchlist  !== 'undefined') ? seriesWatchlist : [],
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      if (err.error === 'NOT_AUTHENTICATED') {
        toast('\u26a0 Drive-Session abgelaufen – bitte neu anmelden', 'warn');
        settings.drive_connected = false; save(); updateDriveUI();
        return;
      }
      throw new Error(err.error || res.status);
    }
    const now = new Date().toLocaleTimeString('de-DE', {hour:'2-digit',minute:'2-digit'});
    const sub = document.getElementById('last-sync-sub');
    if (sub) sub.textContent = 'Zuletzt synchronisiert: ' + now;
    toast('\u2601 Synchronisiert → MeineApps/ReelOra');
  } catch (e) { toast('Drive Sync Fehler: ' + e.message, 'err'); }
}

async function manualSync() {
  if (!settings.drive_connected) { toast('\u26a0 Google Drive nicht verbunden', 'warn'); return; }
  await driveSync();
}


function updateDriveUI() {
  const badge     = document.getElementById('drive-status-badge');
  const btn       = document.getElementById('drive-connect-btn');
  const indicator = document.getElementById('drive-indicator');
  const syncRow   = document.getElementById('drive-sync-row');
  const manualRow = document.getElementById('drive-manual-row');
  const sub       = document.getElementById('drive-account-sub');
  if (!badge) return;
  if (settings.drive_connected) {
    badge.className   = 'drive-status connected';
    badge.innerHTML   = '<div class="dot green"></div>Verbunden';
    btn.textContent   = 'Trennen';
    btn.onclick       = disconnectDrive;
    indicator.style.color = 'var(--green)';
    if (syncRow)   syncRow.style.display   = 'flex';
    if (manualRow) manualRow.style.display = 'flex';
    if (sub)       sub.textContent = settings.drive_account || 'Verbunden';
  } else {
    badge.className   = 'drive-status disconnected';
    badge.innerHTML   = '<div class="dot gray"></div>Nicht verbunden';
    btn.textContent   = 'Mit Google anmelden';
    btn.onclick       = connectGoogleDrive;
    indicator.style.color = 'var(--text3)';
    if (syncRow)   syncRow.style.display   = 'none';
    if (manualRow) manualRow.style.display = 'none';
    if (sub)       sub.textContent = 'Nicht verbunden';
  }
}

// ─── EXPORT / IMPORT ─────────────────────────────────────────
function exportLibrary() {
  const data = {library, watchlists, exported:new Date().toISOString(), version:'1.0'};
  const blob = new Blob([JSON.stringify(data,null,2)], {type:'application/json'});
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = `reelora_export_${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  toast('✓ Export heruntergeladen');
}

function importBackup(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      if (data.library)    library    = data.library;
      if (data.watchlists) watchlists = data.watchlists;
      save();
      renderLibrary(); renderWatchlists(); renderStats(); renderRecentArchive();
      toast('✓ ' + library.length + ' Filme importiert');
    } catch { toast('⚠ Ungültige Datei', 'err'); }
  };
  reader.readAsText(file);
}

function clearAll() {
  if (!confirm('Wirklich alle Daten löschen? Dies kann nicht rückgängig gemacht werden.')) return;
  library    = [];
  watchlists = [{id:1,name:'Watchlist',items:[],created:Date.now()},{id:2,name:'Favoriten',items:[],created:Date.now()}];
  save();
  renderLibrary(); renderWatchlists(); renderStats(); renderRecentArchive();
  toast('Alle Daten gelöscht');
}

// ─── TOAST ───────────────────────────────────────────────────
function toast(msg, type = 'ok') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.style.borderLeftColor = type==='err'?'var(--red)':type==='warn'?'#E8A240':'var(--gold)';
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
}

// ─── UTILS ───────────────────────────────────────────────────
function esc(str) {
  return String(str||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ============================================================
//  KODI JSON-RPC NETZWERK-IMPORT
// ============================================================

let kodiMoviesCache = [];   // Alle Filme aus Kodi
let kodiMoviesFiltered = []; // Nach Suche gefiltert

// ─── KODI EINSTELLUNGEN LADEN/SPEICHERN ──────────────────────
function saveKodiSettings() {
  // Felder auf Import-Seite und Einstellungs-Seite synchronisieren
  const hostA  = document.getElementById('kodi-host')?.value.trim()         || '';
  const hostB  = document.getElementById('kodi-host-settings')?.value.trim()|| '';
  const portA  = document.getElementById('kodi-port')?.value.trim()         || '8080';
  const portB  = document.getElementById('kodi-port-settings')?.value.trim()|| '8080';
  const userA  = document.getElementById('kodi-user')?.value.trim()         || '';
  const userB  = document.getElementById('kodi-user-settings')?.value.trim()|| '';
  const passA  = document.getElementById('kodi-pass')?.value                || '';
  const passB  = document.getElementById('kodi-pass-settings')?.value       || '';

  settings.kodi_host = hostA || hostB;
  settings.kodi_port = portA || portB;
  settings.kodi_user = userA || userB;
  settings.kodi_pass = passA || passB;
  save();
  syncKodiFields();
}

function syncKodiFields() {
  const h = settings.kodi_host || '';
  const p = settings.kodi_port || '8080';
  const u = settings.kodi_user || '';
  ['kodi-host','kodi-host-settings'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = h;
  });
  ['kodi-port','kodi-port-settings'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = p;
  });
  ['kodi-user','kodi-user-settings'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = u;
  });
}

function loadKodiSettingsIntoFields() {
  syncKodiFields();
  if (settings.kodi_host) {
    document.getElementById('kodi-import-panel').style.display = 'block';
  }
}

// ─── KODI JSON-RPC HILFSFUNKTION ─────────────────────────────
async function kodiRPC(method, params = {}) {
  const host = settings.kodi_host;
  const port = settings.kodi_port || '8080';
  const user = settings.kodi_user;
  const pass = settings.kodi_pass;

  if (!host) throw new Error('Keine Kodi-IP konfiguriert');

  const url     = `http://${host}:${port}/jsonrpc`;
  const headers = { 'Content-Type': 'application/json' };
  if (user) {
    headers['Authorization'] = 'Basic ' + btoa(user + ':' + (pass || ''));
  }

  const body = JSON.stringify({
    jsonrpc: '2.0',
    method,
    params,
    id: Date.now()
  });

  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(url, { method:'POST', headers, body, signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (data.error) throw new Error(data.error.message || 'Kodi RPC Fehler');
    return data.result;
  } catch (e) {
    clearTimeout(timeout);
    if (e.name === 'AbortError') throw new Error('Zeitüberschreitung – Kodi nicht erreichbar');
    throw e;
  }
}

// ─── VERBINDUNG TESTEN ────────────────────────────────────────
async function testKodiConnection() {
  saveKodiSettings();
  const badge = document.getElementById('kodi-conn-badge');
  const sub   = document.getElementById('kodi-conn-sub');
  if (badge) { badge.className='drive-status disconnected'; badge.innerHTML='<div class="dot gray"></div>Verbinde...'; }
  try {
    const result = await kodiRPC('Application.GetProperties', { properties: ['name','version'] });
    const name   = result?.name    || 'Kodi';
    const ver    = result?.version?.major ? `v${result.version.major}.${result.version.minor}` : '';
    if (badge) {
      badge.className = 'drive-status connected';
      badge.innerHTML = '<div class="dot green"></div>Verbunden';
    }
    if (sub) sub.textContent = `${name} ${ver} – Verbindung erfolgreich`;
    // Panel einblenden und Bibliothek laden
    const panel = document.getElementById('kodi-import-panel');
    if (panel) panel.style.display = 'block';
    settings.kodi_connected = true;
    save();
    toast('✓ Kodi verbunden: ' + name + ' ' + ver);
    loadKodiLibrary();
  } catch (e) {
    if (badge) { badge.className='drive-status disconnected'; badge.innerHTML='<div class="dot" style="background:var(--red)"></div>Fehler'; }
    if (sub) sub.textContent = e.message;
    toast('✗ ' + e.message, 'err');
  }
}

// ─── KODI BIBLIOTHEK LADEN ────────────────────────────────────
async function loadKodiLibrary() {
  const statusEl = document.getElementById('kodi-load-status');
  const listEl   = document.getElementById('kodi-movie-list');
  const importBtn = document.getElementById('kodi-import-all-btn');
  if (statusEl) statusEl.classList.add('visible');
  if (listEl)   listEl.innerHTML = '';
  if (importBtn) importBtn.style.display = 'none';

  try {
    const result = await kodiRPC('VideoLibrary.GetMovies', {
      properties: [
        'title','year','rating','playcount','genre','runtime',
        'plot','thumbnail','imdbnumber','originaltitle','dateadded',
        'lastplayed','file','director','cast'
      ],
      limits: { start: 0, end: 10000 },
      sort:   { order: 'ascending', method: 'title' }
    });

    if (statusEl) statusEl.classList.remove('visible');

    const movies = result?.movies || [];
    if (!movies.length) {
      if (listEl) listEl.innerHTML = '<div class="empty-state"><div class="empty-icon">🎬</div><div class="empty-title">KEINE FILME</div><div class="empty-sub">Kodi hat keine Filme in der Bibliothek</div></div>';
      return;
    }

    kodiMoviesCache    = movies;
    kodiMoviesFiltered = movies;
    renderKodiMovieList(movies);
    if (importBtn) importBtn.style.display = 'inline-block';
    toast(`✓ ${movies.length} Filme aus Kodi geladen`);
  } catch (e) {
    if (statusEl) statusEl.classList.remove('visible');
    if (listEl)   listEl.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-title">FEHLER</div><div class="empty-sub">${esc(e.message)}</div></div>`;
    toast('Kodi Ladefehler: ' + e.message, 'err');
  }
}

// ─── KODI FILMLISTE RENDERN ───────────────────────────────────
function renderKodiMovieList(movies) {
  const listEl = document.getElementById('kodi-movie-list');
  if (!listEl) return;

  if (!movies.length) {
    listEl.innerHTML = '<div style="color:var(--text3);font-size:13px;padding:20px 0;text-align:center">Keine Filme gefunden</div>';
    return;
  }

  // Statistik-Zeile
  const alreadyArchived = movies.filter(m => library.some(l =>
    l.title.toLowerCase() === (m.title||'').toLowerCase() ||
    (m.imdbnumber && l.imdb_id === m.imdbnumber)
  )).length;

  listEl.innerHTML = `
    <div style="display:flex;gap:16px;margin-bottom:16px;flex-wrap:wrap">
      <div class="stat-card" style="flex:1;min-width:120px;padding:14px">
        <div class="stat-val" style="font-size:24px">${movies.length}</div>
        <div class="stat-label">Kodi Filme</div>
      </div>
      <div class="stat-card" style="flex:1;min-width:120px;padding:14px">
        <div class="stat-val" style="font-size:24px;color:var(--green)">${alreadyArchived}</div>
        <div class="stat-label">Bereits archiviert</div>
      </div>
      <div class="stat-card" style="flex:1;min-width:120px;padding:14px">
        <div class="stat-val" style="font-size:24px;color:var(--gold)">${movies.length - alreadyArchived}</div>
        <div class="stat-label">Neu zu importieren</div>
      </div>
    </div>
    <div class="lib-list" id="kodi-film-rows">
      ${movies.map(m => renderKodiMovieRow(m)).join('')}
    </div>`;
}

function renderKodiMovieRow(m) {
  const title     = m.title || m.originaltitle || 'Unbekannt';
  const year      = m.year  || '';
  const rating    = m.rating ? (m.rating / 2).toFixed(1) : '';
  const genres    = (m.genre || []).slice(0,3).join(', ');
  const runtime   = m.runtime ? Math.floor(m.runtime/60) + 'h ' + (m.runtime%60) + 'm' : '';
  const watched   = m.playcount > 0;
  const archived  = library.some(l =>
    l.title.toLowerCase() === title.toLowerCase() ||
    (m.imdbnumber && l.imdb_id === m.imdbnumber)
  );
  const thumb     = m.thumbnail && m.thumbnail.startsWith('image://')
    ? '' : (m.thumbnail || '');
  const kodiId    = m.movieid;

  return `
    <div class="lib-item" id="kodi-row-${kodiId}">
      <div class="lib-poster" style="background:var(--bg4)">
        ${thumb ? `<img src="${thumb}" loading="lazy" onerror="this.style.display='none'">` : '🎬'}
      </div>
      <div class="lib-info">
        <div class="lib-title">${esc(title)}</div>
        <div class="lib-meta">${year}${runtime ? ' · ' + runtime : ''}${genres ? ' · ' + genres : ''}</div>
        <div class="lib-tags" style="margin-top:4px">
          ${watched ? '<span class="tag green">✓ Gesehen</span>' : '<span class="tag">Nicht gesehen</span>'}
          ${archived ? '<span class="tag gold">✓ Archiviert</span>' : ''}
          ${m.imdbnumber ? `<span class="tag">IMDb: ${m.imdbnumber}</span>` : ''}
        </div>
      </div>
      ${rating ? `<div class="lib-rating" style="font-size:13px">★ ${rating}</div>` : ''}
      <div class="lib-actions">
        ${archived
          ? `<span style="font-size:11px;color:var(--green);padding:6px">✓</span>`
          : `<button class="btn-outline" style="font-size:11px;padding:6px 12px" onclick="importSingleKodiMovie(${kodiId})">+ Importieren</button>`
        }
      </div>
    </div>`;
}

// ─── EINZELNEN KODI-FILM IMPORTIEREN ─────────────────────────
async function importSingleKodiMovie(kodiId) {
  const movie = kodiMoviesCache.find(m => m.movieid === kodiId);
  if (!movie) return;
  await archiveKodiMovie(movie);
  // Zeile aktualisieren
  const row = document.getElementById('kodi-row-' + kodiId);
  if (row) row.outerHTML = renderKodiMovieRow(movie);
  renderLibrary();
  renderStats();
}

// ─── ALLE KODI FILME IMPORTIEREN ─────────────────────────────
async function importAllKodiMovies() {
  const toImport = kodiMoviesFiltered.filter(m =>
    !library.some(l =>
      l.title.toLowerCase() === (m.title||'').toLowerCase() ||
      (m.imdbnumber && l.imdb_id === m.imdbnumber)
    )
  );
  if (!toImport.length) { toast('Alle Filme bereits archiviert'); return; }

  toast(`Importiere ${toImport.length} Filme...`);
  let count = 0;
  for (const m of toImport) {
    await archiveKodiMovie(m);
    count++;
    if (count % 10 === 0) toast(`${count} / ${toImport.length} importiert...`);
  }
  save();
  renderKodiMovieList(kodiMoviesFiltered);
  renderLibrary();
  renderStats();
  renderRecentArchive();
  toast(`✓ ${count} Filme importiert`);
}

// ─── KODI FILM → REELORA ARCHIV ──────────────────────────────
async function archiveKodiMovie(m) {
  const title   = m.title || m.originaltitle || '';
  const year    = m.year  || '';
  const watched = (m.playcount || 0) > 0;

  // Versuche TMDB-Match für Poster & Metadaten
  let tmdbData  = null;
  let tmdbId    = null;
  let poster    = '';
  let genres    = m.genre || [];
  let overview  = m.plot  || '';
  let runtime   = m.runtime || 0;

  if (settings.tmdb_key && title) {
    try {
      const res = await tmdbFetch('/search/movie',
        `&query=${encodeURIComponent(title)}&year=${year}&include_adult=false`);
      if (res?.results?.[0]) {
        tmdbData = res.results[0];
        tmdbId   = tmdbData.id;
        poster   = tmdbData.poster_path || '';
        if (!overview) overview = tmdbData.overview || '';
        if (!genres.length && tmdbData.genre_ids) {
          genres = tmdbData.genre_ids.map(id => tmdbGenreName(id)).filter(Boolean);
        }
      }
      await new Promise(r => setTimeout(r, 150)); // Rate-limit Schutz
    } catch (_) {}
  }

  // Kodi-Bewertung (0–10) → ReelOra (0–5 Sterne)
  const rating = m.rating ? Math.round(m.rating / 2) : 0;

  const entry = {
    tmdb_id:    tmdbId || ('kodi_' + (m.movieid || Date.now())),
    imdb_id:    m.imdbnumber || '',
    title,
    year:       String(year),
    poster_path: poster,
    overview,
    rating,
    note:       watched ? '▶ In Kodi gesehen' : '',
    added:      Date.now(),
    genres,
    runtime,
    kodi_id:    m.movieid,
    kodi_file:  m.file || '',
    source:     'kodi'
  };

  const existing = library.findIndex(l =>
    l.tmdb_id === entry.tmdb_id ||
    (entry.imdb_id && l.imdb_id === entry.imdb_id) ||
    l.title.toLowerCase() === title.toLowerCase()
  );
  if (existing >= 0) library[existing] = {...library[existing], ...entry};
  else library.unshift(entry);
}

// ─── KODI BIBLIOTHEK FILTERN ──────────────────────────────────
function filterKodiMovies() {
  const q = (document.getElementById('kodi-filter-input')?.value || '').toLowerCase();
  kodiMoviesFiltered = q
    ? kodiMoviesCache.filter(m =>
        (m.title||'').toLowerCase().includes(q) ||
        (m.originaltitle||'').toLowerCase().includes(q) ||
        String(m.year||'').includes(q) ||
        (m.genre||[]).some(g => g.toLowerCase().includes(q))
      )
    : [...kodiMoviesCache];
  renderKodiMovieList(kodiMoviesFiltered);
}

// ─── TMDB GENRE-ID → NAME ─────────────────────────────────────
function tmdbGenreName(id) {
  const map = {
    28:'Action',12:'Abenteuer',16:'Animation',35:'Komödie',80:'Krimi',
    99:'Dokumentation',18:'Drama',10751:'Familie',14:'Fantasy',36:'Geschichte',
    27:'Horror',10402:'Musik',9648:'Mystery',10749:'Romanze',878:'Science-Fiction',
    10770:'TV-Film',53:'Thriller',10752:'Kriegsfilm',37:'Western'
  };
  return map[id] || '';
}

// ─── INIT-ERWEITERUNG FÜR KODI ────────────────────────────────
// An das bestehende window.onload hängen
const _origLoad = window.onload;
window.addEventListener('DOMContentLoaded', () => {
  loadKodiSettingsIntoFields();
});
