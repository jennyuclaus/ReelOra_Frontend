import { useState, useEffect, useRef } from "react";
import { useSession, signIn, signOut } from "next-auth/react";
import Head from "next/head";
import dynamic from "next/dynamic";
import { usePlayer } from "../lib/usePlayer";
import { fetchGoogleDriveFiles, getGoogleStreamUrl, savePlaylistToGoogle } from "../lib/google";
import { fetchOneDriveFiles, getOneDriveStreamUrl, savePlaylistToOneDrive } from "../lib/onedrive";
import { savePlaylist, loadPlaylists, deletePlaylist } from "../lib/db";

const IpodPlayer = dynamic(() => import("../components/PlayerBar"), { ssr: false });

export default function Home() {
  const { data: session } = useSession();
  const { state, dispatch, currentTrack, seek, getFreshUrlRef } = usePlayer();

  const [allTracks, setAllTracks] = useState([]);
  const [playlists, setPlaylists] = useState([]);
  const [loading, setLoading] = useState(false);
  const [tagsLoading, setTagsLoading] = useState(false);
  const [tagsProgress, setTagsProgress] = useState(0);
  const [online, setOnline] = useState(true);
  const [mounted, setMounted] = useState(false);
  const sessionRef = useRef(null);

  useEffect(() => {
    setMounted(true);
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

  useEffect(() => { loadPlaylists().then(setPlaylists).catch(() => {}); }, []);

  // Register fresh URL fetcher in player
  useEffect(() => {
    if (!session?.accessToken) return;
    getFreshUrlRef.current = async (track) => {
      if (track.provider === "google") return getGoogleStreamUrl(track.id, session.accessToken);
      const r = await fetch(
        `https://graph.microsoft.com/v1.0/me/drive/items/${track.id}`,
        { headers: { Authorization: `Bearer ${session.accessToken}` } }
      );
      if (!r.ok) return null;
      const d = await r.json();
      return d["@microsoft.graph.downloadUrl"] || null;
    };
  }, [session]);
  useEffect(() => {
    sessionRef.current = session;
    // Wenn Token-Refresh fehlgeschlagen → neu einloggen
    if (session?.error === "RefreshAccessTokenError") {
      signIn(session.provider || "azure-ad");
      return;
    }
    if (session?.accessToken) loadTracks(session);
  }, [session]);

  async function loadTracks(forceSession) {
    const s = forceSession || session;
    if (!s?.accessToken) return;
    setLoading(true);
    try {
      let tracks = [];
      if (s.provider === "google") {
        const data = await fetchGoogleDriveFiles(s.accessToken);
        if (data.error?.code === 401) { signIn("google"); return; }
        tracks = (data.files || []).map((f) => ({
          id: f.id, name: f.name,
          title: f.name.replace(/\.[^.]+$/, ""),
          provider: "google", thumbnail: f.thumbnailLink || null, streamUrl: null,
        }));
      } else if (s.provider === "azure-ad") {
        tracks = await fetchOneDriveFiles(s.accessToken).catch(async (e) => {
          if (e?.message?.includes("401") || e?.message?.includes("Unauthorized")) {
            signIn("azure-ad");
            return [];
          }
          throw e;
        });
      }
      setAllTracks(tracks);
      if (tracks.length > 0) loadTagsInBackground(tracks, s);
    } catch (e) {
      console.error("loadTracks error:", e);
      // Letzter Ausweg: 401 im Error-String → Re-Login
      if (String(e).includes("401") || String(e).includes("Unauthorized")) {
        signIn(s.provider || "azure-ad");
      }
    }
    setLoading(false);
  }

  async function loadTagsInBackground(tracks, s) {
    // OneDrive liefert Tags direkt via Graph API audio-Property beim fetchOneDriveFiles
    // Kein zusätzlicher Download nötig – nur Cover-Art wenn noch nicht vorhanden
    setTagsLoading(true);
    setTagsProgress(0);

    const updated = [...tracks];
    let changed = false;

    for (let i = 0; i < tracks.length; i++) {
      const track = tracks[i];
      // Nur wenn Cover noch fehlt UND coverUrl aus einem blob käme
      // Für OneDrive: kein Range-Fetch – zu langsam und blockiert CORS
      // Cover-Art wird übersprungen, Tags kommen bereits aus fetchOneDriveFiles
      updated[i] = { ...track };
      setTagsProgress(i + 1);
    }

    if (changed) setAllTracks([...updated]);
    setTagsLoading(false);
  }

  async function getStreamUrl(track) {
    if (track.streamUrl) return track.streamUrl;
    if (track.provider === "google") return getGoogleStreamUrl(track.id, session.accessToken);
    return getOneDriveStreamUrl(track.id, session.accessToken);
  }

  // Fetch fresh stream URL just before playing - avoids expired URLs
  async function getFreshStreamUrl(track) {
    if (track.provider === "google") return getGoogleStreamUrl(track.id, session.accessToken);
    // Always fetch fresh from Graph API for OneDrive
    const r = await fetch(
      `https://graph.microsoft.com/v1.0/me/drive/items/${track.id}`,
      { headers: { Authorization: `Bearer ${session.accessToken}` } }
    );
    if (!r.ok) return null;
    const d = await r.json();
    return d["@microsoft.graph.downloadUrl"] || null;
  }

  async function handlePlay(index) {
    // Set queue without URLs first so UI is instant
    dispatch({ type: "SET_QUEUE", payload: allTracks, startIndex: index ?? 0 });
  }

  async function handlePlayAll() {
    if (allTracks.length === 0) return;
    await handlePlay(0);
  }

  async function handlePlayPlaylist(pl, startIndex = 0) {
    const tracks = pl.tracks.map((id) => allTracks.find((t) => t.id === id)).filter(Boolean);
    dispatch({ type: "SET_QUEUE", payload: tracks, startIndex });
  }

  async function handleCreatePlaylist(name) {
    const pl = { id: Date.now().toString(), name, tracks: [] };
    setPlaylists((prev) => [...prev, pl]);
    await savePlaylist(pl);
    if (session?.accessToken) {
      if (session.provider === "google") await savePlaylistToGoogle(session.accessToken, pl);
      else await savePlaylistToOneDrive(session.accessToken, pl);
    }
  }

  async function handleDeletePlaylist(id) {
    setPlaylists((prev) => prev.filter((p) => p.id !== id));
    await deletePlaylist(id);
  }

  if (!mounted) return null;

  return (
    <>
      <Head>
        <title>MusigPlayer</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#0a0a1a" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="MusigPlayer" />
        <link rel="manifest" href="/manifest.json" />
        <link rel="icon" type="image/x-icon" href="/favicon.ico" />
        <link rel="icon" type="image/png" sizes="32x32" href="/icons/icon-32.png" />
        <link rel="icon" type="image/png" sizes="64x64" href="/icons/icon-64.png" />
        <link rel="apple-touch-icon" sizes="192x192" href="/icons/icon-192.png" />
        <link rel="apple-touch-icon" sizes="512x512" href="/icons/icon-512.png" />
        {/* Splash screens für iOS */}
        <meta name="msapplication-TileImage" content="/icons/icon-144.png" />
        <meta name="msapplication-TileColor" content="#0a0a1a" />
      </Head>

      <div style={{ display:"flex", flexDirection:"column", height:"100dvh", background:"linear-gradient(180deg,#1a0d05 0%,#120800 100%)", overflow:"hidden" }}>

        {/* Header */}
        <header style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"0 16px", height:80, background:"linear-gradient(135deg,#3d1a06 0%,#4a2008 55%,#3a1a06 100%)", borderBottom:"2px solid rgba(249,115,22,0.7)", flexShrink:0, boxShadow:"0 3px 24px rgba(0,0,0,0.7),0 0 40px rgba(249,115,22,0.2)" }}>

          {/* Links: Logo mit Drive-Ring + Refresh/Re-Login */}
          <div style={{ display:"flex", alignItems:"center", gap:14 }}>
            <div
              onPointerDown={async (e) => {
                e.preventDefault();
                if (!session) { signIn("azure-ad"); return; }
                // Token-Check: kurzer Test-Request
                const test = await fetch("https://graph.microsoft.com/v1.0/me/drive/root", {
                  headers: { Authorization: `Bearer ${session.accessToken}` }
                });
                if (test.status === 401) {
                  // Token abgelaufen → neu einloggen
                  signIn("azure-ad");
                } else {
                  loadTracks(sessionRef.current);
                }
              }}
              title={session ? "Titel neu laden (bei 401 → Re-Login)" : "Anmelden"}
              style={{ position:"relative", cursor:"pointer", flexShrink:0 }}
            >
              <div style={{
                position:"absolute", inset:-4, borderRadius:16,
                border: session ? "3px solid #34c759" : "3px solid rgba(255,255,255,0.2)",
                boxShadow: session ? "0 0 12px rgba(52,199,89,0.7), inset 0 0 6px rgba(52,199,89,0.15)" : "none",
                pointerEvents:"none", transition:"border-color 0.4s, box-shadow 0.4s",
              }} />
              <img src="/icons/icon-64.png" alt="MusigPlayer"
                style={{ width:54, height:54, borderRadius:12, display:"block", boxShadow:"0 0 16px rgba(249,115,22,0.65)" }} />
              <span style={{
                position:"absolute", bottom:1, right:1,
                width:11, height:11, borderRadius:"50%",
                background: session ? "#34c759" : "rgba(255,255,255,0.25)",
                border:"2px solid #2a1205",
                boxShadow: session ? "0 0 6px rgba(52,199,89,0.9)" : "none",
                transition:"background 0.4s",
              }} />
            </div>

            {/* Schriftzug */}
            <div>
              <div style={{ fontSize:22, fontWeight:800, background:"linear-gradient(90deg,#f97316,#fb923c,#e11d48)", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent", letterSpacing:"-0.5px", lineHeight:1.1 }}>MusigPlayer</div>
              <div style={{ fontSize:11, color:"rgba(255,200,150,0.75)", marginTop:2, letterSpacing:"0.02em" }}>
                {session
                  ? `${session.provider === "azure-ad" ? "OneDrive" : "Google Drive"} · ${session.user?.name?.split(" ")[0] || ""}`
                  : "Kein Drive verbunden"}
              </div>
            </div>
          </div>

          {/* Rechts: immer sichtbar – Login oder Logout */}
          <div style={{ display:"flex", gap:8, alignItems:"center" }}>
            {session ? (
              <button
                onClick={() => signOut()}
                style={{ background:"rgba(255,255,255,0.08)", border:"1px solid rgba(255,200,150,0.3)", borderRadius:8, padding:"6px 14px", fontSize:12, cursor:"pointer", color:"rgba(255,200,150,0.8)", fontWeight:500 }}
              >Abmelden</button>
            ) : (
              <>
                <button onClick={() => signIn("google")} style={{ background:"rgba(255,255,255,0.08)", border:"1px solid rgba(255,255,255,0.15)", borderRadius:8, padding:"6px 10px", fontSize:11, cursor:"pointer", color:"rgba(255,255,255,0.7)" }}>Google</button>
                <button onClick={() => signIn("azure-ad")} style={{ background:"linear-gradient(135deg,#c0390b,#f97316)", border:"none", borderRadius:8, padding:"6px 12px", fontSize:11, cursor:"pointer", color:"#fff", fontWeight:600 }}>OneDrive</button>
              </>
            )}
          </div>
        </header>

        {/* Status bar – schmal */}
        <div style={{ display:"flex", alignItems:"center", gap:6, padding:"3px 16px", background:"rgba(50,22,6,0.98)", borderBottom:"1px solid rgba(249,115,22,0.4)", fontSize:11, color:"rgba(255,200,150,0.75)", flexShrink:0 }}>
          <span style={{ width:7, height:7, borderRadius:"50%", background: online ? "#34c759" : "#ff3b30", display:"inline-block", flexShrink:0 }} />
          <span style={{ fontWeight:600, color: online ? "#4ade80" : "#f87171" }}>{online ? "Online" : "Offline"}</span>
          {session && (<>
            <span style={{ color:"rgba(255,255,255,0.2)" }}>·</span>
            <span>{session.provider === "azure-ad" ? "☁️ OneDrive" : "☁️ Google Drive"}</span>
            <span style={{ color:"rgba(255,255,255,0.2)" }}>·</span>
            {loading ? <span>Lade…</span> : <>
              <span>{allTracks.length} Titel</span>
              <button onPointerDown={async (e) => {
                  e.preventDefault();
                  const s = sessionRef.current;
                  if (!s?.accessToken) return;
                  const test = await fetch("https://graph.microsoft.com/v1.0/me/drive/root", { headers: { Authorization: `Bearer ${s.accessToken}` } });
                  if (test.status === 401) { signIn("azure-ad"); } else { loadTracks(s); }
                }} disabled={loading || tagsLoading}
                style={{ background:"rgba(255,255,255,0.08)", border:"1px solid rgba(255,255,255,0.2)", borderRadius:5, padding:"1px 7px", fontSize:11, cursor:"pointer", color:"rgba(255,220,180,0.8)", marginLeft:2 }}>↻</button>
            </>}
          </>)}
          {!session && <span>Kein Cloud-Laufwerk verbunden</span>}
        </div>

        {/* Now Playing Bar – eigene Zeile, volle Breite */}
        {currentTrack && (
          <div style={{ display:"flex", alignItems:"center", gap:12, padding:"8px 16px", background:"linear-gradient(90deg,rgba(192,57,11,0.25),rgba(249,115,22,0.15))", borderBottom:"2px solid rgba(249,115,22,0.7)", flexShrink:0 }}>
            {currentTrack.coverUrl
              ? <img src={currentTrack.coverUrl} alt="" style={{ width:40, height:40, borderRadius:6, objectFit:"cover", flexShrink:0, boxShadow:"0 2px 8px rgba(0,0,0,0.5)" }} />
              : <div style={{ width:40, height:40, borderRadius:6, background:"rgba(249,115,22,0.25)", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, fontSize:20 }}>🎵</div>
            }
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:15, fontWeight:700, color:"#fed7aa", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", lineHeight:1.35 }}>
                {currentTrack.title || currentTrack.name?.replace(/\.[^.]+$/, "")}
              </div>
              <div style={{ fontSize:12, color:"rgba(255,255,255,0.5)", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", lineHeight:1.3 }}>
                {currentTrack.artist || "—"}{currentTrack.album ? ` · ${currentTrack.album}` : ""}
              </div>
            </div>
            <div onPointerDown={(e) => { e.preventDefault(); dispatch({ type:"TOGGLE_PLAY" }); }}
              style={{ flexShrink:0, width:36, height:36, borderRadius:"50%", background:"rgba(255,255,255,0.08)", border:"1px solid rgba(255,255,255,0.2)", display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", fontSize:16, color:"rgba(255,220,180,0.9)" }}>
              {state.isPlaying ? "⏸" : "▶"}
            </div>
          </div>
        )}

        {/* iPod - full remaining space */}
        <div style={{ flex:1, overflow:"auto", display:"flex", alignItems:"center", justifyContent:"center" }}>
          {!session ? (
            <div style={{ textAlign:"center", padding:"2rem" }}>
              <img src="/icons/icon-128.png" alt="" style={{ width:96, height:96, borderRadius:22, marginBottom:16, boxShadow:"0 0 40px rgba(249,115,22,0.7)" }} />
              <h1 style={{ fontSize:28, fontWeight:700, background:"linear-gradient(90deg,#f97316,#e11d48)", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent", marginBottom:8 }}>MusigPlayer</h1>
              <p style={{ color:"rgba(255,200,150,0.75)", marginBottom:24 }}>Verbinde dein Cloud-Laufwerk um loszulegen.</p>
              <div style={{ display:"flex", gap:12, justifyContent:"center", flexWrap:"wrap" }}>
                <button onClick={() => signIn("google")} style={{ background:"rgba(255,255,255,0.1)", color:"#fff", border:"1px solid rgba(255,255,255,0.2)", borderRadius:10, padding:"12px 24px", fontSize:14, fontWeight:500, cursor:"pointer" }}>Google Drive</button>
                <button onClick={() => signIn("azure-ad")} style={{ background:"linear-gradient(135deg,#c0390b,#f97316)", color:"#fff", border:"none", borderRadius:10, padding:"12px 24px", fontSize:14, fontWeight:500, cursor:"pointer" }}>OneDrive</button>
              </div>
            </div>
          ) : (
            <IpodPlayer
              state={state}
              dispatch={dispatch}
              currentTrack={currentTrack}
              seek={seek}
              tracks={allTracks}
              onPlayIndex={handlePlay}
              onPlayAll={handlePlayAll}
              playlists={playlists}
              onPlayPlaylist={handlePlayPlaylist}
              onCreatePlaylist={handleCreatePlaylist}
              onDeletePlaylist={handleDeletePlaylist}
            />
          )}
        </div>
      </div>
    </>
  );
}
