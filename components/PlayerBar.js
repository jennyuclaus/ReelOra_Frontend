import { useState, useRef, useEffect, useCallback } from "react";
import { REPEAT } from "../lib/usePlayer";

function fmt(s) {
  if (!s || isNaN(s)) return "0:00";
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

const S = {
  MAIN: "main", MUSIC: "music", SONGS: "songs",
  ARTISTS: "artists", ALBUMS: "albums",
  PLAYLISTS: "playlists", PL_TRACKS: "pl_tracks",
  ARTIST_TRACKS: "artist_tracks", ALBUM_TRACKS: "album_tracks",
  FOLDERS: "folders", FOLDER_TRACKS: "folder_tracks",
  NOW_PLAYING: "now_playing", SETTINGS: "settings",
};

const C = {
  body:        "linear-gradient(160deg,#1c1008 0%,#2a1205 55%,#1a0e06 100%)",
  bodyGlow:    "rgba(249,115,22,0.35)",
  screen:      "#f5efe6",
  screenBorder:"rgba(200,100,20,0.5)",
  screenGlare: "linear-gradient(180deg,rgba(255,255,255,0.45) 0%,transparent 100%)",
  stitle:      "#1a0a00",
  ssub:        "#7c4a1e",
  sheader:     "#c0390b",
  sline:       "rgba(180,90,20,0.15)",
  selBg:       "linear-gradient(90deg,#ea580c,#f97316)",
  selText:     "#fff",
  progress:    "linear-gradient(90deg,#c0390b,#f97316,#fb923c)",
  wheel:       "linear-gradient(145deg,#2a1205 0%,#1c0e04 40%,#0f0803 100%)",
  wheelGlow:   "rgba(249,115,22,0.3)",
  center:      "linear-gradient(145deg,#3d1a08,#251005)",
  centerGlow:  "rgba(249,115,22,0.4)",
  wbtnColor:   "rgba(255,200,150,0.85)",
  badge:       "linear-gradient(135deg,#c0390b,#f97316)",
  del:         "#e11d48",
};

// ── Dominant color from image ──────────────────────────────────────────────
function getDominantColor(imgEl) {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 16; canvas.height = 16;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(imgEl, 0, 0, 16, 16);
    const d = ctx.getImageData(0, 0, 16, 16).data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) {
      const sat = Math.max(d[i], d[i+1], d[i+2]) - Math.min(d[i], d[i+1], d[i+2]);
      if (sat > 30) { r += d[i]; g += d[i+1]; b += d[i+2]; n++; }
    }
    if (n === 0) return null;
    return `${Math.round(r/n)},${Math.round(g/n)},${Math.round(b/n)}`;
  } catch { return null; }
}

export default function IpodPlayer({
  state, dispatch, currentTrack, seek,
  tracks = [], onPlayIndex, onPlayAll,
  playlists = [], onPlayPlaylist, onCreatePlaylist, onDeletePlaylist,
}) {
  const { isPlaying, progress, duration, shuffle, repeat } = state;

  const navRef = useRef({
    stack: [S.MAIN], scrollIdx: 0,
    selectedArtist: null, selectedAlbum: null,
    selectedPlaylist: null, selectedFolder: null,
  });

  const [tick, setTick] = useState(0);
  const redraw = () => setTick(t => t + 1);

  const nav = navRef.current;
  const screen = nav.stack[nav.stack.length - 1];

  const wheelRef = useRef(null);
  const wheelAngleRef = useRef(0);
  const [wheelAngle, setWheelAngle] = useState(0);
  const dragRef = useRef({ active: false, lastAngle: 0, totalDelta: 0 });
  const [pressing, setPressing] = useState(null);
  const [newPlName, setNewPlName] = useState("");
  const [showNewPl, setShowNewPl] = useState(false);

  // ── Ambilight color state ─────────────────────────────────────────────
  const [ambilightColor, setAmbilightColor] = useState("249,115,22");
  const coverImgRef = useRef(null);

  // ── Web Audio / Waveform ──────────────────────────────────────────────
  const waveCanvasRef = useRef(null);
  const analyserRef = useRef(null);
  const animFrameRef = useRef(null);
  const audioCtxRef = useRef(null);
  const sourceNodeRef = useRef(null);

  // Connect analyser to the global audio element when it exists
  const setupAnalyser = useCallback(() => {
    const audioEl = document.querySelector("audio");
    if (!audioEl || sourceNodeRef.current) return;
    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
      }
      const ctx = audioCtxRef.current;
      const source = ctx.createMediaElementSource(audioEl);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 128;
      source.connect(analyser);
      analyser.connect(ctx.destination);
      analyserRef.current = analyser;
      sourceNodeRef.current = source;
    } catch {}
  }, []);

  useEffect(() => {
    if (isPlaying) {
      setupAnalyser();
      if (audioCtxRef.current?.state === "suspended") audioCtxRef.current.resume();
    }
  }, [isPlaying, setupAnalyser]);

  // Draw waveform
  useEffect(() => {
    const canvas = waveCanvasRef.current;
    if (!canvas) return;
    const ctx2d = canvas.getContext("2d");
    const W = canvas.width, H = canvas.height;

    function draw() {
      animFrameRef.current = requestAnimationFrame(draw);
      ctx2d.clearRect(0, 0, W, H);
      const analyser = analyserRef.current;
      const barCount = 40;
      const barW = Math.floor(W / barCount) - 1;

      if (analyser && isPlaying) {
        const data = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(data);
        for (let i = 0; i < barCount; i++) {
          const val = data[Math.floor(i * data.length / barCount)] / 255;
          const h = Math.max(3, val * H * 0.92);
          const y = (H - h) / 2;
          const pct = (progress && duration) ? progress / duration : 0;
          ctx2d.fillStyle = i / barCount < pct ? "#e07030" : "rgba(180,120,60,0.4)";
          ctx2d.beginPath();
          ctx2d.roundRect(i * (barW + 1), y, barW, h, 1.5);
          ctx2d.fill();
        }
      } else {
        // Static demo bars when paused
        for (let i = 0; i < barCount; i++) {
          const amp = 0.25 + 0.45 * Math.abs(Math.sin(i * 0.43 + 1.1)) * (0.5 + 0.5 * Math.abs(Math.sin(i * 0.19)));
          const h = Math.max(3, amp * H * 0.7);
          const y = (H - h) / 2;
          const pct = (progress && duration) ? progress / duration : 0;
          ctx2d.fillStyle = i / barCount < pct ? "rgba(200,100,40,0.7)" : "rgba(180,120,60,0.3)";
          ctx2d.beginPath();
          ctx2d.roundRect(i * (barW + 1), y, barW, h, 1.5);
          ctx2d.fill();
        }
      }
    }
    draw();
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [isPlaying, progress, duration]);

  // Update ambilight when cover changes
  useEffect(() => {
    if (!currentTrack?.coverUrl) {
      setAmbilightColor("249,115,22");
      return;
    }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const c = getDominantColor(img);
      if (c) setAmbilightColor(c);
    };
    img.src = currentTrack.coverUrl;
  }, [currentTrack?.coverUrl]);

  const VISIBLE = 6;

  function getList(scr) {
    const artists = [...new Set(tracks.map(t => t.artist).filter(Boolean))].sort();
    const albums  = [...new Set(tracks.map(t => t.album).filter(Boolean))].sort();
    const folders = [...new Set(tracks.map(t => t.folder).filter(Boolean))].sort();
    switch (scr) {
      case S.MAIN:    return ["Music", "Now Playing", "Settings"];
      case S.MUSIC:   return ["Songs", "Artists", "Albums", "Playlists", "Ordner"];
      case S.SONGS:   return tracks;
      case S.ARTISTS: return artists.length ? artists : ["Keine Artists"];
      case S.ALBUMS:  return albums.length  ? albums  : ["Keine Alben"];
      case S.FOLDERS: return folders.length ? folders : ["Keine Ordner"];
      case S.PLAYLISTS: return ["+ Neue Playlist", ...playlists];
      case S.PL_TRACKS: {
        const pl = playlists.find(p => p.id === nav.selectedPlaylist);
        const plT = pl ? pl.tracks.map(id => tracks.find(t => t.id === id)).filter(Boolean) : [];
        return [...plT, "🗑 Playlist löschen"];
      }
      case S.ARTIST_TRACKS: return tracks.filter(t => t.artist === nav.selectedArtist);
      case S.ALBUM_TRACKS:  return tracks.filter(t => t.album  === nav.selectedAlbum);
      case S.FOLDER_TRACKS: return tracks.filter(t => t.folder === nav.selectedFolder);
      case S.SETTINGS: return [
        `Shuffle: ${shuffle ? "AN" : "AUS"}`,
        `Repeat: ${repeat === REPEAT.NONE ? "AUS" : repeat === REPEAT.ONE ? "Ein Titel" : "Alle"}`,
      ];
      default: return [];
    }
  }

  const list    = getList(screen);
  const safeIdx = Math.max(0, Math.min(nav.scrollIdx, list.length - 1));

  function push(scr) { nav.stack.push(scr); nav.scrollIdx = 0; redraw(); }
  function pop()     { if (nav.stack.length > 1) { nav.stack.pop(); nav.scrollIdx = 0; redraw(); } }

  function enter(item, scr) {
    if (!item) return;
    if (scr === S.MAIN) {
      if (item === "Music") push(S.MUSIC);
      else if (item === "Now Playing") push(S.NOW_PLAYING);
      else if (item === "Settings") push(S.SETTINGS);
    } else if (scr === S.MUSIC) {
      if (item === "Songs")     push(S.SONGS);
      else if (item === "Artists")  push(S.ARTISTS);
      else if (item === "Albums")   push(S.ALBUMS);
      else if (item === "Playlists")push(S.PLAYLISTS);
      else if (item === "Ordner")   push(S.FOLDERS);
    } else if (scr === S.SONGS || scr === S.ARTIST_TRACKS || scr === S.ALBUM_TRACKS || scr === S.FOLDER_TRACKS) {
      const idx = tracks.indexOf(item);
      if (idx >= 0) { onPlayIndex && onPlayIndex(idx); push(S.NOW_PLAYING); }
    } else if (scr === S.ARTISTS) { nav.selectedArtist = item; push(S.ARTIST_TRACKS); }
    else if (scr === S.ALBUMS)    { nav.selectedAlbum  = item; push(S.ALBUM_TRACKS); }
    else if (scr === S.FOLDERS)   { nav.selectedFolder = item; push(S.FOLDER_TRACKS); }
    else if (scr === S.PLAYLISTS) {
      if (item === "+ Neue Playlist") { setNewPlName(""); setShowNewPl(true); }
      else { nav.selectedPlaylist = item.id; push(S.PL_TRACKS); }
    } else if (scr === S.PL_TRACKS) {
      if (item === "🗑 Playlist löschen") {
        const pl = playlists.find(p => p.id === nav.selectedPlaylist);
        if (pl && window.confirm(`"${pl.name}" löschen?`)) {
          onDeletePlaylist && onDeletePlaylist(nav.selectedPlaylist);
          nav.selectedPlaylist = null; nav.stack.pop(); nav.scrollIdx = 0; redraw();
        }
        return;
      }
      const pl = playlists.find(p => p.id === nav.selectedPlaylist);
      if (pl) {
        const plT = pl.tracks.map(id => tracks.find(t => t.id === id)).filter(Boolean);
        const li  = plT.indexOf(item);
        if (li >= 0) { onPlayPlaylist && onPlayPlaylist(pl, li); push(S.NOW_PLAYING); }
      }
    } else if (scr === S.SETTINGS) {
      if (typeof item === "string" && item.startsWith("Shuffle")) dispatch({ type:"TOGGLE_SHUFFLE" });
      else if (typeof item === "string" && item.startsWith("Repeat")) dispatch({ type:"CYCLE_REPEAT" });
    }
  }

  // ── Wheel ───────────────────────────────────────────────────────────────
  function getAngle(e, el) {
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const x = e.touches ? e.touches[0].clientX : e.clientX;
    const y = e.touches ? e.touches[0].clientY : e.clientY;
    return Math.atan2(y - cy, x - cx) * (180 / Math.PI);
  }
  function onWheelStart(e) {
    e.preventDefault();
    dragRef.current = { active:true, lastAngle:getAngle(e, wheelRef.current), totalDelta:0 };
  }
  function onWheelMove(e) {
    if (!dragRef.current.active) return;
    e.preventDefault();
    const angle = getAngle(e, wheelRef.current);
    let delta = angle - dragRef.current.lastAngle;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    dragRef.current.lastAngle = angle;
    dragRef.current.totalDelta += delta;
    wheelAngleRef.current += delta;
    if (Math.abs(delta) > 1) setWheelAngle(wheelAngleRef.current);
    const STEP = 22;
    if (Math.abs(dragRef.current.totalDelta) > STEP) {
      const dir = dragRef.current.totalDelta > 0 ? 1 : -1;
      dragRef.current.totalDelta = 0;
      const scr = navRef.current.stack[navRef.current.stack.length - 1];
      if (scr === S.NOW_PLAYING) {
        seek(Math.max(0, Math.min(duration, progress + dir * 10)));
      } else {
        const l = getList(scr);
        navRef.current.scrollIdx = Math.max(0, Math.min(l.length - 1, navRef.current.scrollIdx + dir));
        redraw();
      }
    }
  }
  function onWheelEnd() { dragRef.current.active = false; }

  function press(btn) { setPressing(btn); setTimeout(() => setPressing(null), 120); }
  function btnMenu() { press("menu"); pop(); }
  function btnPlay() {
    press("play");
    const scr = nav.stack[nav.stack.length - 1];
    if (scr === S.NOW_PLAYING || currentTrack) dispatch({ type:"TOGGLE_PLAY" });
    else { onPlayAll && onPlayAll(); push(S.NOW_PLAYING); }
  }
  function btnNext() { press("next"); dispatch({ type:"NEXT" }); }
  function btnPrev() {
    press("prev");
    if (progress > 3) { seek(0); return; }
    dispatch({ type:"PREV" });
  }
  function btnEnter() {
    press("enter");
    const scr = navRef.current.stack[navRef.current.stack.length - 1];
    const l   = getList(scr);
    const idx = Math.max(0, Math.min(navRef.current.scrollIdx, l.length - 1));
    enter(l[idx], scr);
  }

  const titles = {
    [S.MAIN]: "MusigPlayer", [S.MUSIC]: "Musik",
    [S.SONGS]: `Songs (${tracks.length})`,
    [S.ARTISTS]: "Interpreten", [S.ALBUMS]: "Alben",
    [S.FOLDERS]: "Ordner",     [S.PLAYLISTS]: "Playlisten",
    [S.PL_TRACKS]: playlists.find(p => p.id === nav.selectedPlaylist)?.name || "Playlist",
    [S.ARTIST_TRACKS]: nav.selectedArtist || "Interpret",
    [S.ALBUM_TRACKS]:  nav.selectedAlbum  || "Album",
    [S.FOLDER_TRACKS]: nav.selectedFolder || "Ordner",
    [S.SETTINGS]: "Einstellungen",
  };

  // ── Now Playing screen ───────────────────────────────────────────────────
  function renderNowPlaying() {
    const pct = duration ? (progress / duration) * 100 : 0;
    return (
      <div style={{ height:"100%", display:"flex", flexDirection:"column", background:C.screen, position:"relative", overflow:"hidden" }}>

        {/* Cover als großer Hintergrund – subtil */}
        {currentTrack?.coverUrl && (
          <div style={{
            position:"absolute", inset:0, zIndex:0,
            backgroundImage:`url(${currentTrack.coverUrl})`,
            backgroundSize:"cover", backgroundPosition:"center",
            opacity:0.12, filter:"blur(8px)", transform:"scale(1.1)",
          }} />
        )}

        <div style={{ position:"relative", zIndex:1, height:"100%", display:"flex", flexDirection:"column", padding:"10px 12px" }}>

          {/* Cover groß + Info nebeneinander */}
          <div style={{ display:"flex", alignItems:"flex-start", gap:10, marginBottom:6 }}>
            <div style={{
              width:76, height:76, borderRadius:8, overflow:"hidden", flexShrink:0,
              background:"#e8ddd0", display:"flex", alignItems:"center", justifyContent:"center",
              boxShadow:"0 3px 12px rgba(0,0,0,0.35), 0 1px 0 rgba(255,255,255,0.3) inset",
            }}>
              {currentTrack?.coverUrl
                ? <img ref={coverImgRef} src={currentTrack.coverUrl} crossOrigin="anonymous" style={{ width:"100%", height:"100%", objectFit:"cover" }} alt="" />
                : <span style={{ fontSize:32 }}>🎵</span>}
            </div>
            <div style={{ overflow:"hidden", flex:1, paddingTop:4 }}>
              <div style={{ fontSize:14, fontWeight:700, color:C.stitle, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", lineHeight:1.25 }}>
                {currentTrack ? (currentTrack.title || currentTrack.name?.replace(/\.[^.]+$/, "")) : "Kein Titel"}
              </div>
              <div style={{ fontSize:12, color:C.ssub, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", marginTop:3 }}>
                {currentTrack?.artist || "—"}
              </div>
              {currentTrack?.album && (
                <div style={{ fontSize:10, color:C.ssub, opacity:0.7, marginTop:2, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{currentTrack.album}</div>
              )}
              <div style={{ display:"flex", gap:4, marginTop:5 }}>
                {shuffle && <span style={{ fontSize:8, background:C.badge, color:"#fff", borderRadius:3, padding:"1px 5px", fontWeight:700 }}>SHUFFLE</span>}
                {repeat === REPEAT.ONE && <span style={{ fontSize:8, background:C.badge, color:"#fff", borderRadius:3, padding:"1px 5px", fontWeight:700 }}>REPEAT 1</span>}
                {repeat === REPEAT.ALL && <span style={{ fontSize:8, background:C.badge, color:"#fff", borderRadius:3, padding:"1px 5px", fontWeight:700 }}>REPEAT ALL</span>}
              </div>
            </div>
          </div>

          {/* Waveform */}
          <div style={{ marginBottom:6 }}>
            <canvas
              ref={waveCanvasRef}
              width={260} height={36}
              style={{ width:"100%", height:36, display:"block", borderRadius:4 }}
            />
          </div>

          {/* Progress */}
          <div style={{ marginTop:"auto" }}>
            <div style={{ height:4, background:"rgba(0,0,0,0.12)", borderRadius:2, overflow:"hidden", marginBottom:4 }}>
              <div style={{ height:"100%", width:`${pct}%`, background:C.progress, borderRadius:2, transition:"width 0.8s linear" }} />
            </div>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", fontSize:10, color:C.ssub }}>
              <span style={{ fontWeight:600 }}>{fmt(progress)}</span>
              <span style={{ fontSize:14, color: isPlaying ? "#c0390b" : "#999" }}>{isPlaying ? "▶" : "⏸"}</span>
              <span style={{ fontWeight:600 }}>{fmt(duration)}</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── List screen ──────────────────────────────────────────────────────────
  function renderList() {
    const startIdx = Math.max(0, Math.min(safeIdx - 2, list.length - VISIBLE));
    const visible  = list.slice(startIdx, startIdx + VISIBLE);
    return (
      <div style={{ height:"100%", display:"flex", flexDirection:"column", background:C.screen }}>
        <div style={{ padding:"5px 12px 4px", borderBottom:`1px solid ${C.sline}`, display:"flex", justifyContent:"space-between", alignItems:"center", flexShrink:0, background:"rgba(200,100,20,0.08)" }}>
          <span style={{ fontSize:12, fontWeight:800, color:C.sheader, letterSpacing:"0.06em" }}>
            {titles[screen] || ""}
          </span>
          {nav.stack.length > 1 && <span style={{ fontSize:9, color:C.ssub }}>◀ MENU</span>}
        </div>
        <div style={{ flex:1, overflow:"hidden" }}>
          {visible.map((item, i) => {
            const realIdx = startIdx + i;
            const isSel   = realIdx === safeIdx;
            const label   = typeof item === "string" ? item
              : (item.title || item.name?.replace(/\.[^.]+$/, "") || "");
            const sub     = typeof item === "object"
              ? (item.artist || (item.tracks ? `${item.tracks.length} Titel` : "")) : "";
            const isDel   = typeof item === "string" && item.startsWith("🗑");
            return (
              <div key={realIdx}
                style={{ padding:"8px 12px", background: isSel ? C.selBg : "transparent",
                  display:"flex", alignItems:"center", gap:8,
                  borderBottom:`1px solid ${C.sline}`, cursor:"pointer",
                  WebkitTapHighlightColor:"transparent" }}
                onPointerDown={(e) => { e.preventDefault(); nav.scrollIdx = realIdx; enter(item, screen); }}
              >
                {typeof item === "object" && item.coverUrl && (
                  <img src={item.coverUrl} style={{ width:26, height:26, borderRadius:3, objectFit:"cover", flexShrink:0 }} alt="" />
                )}
                <div style={{ overflow:"hidden", flex:1 }}>
                  <div style={{ fontSize:14, fontWeight: isSel ? 700 : 400,
                    color: isSel ? C.selText : isDel ? C.del : C.stitle,
                    whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
                    {label}
                  </div>
                  {sub && <div style={{ fontSize:11, color: isSel ? "rgba(255,255,255,0.8)" : C.ssub }}>{sub}</div>}
                </div>
                <span style={{ fontSize:11, color: isSel ? "rgba(255,255,255,0.6)" : C.ssub }}>›</span>
              </div>
            );
          })}
        </div>
        {list.length > VISIBLE && (
          <div style={{ textAlign:"center", fontSize:9, color:C.ssub, padding:"2px 0", flexShrink:0, background:"rgba(200,100,20,0.06)" }}>
            {safeIdx + 1} / {list.length}
          </div>
        )}
      </div>
    );
  }

  // ── Main render ──────────────────────────────────────────────────────────
  const glowR = ambilightColor;

  return (
    <>
      <style>{`
        .ipod-stage{
          display:flex;justify-content:center;align-items:center;
          padding:16px 12px;min-height:100%;user-select:none;-webkit-user-select:none;
          position:relative;
        }
        .ambilight{
          position:absolute;inset:0;pointer-events:none;z-index:0;
          background:radial-gradient(ellipse 70% 55% at 50% 40%, rgba(${glowR},0.28) 0%, rgba(${glowR},0.08) 50%, transparent 100%);
          transition:background 1.2s ease;
        }
        .ipod{
          position:relative;z-index:1;
          width:min(340px,94vw);
          background:${C.body};border-radius:40px;padding:20px 20px 28px;
          box-shadow:0 28px 80px rgba(0,0,0,0.85),0 0 50px rgba(${glowR},0.3),0 1px 0 rgba(255,200,100,0.12) inset;
          user-select:none;-webkit-user-select:none;
          transition:box-shadow 1.2s ease;
        }
        .ipod-notch{width:64px;height:6px;background:rgba(255,180,80,0.2);border-radius:3px;margin:0 auto 15px;}
        .ipod-screen{
          border-radius:12px;height:210px;margin-bottom:22px;overflow:hidden;
          box-shadow:inset 0 2px 8px rgba(0,0,0,0.4),0 0 20px rgba(${glowR},0.2);
          background:${C.screen};position:relative;border:1px solid ${C.screenBorder};
          transition:box-shadow 1.2s ease;
        }
        .screen-glare{position:absolute;top:0;left:0;right:0;height:40%;background:${C.screenGlare};border-radius:12px 12px 0 0;pointer-events:none;z-index:10;}
        .wheel-wrap{width:min(260px,86vw);height:min(260px,86vw);margin:0 auto;position:relative;}
        .wheel-ring{
          width:100%;height:100%;border-radius:50%;
          background:${C.wheel};
          box-shadow:0 6px 30px rgba(0,0,0,0.7),0 0 30px rgba(${glowR},0.25),0 1px 0 rgba(255,180,80,0.1) inset;
          position:absolute;inset:0;touch-action:none;
          transition:box-shadow 1.2s ease;
        }
        .wbtn{position:absolute;display:flex;align-items:center;justify-content:center;cursor:pointer;user-select:none;z-index:5;-webkit-tap-highlight-color:transparent;}
        .wbtn.p{opacity:0.3;}
        .wcenter{
          position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);
          width:38%;height:38%;border-radius:50%;
          background:${C.center};
          box-shadow:0 3px 15px rgba(0,0,0,0.6),0 0 20px rgba(${glowR},0.35),0 1px 0 rgba(255,180,80,0.1) inset;
          cursor:pointer;z-index:6;user-select:none;-webkit-tap-highlight-color:transparent;
          transition:box-shadow 1.2s ease;
        }
        .wcenter.p{transform:translate(-50%,-50%) scale(0.92);}
        .ipod-dock{width:42px;height:8px;background:linear-gradient(180deg,rgba(255,180,80,0.2),rgba(255,180,80,0.05));border-radius:0 0 5px 5px;margin:20px auto 0;}
      `}</style>

      <div className="ipod-stage">
        <div className="ambilight" />
        <div className="ipod">
          <div className="ipod-notch" />
          <div className="ipod-screen">
            <div className="screen-glare" />
            {showNewPl ? (
              <div style={{ height:"100%", display:"flex", flexDirection:"column", padding:"12px", background:C.screen }}>
                <div style={{ fontSize:12, fontWeight:800, color:C.sheader, marginBottom:10 }}>Neue Playlist</div>
                <input autoFocus type="text" value={newPlName}
                  onChange={e => setNewPlName(e.target.value)}
                  placeholder="Name eingeben…"
                  style={{ border:`1px solid rgba(200,80,20,0.4)`, borderRadius:8, padding:"8px 10px", fontSize:14, outline:"none", background:"#fff", color:C.stitle, marginBottom:10 }}
                  onKeyDown={e => {
                    if (e.key === "Enter" && newPlName.trim()) { onCreatePlaylist && onCreatePlaylist(newPlName.trim()); setShowNewPl(false); setNewPlName(""); redraw(); }
                    if (e.key === "Escape") { setShowNewPl(false); setNewPlName(""); }
                  }}
                />
                <div style={{ display:"flex", gap:8 }}>
                  <button onPointerDown={() => { if (newPlName.trim()) { onCreatePlaylist && onCreatePlaylist(newPlName.trim()); setShowNewPl(false); setNewPlName(""); redraw(); } }}
                    style={{ flex:1, background:"linear-gradient(135deg,#c0390b,#f97316)", color:"#fff", border:"none", borderRadius:8, padding:"8px", fontSize:13, cursor:"pointer", fontWeight:700 }}>
                    Erstellen
                  </button>
                  <button onPointerDown={() => { setShowNewPl(false); setNewPlName(""); }}
                    style={{ flex:1, background:"rgba(0,0,0,0.08)", color:C.stitle, border:`1px solid rgba(0,0,0,0.15)`, borderRadius:8, padding:"8px", fontSize:13, cursor:"pointer" }}>
                    Abbrechen
                  </button>
                </div>
              </div>
            ) : screen === S.NOW_PLAYING ? renderNowPlaying() : renderList()}
          </div>

          <div className="wheel-wrap">
            <div ref={wheelRef} className="wheel-ring"
              onMouseDown={onWheelStart} onMouseMove={onWheelMove} onMouseUp={onWheelEnd} onMouseLeave={onWheelEnd}
              onTouchStart={onWheelStart} onTouchMove={onWheelMove} onTouchEnd={onWheelEnd}
              style={{ transform:`rotate(${wheelAngle}deg)` }} />

            <div className={`wbtn${pressing==="menu"?" p":""}`}
              style={{ top:"6%", left:"50%", transform:"translateX(-50%)", fontSize:11, fontWeight:800, color:C.wbtnColor, letterSpacing:"0.08em", padding:"10px 14px" }}
              onPointerDown={(e)=>{ e.stopPropagation(); btnMenu(); }}>MENU</div>
            <div className={`wbtn${pressing==="prev"?" p":""}`}
              style={{ top:"50%", left:"6%", transform:"translateY(-50%)", padding:"10px" }}
              onPointerDown={(e)=>{ e.stopPropagation(); btnPrev(); }}>
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none"><rect x="3" y="3" width="3" height="16" rx="1" fill="rgba(255,200,150,0.85)"/><polygon points="19,3 7,11 19,19" fill="rgba(255,200,150,0.85)"/></svg>
            </div>
            <div className={`wbtn${pressing==="next"?" p":""}`}
              style={{ top:"50%", right:"6%", transform:"translateY(-50%)", padding:"10px" }}
              onPointerDown={(e)=>{ e.stopPropagation(); btnNext(); }}>
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none"><polygon points="3,3 15,11 3,19" fill="rgba(255,200,150,0.85)"/><rect x="16" y="3" width="3" height="16" rx="1" fill="rgba(255,200,150,0.85)"/></svg>
            </div>
            <div className={`wbtn${pressing==="play"?" p":""}`}
              style={{ bottom:"6%", left:"50%", transform:"translateX(-50%)", padding:"10px" }}
              onPointerDown={(e)=>{ e.stopPropagation(); btnPlay(); }}>
              {isPlaying
                ? <svg width="22" height="22" viewBox="0 0 22 22" fill="none"><rect x="4" y="3" width="4" height="16" rx="1" fill="rgba(255,200,150,0.85)"/><rect x="14" y="3" width="4" height="16" rx="1" fill="rgba(255,200,150,0.85)"/></svg>
                : <svg width="22" height="22" viewBox="0 0 22 22" fill="none"><polygon points="5,2 19,11 5,20" fill="rgba(255,200,150,0.85)"/></svg>
              }
            </div>
            <div className={`wcenter${pressing==="enter"?" p":""}`}
              onPointerDown={(e)=>{ e.stopPropagation(); press("enter"); btnEnter(); }} />
          </div>
          <div className="ipod-dock" />
        </div>
      </div>
    </>
  );
}
