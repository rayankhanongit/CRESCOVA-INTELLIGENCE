import { useQueryClient } from "@tanstack/react-query";
import { BarChart3, CalendarDays, ChevronsLeft, ChevronsRight, FileText, Globe, History, KeyRound, LayoutDashboard, ListChecks, LogOut, Menu, Moon, ScanSearch, Settings as Cog, Sun, Swords, UserCheck, Users, Wand2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { api } from "../lib/api";
import { useTheme } from "../lib/theme";
import type { User } from "../lib/types";

interface Item { label: string; icon: ReactNode; to?: string; phase?: string }
const I = "size-[18px] shrink-0";

// Items without `to` are planned modules: shown disabled and labelled with the phase that delivers them.
export const NAV: Item[] = [
  { label: "Overview", icon: <LayoutDashboard className={I} />, to: "/" },
  { label: "Websites", icon: <Globe className={I} />, to: "/websites" },
  { label: "SEO Audits", icon: <ScanSearch className={I} />, to: "/audits" },
  { label: "Keyword Intelligence", icon: <KeyRound className={I} />, phase: "Phase C" },
  { label: "Competitor Analysis", icon: <Swords className={I} />, phase: "Phase C" },
  { label: "SEO History", icon: <History className={I} />, to: "/history" },
  { label: "Leads CRM", icon: <Users className={I} />, phase: "Phase D" },
  { label: "Clients", icon: <UserCheck className={I} />, phase: "Phase D" },
  { label: "Proposals", icon: <FileText className={I} />, phase: "Phase D" },
  { label: "Content Calendar", icon: <CalendarDays className={I} />, phase: "Phase E" },
  { label: "AI Content Studio", icon: <Wand2 className={I} />, phase: "Phase C" },
  { label: "Reports", icon: <BarChart3 className={I} />, phase: "Phase E" },
  { label: "Tasks & Reminders", icon: <ListChecks className={I} />, phase: "Phase D" },
  { label: "Settings", icon: <Cog className={I} />, to: "/settings" },
];

function Brand({ collapsed }: { collapsed: boolean }) {
  return (
    <div className="flex h-16 items-center gap-3 px-4">
      <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent text-accentfg">
        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 18V6l7 8 7-8v12" /></svg>
      </div>
      {!collapsed && <div className="leading-tight"><div className="font-display text-[15px] font-semibold tracking-tight">Crescova</div><div className="text-[11px] uppercase tracking-[0.14em] text-muted">Intelligence</div></div>}
    </div>
  );
}

export function Sidebar({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  return (
    <nav aria-label="Main" className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-4">
      {NAV.map((it) =>
        it.to ? (
          <NavLink key={it.label} to={it.to} end={it.to === "/"} onClick={onNavigate} title={collapsed ? it.label : undefined}
            className={({ isActive }) => `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${isActive ? "bg-accentsoft text-accent" : "text-muted hover:bg-surface2 hover:text-fg"}`}>
            {it.icon}{!collapsed && it.label}
          </NavLink>
        ) : (
          <div key={it.label} aria-disabled="true" title={`${it.label} — planned for ${it.phase}`} className="flex cursor-not-allowed items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted/60">
            {it.icon}
            {!collapsed && <><span className="flex-1">{it.label}</span><span className="rounded bg-surface2 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide">{it.phase}</span></>}
          </div>
        ),
      )}
    </nav>
  );
}

export default function Layout({ user }: { user: User }) {
  const { theme, toggle } = useTheme();
  const qc = useQueryClient();
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem("crescova-sidebar") === "1"; } catch { return false; } });
  const [open, setOpen] = useState(false);
  const setC = (v: boolean) => { setCollapsed(v); try { localStorage.setItem("crescova-sidebar", v ? "1" : "0"); } catch { /* ignore */ } };
  const logout = async () => { await api("/auth/logout", { method: "POST" }); qc.clear(); qc.setQueryData(["me"], null); };

  return (
    <div className="min-h-screen lg:flex">
      <aside className={`sticky top-0 hidden h-screen flex-col border-r border-line bg-surface transition-[width] lg:flex ${collapsed ? "w-[72px]" : "w-64"}`}>
        <Brand collapsed={collapsed} />
        <Sidebar collapsed={collapsed} />
        <button onClick={() => setC(!collapsed)} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} className="m-2 flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted hover:bg-surface2">
          {collapsed ? <ChevronsRight className={I} /> : <><ChevronsLeft className={I} />Collapse</>}
        </button>
      </aside>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-black/50" />
          <aside className="absolute inset-y-0 left-0 flex w-72 flex-col bg-surface" onClick={(e) => e.stopPropagation()}>
            <Brand collapsed={false} /><Sidebar collapsed={false} onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-line bg-bg/85 px-4 backdrop-blur sm:px-6">
          <button className="rounded-lg p-2 text-muted hover:bg-surface2 lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu"><Menu className="size-5" /></button>
          <div className="min-w-0 flex-1 truncate text-sm text-muted">{user.organisation_name}</div>
          <button onClick={toggle} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`} className="rounded-lg p-2 text-muted hover:bg-surface2">
            {theme === "dark" ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}
          </button>
          <span className="hidden text-sm sm:block">{user.full_name}</span>
          <button onClick={logout} aria-label="Sign out" className="rounded-lg p-2 text-muted hover:bg-surface2"><LogOut className="size-[18px]" /></button>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 p-4 sm:p-6"><Outlet /></main>
      </div>
    </div>
  );
}
