import { AlertTriangle, CheckCircle2, Info, Loader2, X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { scoreTone } from "../lib/format";
import type { Severity } from "../lib/types";

const cx = (...c: (string | false | undefined | null)[]) => c.filter(Boolean).join(" ");

/* ---------- Buttons ---------- */
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger"; busy?: boolean; size?: "sm" | "md" };
export function Button({ variant = "secondary", busy, size = "md", className, children, disabled, ...rest }: BtnProps) {
  const styles = {
    primary: "bg-accent text-accentfg hover:brightness-110 border-transparent",
    secondary: "bg-surface text-fg border-line hover:bg-surface2",
    ghost: "bg-transparent text-muted border-transparent hover:bg-surface2 hover:text-fg",
    danger: "bg-danger text-white border-transparent hover:brightness-110",
  }[variant];
  return (
    <button {...rest} disabled={disabled || busy}
      className={cx("inline-flex items-center justify-center gap-2 rounded-lg border font-medium transition disabled:opacity-50 disabled:cursor-not-allowed", size === "sm" ? "px-2.5 py-1.5 text-xs" : "px-3.5 py-2 text-sm", styles, className)}>
      {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

/* ---------- Surfaces ---------- */
export function Card({ children, className, pad = true }: { children: ReactNode; className?: string; pad?: boolean }) {
  return <section className={cx("rounded-2xl border border-line bg-surface shadow-card", pad && "p-5", className)}>{children}</section>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="font-display text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">{children}</h2>
      {aside}
    </div>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "ok" | "warn" | "danger" | "muted" }) {
  const color = { ok: "text-ok", warn: "text-warn", danger: "text-danger", muted: "text-fg" }[tone ?? "muted"];
  return (
    <Card className="!p-4">
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className={cx("num mt-1 font-display text-3xl font-semibold leading-none", color)}>{value}</div>
      {hint && <div className="mt-2 text-xs text-muted">{hint}</div>}
    </Card>
  );
}

/* ---------- Badges ---------- */
export function Badge({ children, tone = "muted" }: { children: ReactNode; tone?: "ok" | "warn" | "danger" | "info" | "muted" | "accent" }) {
  const t = {
    ok: "bg-oksoft text-ok", warn: "bg-warnsoft text-warn", danger: "bg-dangersoft text-danger",
    info: "bg-infosoft text-info", accent: "bg-accentsoft text-accent", muted: "bg-surface2 text-muted border border-line",
  }[tone];
  return <span className={cx("inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium", t)}>{children}</span>;
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  const map = { critical: ["danger", "Critical"], warning: ["warn", "Warning"], info: ["info", "Opportunity"] } as const;
  return <Badge tone={map[severity][0]}>{map[severity][1]}</Badge>;
}

export function StatusBadge({ status }: { status: string }) {
  const tone = ({ completed: "ok", failed: "danger", running: "info", queued: "muted" } as const)[status as "completed"] ?? "muted";
  return <Badge tone={tone}>{status === "running" || status === "queued" ? <><Loader2 className="mr-1 size-3 animate-spin" aria-hidden />{status}</> : status}</Badge>;
}

/* ---------- Score ring ---------- */
export function ScoreRing({ score, size = 96, label = true }: { score: number | null | undefined; size?: number; label?: boolean }) {
  const r = 42, c = 2 * Math.PI * r, pct = score == null ? 0 : Math.max(0, Math.min(100, score));
  const tone = scoreTone(score);
  const stroke = { ok: "var(--ok)", warn: "var(--warn)", danger: "var(--danger)", muted: "var(--line)" }[tone];
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={score == null ? "No score yet" : `SEO health score ${score} out of 100`}>
      <svg viewBox="0 0 100 100" className="size-full -rotate-90">
        <circle cx="50" cy="50" r={r} fill="none" stroke="var(--line)" strokeWidth="9" />
        <circle cx="50" cy="50" r={r} fill="none" stroke={stroke} strokeWidth="9" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)} style={{ transition: "stroke-dashoffset .6s ease" }} />
      </svg>
      {label && (
        <div className="absolute inset-0 grid place-items-center">
          <span className="num font-display font-semibold" style={{ fontSize: size * 0.3 }}>{score == null ? "—" : Math.round(score)}</span>
        </div>
      )}
    </div>
  );
}

/* ---------- Form controls ---------- */
const field = "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-muted/70 focus:border-accent";
export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">{label}</label>
      {children(id)}
      {hint && !error && <p className="mt-1 text-xs text-muted">{hint}</p>}
      {error && <p role="alert" className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}
export const Input = (p: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={cx(field, p.className)} />;
export const Textarea = (p: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...p} className={cx(field, "min-h-20", p.className)} />;
export const Select = (p: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={cx(field, p.className)} />;

/* ---------- States ---------- */
export function Spinner({ label = "Loading…" }: { label?: string }) {
  return <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted" role="status"><Loader2 className="size-5 animate-spin" aria-hidden />{label}</div>;
}

export function EmptyState({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-line px-6 py-14 text-center">
      {icon && <div className="mb-3 grid size-12 place-items-center rounded-xl bg-accentsoft text-accent">{icon}</div>}
      <h2 className="font-display text-lg font-semibold">{title}</h2>
      {body && <p className="mt-1 max-w-md text-sm text-muted">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  return (
    <div role="alert" className="flex items-start gap-3 rounded-2xl border border-danger/30 bg-dangersoft p-4 text-sm text-danger">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="flex-1">{error instanceof Error ? error.message : "Something went wrong"}</div>
      {retry && <Button size="sm" onClick={retry}>Retry</Button>}
    </div>
  );
}

/* ---------- Modal ---------- */
export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("input,select,textarea,button")?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); prev?.focus(); };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/50 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className={cx("w-full rounded-2xl border border-line bg-surface p-6 shadow-card", wide ? "max-w-2xl" : "max-w-md")}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="Close dialog" className="rounded-md p-1 text-muted hover:bg-surface2"><X className="size-4" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Confirm({ title, body, confirmLabel, onConfirm, onCancel, busy }: { title: string; body: ReactNode; confirmLabel: string; onConfirm: () => void; onCancel: () => void; busy?: boolean }) {
  return (
    <Modal title={title} onClose={onCancel}>
      <p className="text-sm text-muted">{body}</p>
      <div className="mt-5 flex justify-end gap-2">
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant="danger" busy={busy} onClick={onConfirm}>{confirmLabel}</Button>
      </div>
    </Modal>
  );
}

/* ---------- Toasts ---------- */
type Toast = { id: number; kind: "success" | "error"; text: string };
const ToastCtx = createContext<(kind: Toast["kind"], text: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((kind: Toast["kind"], text: string) => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, kind, text }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), 4500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed bottom-4 right-4 z-[60] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className="flex items-start gap-2 rounded-xl border border-line bg-surface p-3 text-sm shadow-card">
            {t.kind === "success" ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" aria-hidden /> : <Info className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />}
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
