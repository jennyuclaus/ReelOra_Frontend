// ============================================================
//  ReelOra – series.js
//  Vollständige Serienfunktion: TMDB TV-API, Staffeln,
//  Episodenverfolgung, Status, Statistiken
// ============================================================

// ─── SERIEN STATE ────────────────────────────────────────────
let seriesLibrary  = JSON.parse(localStorage.getItem('reelora_series')  || '[]');
let seriesWatchlist= JSON.parse(localStorage.getItem('reelora_series_wl')|| '[]');
let trendingSeriesCache = [];
let seriesSearchCache   = [];
let seriesArchiveFilter = 'all';
let currentSeries       = null;

// ─── TMDB TV FETCH ───────────────────────────────────────────
async function tmdbTVFetch(endpoint, params = '') {
  const key  = settings.tmdb_key;
  if (!key) { toast('⚠ Bitte TMDB API Key eintragen', 'warn'); return null; }
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

function saveSeries() {
  localStorage.setItem('reelora_series',   JSON.stringify(seriesLibrary));
  localStorage.setItem('reelora_series_wl',JSON.stringify(seriesWatchlist));
}

// ─── TABS ─────────────────────────────────────────────────────
function showSerienTab(tab, btn) {
  ['entdecken','archiv','watchlist','fortschritt'].forEach(t => {
    const el = document.getElementById('serien-tab-' + t);
    if (el) el.style.display = 'none';
  });
  document.querySelectorAll('.tab-sec').forEach(b => b.classList.remove('active'));
  const active = document.getElementById('serien-tab-' + tab);
  if (active) active.style.display = 'block';
  if (btn) btn.classList.add('active');
  if (tab === 'archiv')      renderSeriesArchive();
  if (tab === 'watchlist')   renderSeriesWatchlist();
  if (tab === 'fortschritt') renderSeriesProgress();
}

// ─── TRENDING SERIEN ─────────────────────────────────────────
async function renderTrendingSeries() {
  const data = await tmdbTVFetch('/trending/tv/week');
  if (!data) { renderSampleSeriesGrid(); return; }
  trendingSeriesCache = data.results.slice(0, 12);
  renderTrendingSeriesGrid();
}

function renderTrendingSeriesGrid() {
  if (!trendingSeriesCache.length) return;
  const wlIds      = new Set(seriesWatchlist.map(s => s.tmdb_id));
  const archiveIds = new Set(seriesLibrary.map(s => s.tmdb_id));
  const visible    = trendingSeriesCache.filter(s => !wlIds.has(s.id) && !archiveIds.has(s.id));
  if (!visible.length) {
    const g = document.getElementById('trending-series-grid');
    if (g) g.innerHTML = '<div style="color:var(--text3);font-size:13px;grid-column:1/-1;padding:10px 0">Alle Empfehlungen bereits archiviert 🎉</div>';
    return;
  }
  renderSeriesGrid('trending-series-grid', visible);
}

function renderSampleSeriesGrid() {
  const samples = [
    {id:1396,   name:'Breaking Bad',      first_air_date:'2008', vote_average:9.5, poster_path:''},
    {id:66732,  name:'Stranger Things',   first_air_date:'2016', vote_average:8.7, poster_path:''},
    {id:1399,   name:'Game of Thrones',   first_air_date:'2011', vote_average:9.3, poster_path:''},
    {id:60735,  name:'The Flash',         first_air_date:'2014', vote_average:7.8, poster_path:''},
    {id:63174,  name:'Lucifer',           first_air_date:'2016', vote_average:8.5, poster_path:''},
    {id:85552,  name:'Euphoria',          first_air_date:'2019', vote_average:8.4, poster_path:''},
  ];
  renderSeriesGrid('trending-series-grid', samples);
}

// ─── SERIE GRID ───────────────────────────────────────────────
function renderSeriesGrid(containerId, seriesList) {
  const grid = document.getElementById(containerId);
  if (!grid) return;
  grid.innerHTML = seriesList.map(s => {
    const id      = s.tmdb_id || s.id;
    const title   = s.name || s.original_name || 'Unbekannt';
    const year    = (s.first_air_date || s.year || '').toString().substring(0, 4);
    const rating  = s.vote_average ? (s.vote_average / 2).toFixed(1) : (s.rating || '');
    const poster  = s.poster_path
      ? `<img src="${IMG_BASE}${s.poster_path}" alt="${esc(title)}" loading="lazy">`
      : `<div style="font-size:32px">📺</div>`;
    const archived  = seriesLibrary.some(l => l.tmdb_id === id);
    const inWL      = seriesWatchlist.some(w => w.tmdb_id === id);
    const b64       = btoa(unescape(encodeURIComponent(JSON.stringify({
      id, title, year, poster_path: s.poster_path||'',
      vote_average: s.vote_average||0, overview: s.overview||'',
      number_of_seasons: s.number_of_seasons||0
    }))));
    return `
      <div class="movie-card" onclick="openSeriesDetail('${b64}')">
        <div class="movie-poster">${poster}
          <div class="movie-actions">
            <button class="action-btn" onclick="event.stopPropagation();quickAddSeries(${id},'${esc(title)}','${s.poster_path||''}')" title="Archivieren">${archived?'✓':'+'}</button>
            <button class="action-btn" onclick="event.stopPropagation();addSeriesToWatchlist(${id},'${esc(title)}','${s.poster_path||''}')" title="Watchlist">🔖</button>
          </div>
          ${archived ? '<div class="badge-archived">✓</div>' : ''}
          ${inWL && !archived ? '<div class="badge-archived" style="background:rgba(82,153,224,0.9)">🔖</div>' : ''}
        </div>
        <div class="movie-info">
          <div class="movie-title">${title}</div>
          <div class="movie-meta">${year}${s.number_of_seasons ? ' · ' + s.number_of_seasons + ' Staffeln' : ''}</div>
          ${rating ? `<div class="movie-rating">★ ${rating}</div>` : ''}
        </div>
      </div>`;
  }).join('');
}

// ─── SUCHE ────────────────────────────────────────────────────
async function searchSeries() {
  const q = document.getElementById('series-search-input')?.value.trim();
  if (!q) return;
  const loading = document.getElementById('series-search-loading');
  if (loading) loading.classList.add('visible');
  document.getElementById('series-search-results-section').style.display = 'none';
  const data = await tmdbTVFetch('/search/tv', `&query=${encodeURIComponent(q)}&include_adult=false`);
  if (loading) loading.classList.remove('visible');
  if (!data?.results?.length) { toast('Keine Serien gefunden'); return; }
  seriesSearchCache = data.results.slice(0, 15);
  renderSeriesSearchResults();
}

function renderSeriesSearchResults() {
  if (!seriesSearchCache.length) return;
  const wlIds      = new Set(seriesWatchlist.map(s => s.tmdb_id));
  const archiveIds = new Set(seriesLibrary.map(s => s.tmdb_id));
  const visible    = seriesSearchCache.filter(s => !wlIds.has(s.id) && !archiveIds.has(s.id));
  const hidden     = seriesSearchCache.length - visible.length;
  const sec   = document.getElementById('series-search-results-section');
  const title = document.getElementById('series-search-results-title');
  if (sec)   sec.style.display = 'block';
  if (title) title.textContent = hidden > 0
    ? `SUCHERGEBNISSE (${visible.length} von ${seriesSearchCache.length} · ${hidden} bereits archiviert)`
    : `SUCHERGEBNISSE (${seriesSearchCache.length})`;
  renderSeriesGrid('series-search-results', visible.length ? visible : seriesSearchCache);
}

const seriesGenreMap = {drama:18, action:10759, comedy:35, scifi:10765, crime:80, animation:16};

async function setSeriesFilter(f, btn) {
  document.querySelectorAll('#series-filter-row .filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  if (f === 'all') { renderTrendingSeries(); return; }
  const data = await tmdbTVFetch('/discover/tv', `&with_genres=${seriesGenreMap[f]}&sort_by=popularity.desc`);
  if (data) {
    trendingSeriesCache = data.results.slice(0, 12);
    renderTrendingSeriesGrid();
  }
}

// ─── SERIE DETAIL MODAL ───────────────────────────────────────
async function openSeriesDetail(b64) {
  let series;
  try { series = JSON.parse(decodeURIComponent(escape(atob(b64)))); }
  catch { return; }
  currentSeries = series;

  // Existierende Archiv-Daten laden
  const existing = seriesLibrary.find(s => s.tmdb_id === series.id);

  document.getElementById('modal-title').textContent    = series.title || series.name || '';
  document.getElementById('modal-overview').textContent = series.overview || 'Keine Beschreibung verfügbar.';

  const meta = document.getElementById('modal-meta');
  meta.innerHTML = `
    <span class="modal-meta-item">${series.year || ''}</span>
    <span class="modal-meta-item" style="color:var(--border2)">•</span>
    <span class="modal-meta-item">📺 Serie</span>
    ${series.number_of_seasons ? `<span class="modal-meta-item" style="color:var(--border2)">•</span><span class="modal-meta-item">${series.number_of_seasons} Staffeln</span>` : ''}
    <span class="modal-meta-item" style="color:var(--border2)">•</span>
    <span class="modal-meta-item">★ ${((series.vote_average||0)/2).toFixed(1)}/5</span>`;

  const img = document.getElementById('modal-backdrop-img');
  if (series.poster_path) { img.src = `${BACKDROP_BASE}${series.poster_path}`; img.style.display = 'block'; }
  else img.style.display = 'none';

  // Sterne
  const myRating = existing?.rating || 0;
  document.getElementById('modal-stars').innerHTML =
    [1,2,3,4,5].map(i => `<button class="star-btn ${i<=myRating?'active':''}" onclick="setSeriesRating(${i})" data-val="${i}">★</button>`).join('');

  document.getElementById('modal-note').value = existing?.note || '';
  // Notiz-Autosave für Serien
  const noteEl = document.getElementById('modal-note');
  if (noteEl) {
    noteEl.oninput = () => saveSeriesNote();
  }

  // Aktions-Buttons
  renderSeriesModalActions();

  // Vollständige Details laden (Staffeln)
  document.getElementById('movie-modal').classList.add('open');
  if (settings.tmdb_key) loadSeriesFullDetails(series.id);
}

async function loadSeriesFullDetails(id) {
  const data = await tmdbTVFetch(`/tv/${id}`);
  if (!data) return;
  currentSeries = { ...currentSeries, ...data, title: data.name };

  const meta = document.getElementById('modal-meta');
  const genres = data.genres?.slice(0,3).map(g => `<span class="tag gold">${g.name}</span>`).join('') || '';
  const eps    = data.number_of_episodes ? `${data.number_of_episodes} Episoden` : '';
  meta.innerHTML += `<span class="modal-meta-item" style="color:var(--border2)">•</span>
    <span class="modal-meta-item">${eps}</span>
    <span class="modal-meta-item">${genres}</span>`;

  // Staffeln-Liste anhängen
  const existing = seriesLibrary.find(s => s.tmdb_id === id);
  if (data.seasons?.length) {
    const seasons = data.seasons.filter(s => s.season_number > 0);
    const seasonHtml = `
      <div style="margin-top:16px">
        <div style="font-size:12px;color:var(--text2);margin-bottom:10px;letter-spacing:1px;text-transform:uppercase">Staffeln</div>
        <div style="background:var(--bg4);border-radius:10px;padding:0 16px">
          ${seasons.map(s => {
            const watched  = existing?.seasons?.[s.season_number]?.watched_episodes || 0;
            const total    = s.episode_count || 0;
            const pct      = total > 0 ? Math.round(watched/total*100) : 0;
            const b64s     = btoa(unescape(encodeURIComponent(JSON.stringify({seriesId:id,seasonNum:s.season_number,seasonName:s.name,episodeCount:total}))));
            return `
              <div class="season-row" onclick="toggleSeasonEpisodes('${b64s}',this)">
                <div class="season-num">S${s.season_number}</div>
                <div class="season-info">
                  <div class="season-title">${esc(s.name)}</div>
                  <div class="season-meta">${s.air_date?.substring(0,4)||''} · ${total} Episoden</div>
                  <div class="progress-wrap" style="width:120px"><div class="progress-fill" style="width:${pct}%"></div></div>
                </div>
                <div class="season-progress">${watched}/${total}</div>
              </div>
              <div class="episode-list" id="eps-s${s.season_number}"></div>`;
          }).join('')}
        </div>
      </div>`;
    const note = document.getElementById('modal-note');
    if (note) note.insertAdjacentHTML('beforebegin', seasonHtml);
  }
}

async function toggleSeasonEpisodes(b64s, row) {
  let info;
  try { info = JSON.parse(decodeURIComponent(escape(atob(b64s)))); }
  catch { return; }
  const listEl = document.getElementById('eps-s' + info.seasonNum);
  if (!listEl) return;

  if (listEl.classList.contains('open')) {
    listEl.classList.remove('open');
    return;
  }

  if (!listEl.dataset.loaded) {
    listEl.innerHTML = '<div style="padding:10px;color:var(--text3);font-size:12px"><div class="spinner" style="display:inline-block;margin-right:8px"></div>Lade Episoden...</div>';
    listEl.classList.add('open');
    const data = await tmdbTVFetch(`/tv/${info.seriesId}/season/${info.seasonNum}`);
    if (!data?.episodes) {
      listEl.innerHTML = '<div style="padding:10px;color:var(--text3);font-size:12px">Keine Episoden gefunden</div>';
      return;
    }
    const existing = seriesLibrary.find(s => s.tmdb_id === info.seriesId);
    const watchedEps = existing?.seasons?.[info.seasonNum]?.episodes || {};
    listEl.innerHTML = data.episodes.map(ep => {
      const watched = !!watchedEps[ep.episode_number];
      return `
        <div class="episode-item">
          <div class="ep-num">E${ep.episode_number}</div>
          <div class="ep-title">${esc(ep.name || 'Episode ' + ep.episode_number)}</div>
          <button class="ep-check ${watched?'watched':''}" id="epbtn-${info.seriesId}-${info.seasonNum}-${ep.episode_number}"
            onclick="toggleEpisode(${info.seriesId},${info.seasonNum},${ep.episode_number},this)">
            ${watched?'✓':'○'}
          </button>
        </div>`;
    }).join('');
    listEl.dataset.loaded = '1';
  } else {
    listEl.classList.add('open');
  }
}

function toggleEpisode(seriesId, seasonNum, epNum, btn) {
  // Sicherstellen dass die Serie im Archiv ist
  let entry = seriesLibrary.find(s => s.tmdb_id === seriesId);
  if (!entry) {
    if (!currentSeries) return;
    quickAddSeries(seriesId, currentSeries.title || currentSeries.name, currentSeries.poster_path||'');
    entry = seriesLibrary.find(s => s.tmdb_id === seriesId);
    if (!entry) return;
  }
  if (!entry.seasons)              entry.seasons = {};
  if (!entry.seasons[seasonNum])   entry.seasons[seasonNum] = { watched_episodes: 0, episodes: {} };

  const isWatched = !!entry.seasons[seasonNum].episodes[epNum];
  entry.seasons[seasonNum].episodes[epNum] = !isWatched;

  // Watched-Count neu zählen
  entry.seasons[seasonNum].watched_episodes =
    Object.values(entry.seasons[seasonNum].episodes).filter(Boolean).length;

  // Gesamtfortschritt aktualisieren
  const totalWatched = Object.values(entry.seasons).reduce((s, sn) => s + (sn.watched_episodes||0), 0);
  entry.watched_episodes = totalWatched;

  // Status auto-setzen
  if (totalWatched > 0 && entry.status === 'planned') entry.status = 'watching';

  saveSeries();

  // UI aktualisieren
  btn.classList.toggle('watched', !isWatched);
  btn.textContent = !isWatched ? '✓' : '○';

  // Staffel-Progress aktualisieren
  updateSeasonProgressUI(seriesId, seasonNum, entry);
  toast(!isWatched ? '✓ Episode gesehen' : '↩ Episode zurückgesetzt');
}

function updateSeasonProgressUI(seriesId, seasonNum, entry) {
  const sn     = entry.seasons?.[seasonNum];
  const watched = sn?.watched_episodes || 0;
  // Finde Staffel-Row anhand der Struktur
  const allRows = document.querySelectorAll('.season-row');
  allRows.forEach(row => {
    const prog = row.querySelector('.season-progress');
    const fill = row.querySelector('.progress-fill');
    const num  = row.querySelector('.season-num');
    if (num && num.textContent === 'S' + seasonNum) {
      const total = parseInt((prog?.textContent || '0/0').split('/')[1]) || 0;
      if (prog) prog.textContent = `${watched}/${total}`;
      if (fill && total > 0) fill.style.width = Math.round(watched/total*100) + '%';
    }
  });
}

function setSeriesRating(val) {
  document.querySelectorAll('#modal-stars .star-btn').forEach(b => {
    b.classList.toggle('active', parseInt(b.dataset.val) <= val);
  });
  if (!currentSeries) return;
  const idx = seriesLibrary.findIndex(s => s.tmdb_id === currentSeries.id);
  if (idx >= 0) { seriesLibrary[idx].rating = val; saveSeries(); }
  else { quickAddSeries(currentSeries.id, currentSeries.title||currentSeries.name, currentSeries.poster_path||''); }
}

function renderSeriesModalActions() {
  const isArchived = seriesLibrary.some(s => s.tmdb_id === currentSeries?.id);
  const inWL       = seriesWatchlist.some(s => s.tmdb_id === currentSeries?.id);
  const existing   = seriesLibrary.find(s => s.tmdb_id === currentSeries?.id);
  const statusOptions = ['watching','completed','paused','planned'];
  const statusLabels  = {watching:'Am Schauen',completed:'Abgeschlossen',paused:'Pausiert',planned:'Geplant'};

  document.getElementById('modal-actions').innerHTML = `
    <button class="btn-gold" onclick="quickAddSeries(${currentSeries?.id},'${esc(currentSeries?.title||currentSeries?.name||'')}','${currentSeries?.poster_path||''}')">${isArchived?'✓ Archiviert':'+ Archivieren'}</button>
    <button class="btn-outline" onclick="addSeriesToWatchlist(${currentSeries?.id},'${esc(currentSeries?.title||currentSeries?.name||'')}','${currentSeries?.poster_path||''}')">${inWL?'🔖 In Watchlist':'🔖 Watchlist'}</button>
    ${isArchived ? `
      <select onchange="setSeriesStatus(${currentSeries.id},this.value)"
        style="padding:8px 12px;background:var(--bg4);border:1px solid var(--border2);border-radius:8px;color:var(--text);font-family:'Jost',sans-serif;font-size:13px;outline:none;cursor:pointer">
        ${statusOptions.map(s => `<option value="${s}" ${existing?.status===s?'selected':''}>${statusLabels[s]}</option>`).join('')}
      </select>
      <button class="btn-outline" onclick="removeSeriesFromLibrary(${currentSeries.id})" style="border-color:var(--red);color:var(--red)">🗑 Löschen</button>
    ` : ''}`;
}

function setSeriesStatus(id, status) {
  const entry = seriesLibrary.find(s => s.tmdb_id === id);
  if (!entry) return;
  entry.status = status;
  saveSeries();
  toast('Status: ' + {watching:'Am Schauen',completed:'Abgeschlossen',paused:'Pausiert',planned:'Geplant'}[status]);
}

// Notiz für aktuelle Serie speichern (aufgerufen beim Tippen)
function saveSeriesNote() {
  if (!currentSeries) return;
  const entry = seriesLibrary.find(s => s.tmdb_id === currentSeries.id);
  if (entry) {
    entry.note = document.getElementById('modal-note')?.value || '';
    saveSeries();
  }
}

// ─── ARCHIV AKTIONEN ─────────────────────────────────────────
async function quickAddSeries(id, title, posterPath) {
  if (seriesLibrary.some(s => s.tmdb_id === id)) { toast('"' + title + '" bereits archiviert'); return; }
  // Direkt eintragen mit verfügbaren Daten
  const entry = {
    tmdb_id: id, title, poster_path: posterPath,
    year: '', overview: '', rating: 0, note: '',
    added: Date.now(), genres: [], status: 'planned',
    seasons: {}, watched_episodes: 0, total_episodes: 0
  };
  seriesLibrary.unshift(entry);
  // Aus Watchlist entfernen falls vorhanden
  seriesWatchlist = seriesWatchlist.filter(s => s.tmdb_id !== id);
  saveSeries();
  toast('✓ "' + title + '" archiviert');
  renderTrendingSeriesGrid();
  renderSeriesSearchResults();
  renderSeriesModalActions();
  if (document.getElementById('serien-tab-archiv')?.style.display !== 'none') renderSeriesArchive();
  // TMDB Details nachladen (Episodenzahl etc.)
  if (settings.tmdb_key) {
    const data = await tmdbTVFetch('/tv/' + id);
    if (data) {
      entry.year            = (data.first_air_date || '').substring(0, 4);
      entry.overview        = data.overview || '';
      entry.total_episodes  = data.number_of_episodes || 0;
      entry.number_of_seasons = data.number_of_seasons || 0;
      entry.genres          = data.genres?.map(g => g.name) || [];
      saveSeries();
      renderSeriesArchive();
    }
  }
}

function addSeriesToWatchlist(id, title, posterPath) {
  if (seriesLibrary.some(s => s.tmdb_id === id)) { toast('Bereits im Archiv'); return; }
  if (seriesWatchlist.some(s => s.tmdb_id === id)) { toast('Bereits in Watchlist'); return; }
  seriesWatchlist.push({tmdb_id: id, title, poster_path: posterPath, added: Date.now()});
  saveSeries();
  toast('🔖 "' + title + '" zur Watchlist');
  renderTrendingSeriesGrid();
  renderSeriesSearchResults();
  renderSeriesModalActions();
}

function removeSeriesFromLibrary(id, skipConfirm = false) {
  const serie = seriesLibrary.find(s => s.tmdb_id === id);
  if (!serie) return;
  if (!skipConfirm) {
    showDeleteConfirm(
      `"${serie.title}" wirklich löschen?`,
      'Die Serie und ihr gesamter Fortschritt werden entfernt.',
      () => removeSeriesFromLibrary(id, true)
    );
    return;
  }
  seriesLibrary = seriesLibrary.filter(s => s.tmdb_id !== id);
  saveSeries();
  toast('🗑 "' + serie.title + '" gelöscht');
  closeModal();
  renderSeriesArchive();
}

// ─── ARCHIV RENDERN ───────────────────────────────────────────
function setSeriesArchiveFilter(f, btn) {
  seriesArchiveFilter = f;
  document.querySelectorAll('#serien-tab-archiv .filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderSeriesArchive();
}

function renderSeriesArchive() {
  const container = document.getElementById('series-archive-container');
  if (!container) return;
  const sort   = document.getElementById('series-sort-select')?.value || 'added';
  const search = (document.getElementById('series-lib-search')?.value || '').toLowerCase();
  let   items  = [...seriesLibrary];

  if (search) items = items.filter(s => (s.title||'').toLowerCase().includes(search));
  if (seriesArchiveFilter === 'watching')  items = items.filter(s => s.status === 'watching');
  if (seriesArchiveFilter === 'completed') items = items.filter(s => s.status === 'completed');
  if (seriesArchiveFilter === 'paused')    items = items.filter(s => s.status === 'paused');
  if (seriesArchiveFilter === 'planned')   items = items.filter(s => s.status === 'planned');

  if (sort === 'rating')   items.sort((a,b) => b.rating - a.rating);
  else if (sort === 'title')    items.sort((a,b) => (a.title||'').localeCompare(b.title||''));
  else if (sort === 'progress') items.sort((a,b) => {
    const pa = b.total_episodes ? b.watched_episodes/b.total_episodes : 0;
    const pb = a.total_episodes ? a.watched_episodes/a.total_episodes : 0;
    return pa - pb;
  });
  else items.sort((a,b) => b.added - a.added);

  if (!items.length) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">📺</div><div class="empty-title">KEINE SERIEN</div><div class="empty-sub">Entdecke Serien und archiviere sie</div></div>`;
    return;
  }

  const statusLabels = {watching:'Am Schauen',completed:'Abgeschlossen',paused:'Pausiert',planned:'Geplant'};
  const statusClass  = {watching:'status-watching',completed:'status-completed',paused:'status-paused',planned:'status-planned'};

  container.innerHTML = `<div class="lib-list">${items.map(s => {
    const pct     = s.total_episodes > 0 ? Math.round(s.watched_episodes/s.total_episodes*100) : 0;
    const poster  = s.poster_path ? `<img src="${IMG_BASE}${s.poster_path}" loading="lazy">` : '📺';
    const stars   = s.rating ? '★'.repeat(s.rating) + '☆'.repeat(5 - s.rating) : '';
    const b64     = btoa(unescape(encodeURIComponent(JSON.stringify({
      id:s.tmdb_id, title:s.title, year:s.year, poster_path:s.poster_path,
      vote_average:(s.rating||0)*2, overview:s.overview, number_of_seasons:0
    }))));
    return `
      <div class="lib-item" onclick="openSeriesDetail('${b64}')">
        <div class="lib-poster">${poster}</div>
        <div class="lib-info" style="flex:1;min-width:0">
          <div class="lib-title">${esc(s.title)}</div>
          <div style="display:flex;align-items:center;gap:8px;margin-top:4px;flex-wrap:wrap">
            <span class="status-badge ${statusClass[s.status]||'status-planned'}">${statusLabels[s.status]||'Geplant'}</span>
            ${s.watched_episodes > 0 ? `<span style="font-size:11px;color:var(--text2)">${s.watched_episodes} Eps. gesehen</span>` : ''}
          </div>
          ${s.total_episodes > 0 ? `
            <div class="progress-wrap" style="margin-top:6px;max-width:200px">
              <div class="progress-fill" style="width:${pct}%"></div>
            </div>
            <div style="font-size:10px;color:var(--text3);margin-top:2px">${s.watched_episodes}/${s.total_episodes} · ${pct}%</div>
          ` : ''}
          ${stars ? `<div style="font-size:10px;color:var(--gold);margin-top:4px">${stars}</div>` : ''}
        </div>
        <div class="lib-actions">
          <button class="action-btn" onclick="event.stopPropagation();removeSeriesFromLibrary(${s.tmdb_id})" style="color:var(--red)" title="Löschen">🗑</button>
        </div>
      </div>`;
  }).join('')}</div>`;
}

// ─── SERIEN WATCHLIST ─────────────────────────────────────────
function renderSeriesWatchlist() {
  const c = document.getElementById('series-watchlist-container');
  if (!c) return;
  if (!seriesWatchlist.length) {
    c.innerHTML = `<div class="empty-state"><div class="empty-icon">🔖</div><div class="empty-title">WATCHLIST LEER</div><div class="empty-sub">Füge Serien zur Watchlist hinzu</div></div>`;
    return;
  }
  c.innerHTML = `<div class="lib-list">${seriesWatchlist.map((s,i) => {
    const poster = s.poster_path ? `<img src="${IMG_BASE}${s.poster_path}" loading="lazy">` : '📺';
    const b64    = btoa(unescape(encodeURIComponent(JSON.stringify({
      id:s.tmdb_id, title:s.title, year:'', poster_path:s.poster_path, vote_average:0, overview:'', number_of_seasons:0
    }))));
    return `
      <div class="lib-item">
        <div style="font-family:'Cinzel',serif;font-size:14px;color:var(--text3);width:24px;text-align:center;flex-shrink:0">${i+1}</div>
        <div class="lib-poster">${poster}</div>
        <div class="lib-info"><div class="lib-title">${esc(s.title)}</div></div>
        <button class="btn-outline" style="font-size:11px;padding:6px 12px" onclick="quickAddSeries(${s.tmdb_id},'${esc(s.title)}','${s.poster_path||''}')">+ Archivieren</button>
        <button class="action-btn" onclick="removeSeriesFromWL(${s.tmdb_id})" style="color:var(--red)">✕</button>
      </div>`;
  }).join('')}</div>`;
}

function removeSeriesFromWL(id) {
  seriesWatchlist = seriesWatchlist.filter(s => s.tmdb_id !== id);
  saveSeries();
  renderSeriesWatchlist();
  toast('Aus Watchlist entfernt');
}

// ─── FORTSCHRITT ──────────────────────────────────────────────
function renderSeriesProgress() {
  // Statistik-Karten
  const total     = seriesLibrary.length;
  const watching  = seriesLibrary.filter(s => s.status === 'watching').length;
  const completed = seriesLibrary.filter(s => s.status === 'completed').length;
  const totalEps  = seriesLibrary.reduce((sum, s) => sum + (s.watched_episodes||0), 0);

  document.getElementById('series-stats-cards').innerHTML = [
    {val: total,     label: 'Serien archiviert', sub: ''},
    {val: watching,  label: 'Am Schauen',        sub: ''},
    {val: completed, label: 'Abgeschlossen',     sub: ''},
    {val: totalEps,  label: 'Gesehene Episoden', sub: ''},
  ].map(s => `<div class="stat-card"><div class="stat-val">${s.val}</div><div class="stat-label">${s.label}</div></div>`).join('');

  // Aktuell am Schauen
  const watching_list = seriesLibrary.filter(s => s.status === 'watching')
    .sort((a,b) => b.added - a.added).slice(0, 6);
  renderProgressList('series-currently-watching', watching_list);

  // Zuletzt abgeschlossen
  const completed_list = seriesLibrary.filter(s => s.status === 'completed')
    .sort((a,b) => b.added - a.added).slice(0, 6);
  renderProgressList('series-recently-completed', completed_list);
}

function renderProgressList(containerId, items) {
  const c = document.getElementById(containerId);
  if (!c) return;
  if (!items.length) {
    c.innerHTML = '<div style="color:var(--text3);font-size:13px;padding:10px 0">Keine Einträge</div>';
    return;
  }
  c.innerHTML = items.map(s => {
    const pct    = s.total_episodes > 0 ? Math.round(s.watched_episodes/s.total_episodes*100) : 0;
    const poster = s.poster_path ? `<img src="${IMG_BASE}${s.poster_path}" loading="lazy">` : '📺';
    const b64    = btoa(unescape(encodeURIComponent(JSON.stringify({
      id:s.tmdb_id, title:s.title, year:s.year, poster_path:s.poster_path, vote_average:(s.rating||0)*2, overview:'', number_of_seasons:0
    }))));
    return `
      <div class="progress-card" onclick="openSeriesDetail('${b64}')">
        <div class="progress-poster">${poster}</div>
        <div class="progress-info">
          <div class="progress-title">${esc(s.title)}</div>
          <div class="progress-sub">${s.watched_episodes||0} von ${s.total_episodes||'?'} Episoden</div>
          <div class="progress-bar-full"><div class="progress-bar-inner" style="width:${pct}%"></div></div>
          <div class="progress-pct">${pct}% abgeschlossen</div>
        </div>
        ${s.rating ? `<div style="font-family:'Cinzel',serif;font-size:18px;color:var(--gold)">★ ${s.rating}</div>` : ''}
      </div>`;
  }).join('');
}

// ─── INIT SERIEN ─────────────────────────────────────────────
// Wird von showPage() in app.js aufgerufen wenn tab='serien'
function initSerienPage() {
  if (!trendingSeriesCache.length) renderTrendingSeries();
}
