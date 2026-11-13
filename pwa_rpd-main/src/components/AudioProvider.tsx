"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

export type AudioTrack = { id: string; url: string; title: string; kind: "radio" | "podcast" };
type Player = {
  track: AudioTrack | null; isPlaying: boolean; currentTime: number; duration: number; error: string;
  play: (track?: AudioTrack) => Promise<void>; pause: () => void; seek: (time: number) => void;
};
const AudioContext = createContext<Player | null>(null);

export function AudioProvider({ children }: { children: ReactNode }) {
  const audio = useRef<HTMLAudioElement>(null);
  const selected = useRef<AudioTrack | null>(null);
  const [track, setTrack] = useState<AudioTrack | null>(null);
  const [isPlaying, setPlaying] = useState(false);
  const [currentTime, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState("");

  const pause = () => audio.current?.pause();
  const seek = (time: number) => {
    const element = audio.current;
    if (element && selected.current?.kind === "podcast" && Number.isFinite(element.duration)) {
      element.currentTime = Math.max(0, Math.min(element.duration, time));
    }
  };
  const play = async (next?: AudioTrack) => {
    const element = audio.current;
    if (!element) return;
    if (next && next.id === selected.current?.id && !element.paused) { pause(); return; }
    if (next && (next.id !== selected.current?.id || element.error)) {
      element.pause();
      selected.current = next;
      setTrack(next); setTime(0); setDuration(0);
      element.src = next.url;
    }
    if (!selected.current) return;
    const requested = selected.current;
    setError("");
    try {
      // Progressive enhancement: unsupported browsers keep native HTML audio.
      const nav = navigator as Navigator & { audioSession?: { type: string } };
      try { if (nav.audioSession) nav.audioSession.type = "playback"; } catch { /* optional */ }
      await element.play();
    } catch {
      if (selected.current === requested) setError("Audio belum bisa diputar. Periksa koneksi lalu coba lagi.");
    }
  };

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    const session = navigator.mediaSession;
    if (track && typeof MediaMetadata !== "undefined") {
      session.metadata = new MediaMetadata({ title: track.title, artist: "Radio PPI Dunia", album: track.kind === "podcast" ? "Podcast RPD" : "Radio Live", artwork: [{ src: "/rpd-icon-512.png", sizes: "512x512", type: "image/png" }] });
    }
    const handlers: Partial<Record<MediaSessionAction, MediaSessionActionHandler>> = {
      play: () => { void play(); }, pause, stop: pause,
      ...(track?.kind === "podcast" ? {
        seekto: (details: MediaSessionActionDetails) => seek(details.seekTime ?? 0),
        seekbackward: (details: MediaSessionActionDetails) => seek((audio.current?.currentTime || 0) - (details.seekOffset || 10)),
        seekforward: (details: MediaSessionActionDetails) => seek((audio.current?.currentTime || 0) + (details.seekOffset || 10)),
      } : {}),
    };
    const actions: MediaSessionAction[] = ["play", "pause", "stop", "seekto", "seekbackward", "seekforward"];
    for (const action of actions) { try { session.setActionHandler(action, handlers[action] || null); } catch { /* unsupported action */ } }
    return () => { for (const action of actions) { try { session.setActionHandler(action, null); } catch { /* unsupported */ } } };
    // Handlers read the persistent audio element and current track refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track]);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
    try {
      if (track?.kind === "podcast" && duration > 0 && Number.isFinite(duration)) {
        navigator.mediaSession.setPositionState({ duration, playbackRate: 1, position: Math.min(currentTime, duration) });
      } else navigator.mediaSession.setPositionState();
    } catch { /* position reporting is optional */ }
  }, [isPlaying, currentTime, duration, track]);

  return <AudioContext.Provider value={{ track, isPlaying, currentTime, duration, error, play, pause, seek }}>
    {children}
    <audio ref={audio} preload="none" playsInline className="hidden"
      onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
      onTimeUpdate={() => setTime(audio.current?.currentTime || 0)}
      onLoadedMetadata={() => setDuration(audio.current?.duration || 0)}
      onError={() => { setPlaying(false); setError("Audio terputus. Periksa koneksi lalu tekan putar kembali."); }} />
  </AudioContext.Provider>;
}

export function useAudioPlayer() {
  const player = useContext(AudioContext);
  if (!player) throw new Error("AudioProvider is required");
  return player;
}
