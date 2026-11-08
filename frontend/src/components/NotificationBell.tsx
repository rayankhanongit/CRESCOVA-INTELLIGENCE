import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { fmtDate } from "../lib/format";
import type { AppNotification } from "../lib/types";

/** In-app notifications only: the list is built from your own stored data and nothing is sent outside the app. */
export default function NotificationBell() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const q = useQuery({ queryKey: ["notifications"], queryFn: () => api<{ unread: number; items: AppNotification[] }>("/notifications"), refetchInterval: 60_000, retry: false });
  useEffect(() => {
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  const unread = q.data?.unread ?? 0;
  const refresh = () => qc.invalidateQueries({ queryKey: ["notifications"] });
  const go = async (n: AppNotification) => { if (!n.read_at) await api(`/notifications/${n.id}/read`, { method: "POST" }); refresh(); setOpen(false); if (n.link) nav(n.link); };

  return (
    <div className="relative" ref={box}>
      <button onClick={() => setOpen(!open)} aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"} aria-expanded={open} className="relative rounded-lg p-2 text-muted hover:bg-surface2">
        <Bell className="size-[18px]" />
        {unread > 0 && <span className="num absolute right-0.5 top-0.5 grid min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] font-semibold leading-4 text-white">{unread > 99 ? "99+" : unread}</span>}
      </button>
      {open && (
        <div role="dialog" aria-label="Notifications" className="absolute right-0 z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5"><span className="text-sm font-semibold">Notifications</span>
            <button className="text-xs text-accent hover:underline disabled:text-muted disabled:no-underline" disabled={!unread} onClick={async () => { await api("/notifications/read-all", { method: "POST" }); refresh(); }}>Mark all read</button></div>
          <ul className="max-h-96 overflow-y-auto">
            {!q.data?.items.length && <li className="px-4 py-6 text-center text-sm text-muted">You're all caught up.</li>}
            {q.data?.items.map((n) => (
              <li key={n.id}><button onClick={() => go(n)} className={`block w-full border-b border-line px-4 py-2.5 text-left text-sm last:border-b-0 hover:bg-surface2 ${n.read_at ? "text-muted" : ""}`}>
                <span className={n.read_at ? "" : "font-medium"}>{n.title}</span><span className="block text-xs text-muted">{fmtDate(n.created_at)}</span></button></li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
