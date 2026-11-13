"use client";
import { useEffect, useState } from "react";

export default function PwaUpdates() {
  const [updated, setUpdated] = useState(false);
  useEffect(() => {
    if (!('serviceWorker' in navigator) || window.location.hostname === 'localhost') return;
    let disposed = false;
    const hadController = !!navigator.serviceWorker.controller;
    const onChange = () => { if (hadController && !disposed) setUpdated(true); };
    navigator.serviceWorker.addEventListener('controllerchange', onChange);
    let registration: ServiceWorkerRegistration | undefined;
    const check = () => { if (document.visibilityState === 'visible') void registration?.update().catch(() => {}); };
    void navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then(result => {
      registration = result;
      if (!disposed) check();
    }).catch(() => { /* retry installation on next visit */ });
    document.addEventListener('visibilitychange', check);
    return () => { disposed = true; navigator.serviceWorker.removeEventListener('controllerchange', onChange); document.removeEventListener('visibilitychange', check); };
  }, []);
  if (!updated) return null;
  return <div role="status" className="fixed top-4 left-4 right-4 z-[200] mx-auto max-w-lg rounded-xl bg-white text-black p-4 shadow-xl">
    <p>Versi baru tersedia. Muat ulang akan menghentikan audio sementara.</p>
    <button className="font-bold underline mr-4" onClick={() => window.location.reload()}>Muat ulang</button>
    <button className="underline" onClick={() => setUpdated(false)}>Nanti</button>
  </div>;
}
