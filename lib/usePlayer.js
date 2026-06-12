import { useReducer, useRef, useEffect, useCallback } from "react";

export const REPEAT = { NONE: "none", ONE: "one", ALL: "all" };

const initialState = {
  queue: [],
  currentIndex: -1,
  isPlaying: false,
  progress: 0,
  duration: 0,
  volume: 0.8,
  shuffle: false,
  repeat: REPEAT.NONE,
  shuffleOrder: [],
};

function buildShuffleOrder(length, currentIndex) {
  const arr = Array.from({ length }, (_, i) => i).filter((i) => i !== currentIndex);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  if (currentIndex >= 0) arr.unshift(currentIndex);
  return arr;
}

function reducer(state, action) {
  switch (action.type) {
    case "SET_QUEUE":
      return { ...state, queue: action.payload, currentIndex: action.startIndex ?? 0, isPlaying: true, progress: 0, shuffleOrder: buildShuffleOrder(action.payload.length, action.startIndex ?? 0) };
    case "PLAY_INDEX":
      return { ...state, currentIndex: action.payload, isPlaying: true, progress: 0 };
    case "TOGGLE_PLAY":
      return { ...state, isPlaying: !state.isPlaying };
    case "SET_PLAYING":
      return { ...state, isPlaying: action.payload };
    case "SET_PROGRESS":
      return { ...state, progress: action.payload };
    case "SET_DURATION":
      return { ...state, duration: action.payload };
    case "SET_VOLUME":
      return { ...state, volume: action.payload };
    case "TOGGLE_SHUFFLE": {
      const shuffle = !state.shuffle;
      return { ...state, shuffle, shuffleOrder: shuffle ? buildShuffleOrder(state.queue.length, state.currentIndex) : [] };
    }
    case "CYCLE_REPEAT": {
      const order = [REPEAT.NONE, REPEAT.ALL, REPEAT.ONE];
      return { ...state, repeat: order[(order.indexOf(state.repeat) + 1) % order.length] };
    }
    case "NEXT": {
      if (!state.queue.length) return state;
      if (state.repeat === REPEAT.ONE) return { ...state, progress: 0 };
      let next;
      if (state.shuffle) {
        const pos = state.shuffleOrder.indexOf(state.currentIndex);
        next = state.shuffleOrder[(pos + 1) % state.shuffleOrder.length];
      } else {
        next = (state.currentIndex + 1) % state.queue.length;
      }
      if (next === 0 && state.repeat === REPEAT.NONE && !state.shuffle)
        return { ...state, isPlaying: false };
      return { ...state, currentIndex: next, isPlaying: true, progress: 0 };
    }
    case "PREV": {
      if (!state.queue.length) return state;
      let prev;
      if (state.shuffle) {
        const pos = state.shuffleOrder.indexOf(state.currentIndex);
        prev = state.shuffleOrder[(pos - 1 + state.shuffleOrder.length) % state.shuffleOrder.length];
      } else {
        prev = (state.currentIndex - 1 + state.queue.length) % state.queue.length;
      }
      return { ...state, currentIndex: prev, isPlaying: true, progress: 0 };
    }
    default:
      return state;
  }
}

export function usePlayer() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const audioRef      = useRef(null);
  const mountedRef    = useRef(false);
  const getFreshUrlRef = useRef(null);
  const stateRef      = useRef(null);

  // ── Audio init ────────────────────────────────────────────────────────────
  useEffect(() => {
    mountedRef.current = true;
    audioRef.current = new Audio();
    audioRef.current.volume = 0.8;
    const audio = audioRef.current;

    const onTime     = () => dispatch({ type: "SET_PROGRESS", payload: audio.currentTime });
    const onDuration = () => dispatch({ type: "SET_DURATION", payload: audio.duration });
    const onEnded    = () => {
      const s = stateRef.current;
      if (s && s.repeat === "one") {
        audio.currentTime = 0;
        audio.play().catch(() => {});
      } else {
        dispatch({ type: "NEXT" });
      }
    };
    const onPlay  = () => dispatch({ type: "SET_PLAYING", payload: true });
    const onPause = () => dispatch({ type: "SET_PLAYING", payload: false });

    audio.addEventListener("timeupdate",    onTime);
    audio.addEventListener("durationchange",onDuration);
    audio.addEventListener("ended",         onEnded);
    audio.addEventListener("play",          onPlay);
    audio.addEventListener("pause",         onPause);

    return () => {
      mountedRef.current = false;
      audio.removeEventListener("timeupdate",    onTime);
      audio.removeEventListener("durationchange",onDuration);
      audio.removeEventListener("ended",         onEnded);
      audio.removeEventListener("play",          onPlay);
      audio.removeEventListener("pause",         onPause);
      audio.pause();
    };
  }, []);

  // ── Track laden ───────────────────────────────────────────────────────────
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !mountedRef.current) return;
    const track = state.queue[state.currentIndex];
    if (!track) return;

    async function loadTrack() {
      // 1. Media Session sofort auf "playing" halten – verhindert Lockscreen-Flicker
      if (typeof window !== "undefined" && "mediaSession" in navigator) {
        navigator.mediaSession.playbackState = "playing";
        // Metadata SOFORT vor dem Laden setzen → kein Lücke im Lockscreen
        if ("MediaMetadata" in window) {
          const artwork = track.coverUrl
            ? [{ src: track.coverUrl, sizes: "512x512", type: "image/jpeg" }]
            : [];
          navigator.mediaSession.metadata = new MediaMetadata({
            title:  track.title  || track.name?.replace(/\.[^.]+$/, "") || "Unbekannt",
            artist: track.artist || "Unbekannter Interpret",
            album:  track.album  || "",
            artwork,
          });
        }
      }
      // 2. URL holen und laden
      let url = null;
      if (getFreshUrlRef.current) {
        try { url = await getFreshUrlRef.current(track); } catch {}
      }
      if (!url) url = track.streamUrl;
      if (!url) return;
      audio.src = url;
      audio.load();
      audio.play().catch(() => {});
    }
    loadTrack();
  }, [state.currentIndex]);

  // ── Play/Pause ────────────────────────────────────────────────────────────
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !mountedRef.current) return;
    if (state.isPlaying) audio.play().catch(() => {});
    else audio.pause();
  }, [state.isPlaying]);

  // ── Volume ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = state.volume;
  }, [state.volume]);

  // ── Media Session API – Action Handlers ──────────────────────────────────
  useEffect(() => {
    if (typeof window === "undefined" || !("mediaSession" in navigator)) return;

    navigator.mediaSession.setActionHandler("play", () => {
      dispatch({ type: "SET_PLAYING", payload: true });
    });
    navigator.mediaSession.setActionHandler("pause", () => {
      dispatch({ type: "SET_PLAYING", payload: false });
    });
    navigator.mediaSession.setActionHandler("previoustrack", () => {
      const s = stateRef.current;
      if (s && s.progress > 3) {
        if (audioRef.current) audioRef.current.currentTime = 0;
        dispatch({ type: "SET_PROGRESS", payload: 0 });
      } else {
        dispatch({ type: "PREV" });
      }
    });
    navigator.mediaSession.setActionHandler("nexttrack", () => {
      dispatch({ type: "NEXT" });
    });
    navigator.mediaSession.setActionHandler("seekto", (details) => {
      if (audioRef.current && details.seekTime != null) {
        audioRef.current.currentTime = details.seekTime;
        dispatch({ type: "SET_PROGRESS", payload: details.seekTime });
      }
    });
  }, []);

  // ── Playback-State sync → Media Session ──────────────────────────────────
  useEffect(() => {
    if (typeof window === "undefined" || !("mediaSession" in navigator)) return;
    navigator.mediaSession.playbackState = state.isPlaying ? "playing" : "paused";
  }, [state.isPlaying]);

  // ── Position-State sync (für Fortschrittsbalken im Lockscreen) ───────────
  useEffect(() => {
    if (typeof window === "undefined" || !("mediaSession" in navigator)) return;
    // Nur updaten wenn Duration valide und > 0 – verhindert Reset-Flicker beim Trackvechsel
    if (!state.duration || state.duration < 1 || !audioRef.current) return;
    const pos = Math.min(Math.max(state.progress, 0), state.duration);
    try {
      navigator.mediaSession.setPositionState({
        duration:     state.duration,
        playbackRate: audioRef.current.playbackRate || 1,
        position:     pos,
      });
    } catch {}
  }, [state.progress, state.duration]);

  stateRef.current = state;
  const currentTrack = state.currentIndex >= 0 ? state.queue[state.currentIndex] : null;

  return { state, dispatch, currentTrack, seek: useCallback((time) => {
    if (audioRef.current) audioRef.current.currentTime = time;
    dispatch({ type: "SET_PROGRESS", payload: time });
  }, []), audioRef, getFreshUrlRef };
}
