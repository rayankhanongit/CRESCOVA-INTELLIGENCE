import { useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { api } from "../lib/api";
import type { User } from "../lib/types";
import { Button, Field, Input } from "../components/ui";

export default function Login() {
  const qc = useQueryClient();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [f, setF] = useState({ email: "", password: "", full_name: "", organisation_name: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (mode === "register" && f.password.length < 10) return setError("Password must be at least 10 characters.");
    setBusy(true);
    try {
      const user = await api<User>(`/auth/${mode}`, { method: "POST", body: mode === "login" ? { email: f.email, password: f.password } : f });
      qc.setQueryData(["me"], user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-[#0a0d13] p-12 text-[#e8ebf1] lg:flex">
        <div className="absolute inset-0 opacity-30" style={{ backgroundImage: "radial-gradient(circle at 20% 20%, #3ddc97 0, transparent 40%), radial-gradient(circle at 90% 80%, #1f3a5f 0, transparent 45%)" }} aria-hidden />
        <div className="relative flex items-center gap-3 font-display text-lg font-semibold">
          <span className="grid size-9 place-items-center rounded-xl bg-[#3ddc97] text-[#04140d]"><svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 18V6l7 8 7-8v12" /></svg></span>
          Crescova Intelligence
        </div>
        <div className="relative max-w-md">
          <h2 className="font-display text-4xl font-semibold leading-tight tracking-tight">Evidence first. Then insight.</h2>
          <p className="mt-4 text-[#8f98aa]">A real crawler and deterministic SEO engine produce the facts. Every score is explained, every finding is traceable to a URL.</p>
        </div>
        <p className="relative text-xs text-[#8f98aa]">Runs locally. Your data stays in your database.</p>
      </div>

      <div className="flex items-center justify-center p-6">
        <form onSubmit={submit} className="w-full max-w-sm space-y-4" noValidate>
          <div>
            <h1 className="font-display text-2xl font-semibold tracking-tight">{mode === "login" ? "Sign in" : "Create your agency workspace"}</h1>
            <p className="mt-1 text-sm text-muted">{mode === "login" ? "Welcome back." : "The first account becomes the workspace owner."}</p>
          </div>
          {mode === "register" && (
            <>
              <Field label="Your name">{(id) => <Input id={id} value={f.full_name} onChange={set("full_name")} autoComplete="name" required />}</Field>
              <Field label="Agency name">{(id) => <Input id={id} value={f.organisation_name} onChange={set("organisation_name")} autoComplete="organization" required />}</Field>
            </>
          )}
          <Field label="Email">{(id) => <Input id={id} type="email" value={f.email} onChange={set("email")} autoComplete="email" required />}</Field>
          <Field label="Password" hint={mode === "register" ? "At least 10 characters." : undefined}>
            {(id) => <Input id={id} type="password" value={f.password} onChange={set("password")} autoComplete={mode === "login" ? "current-password" : "new-password"} required />}
          </Field>
          {error && <p role="alert" className="rounded-lg bg-dangersoft px-3 py-2 text-sm text-danger">{error}</p>}
          <Button type="submit" variant="primary" busy={busy} className="w-full">{mode === "login" ? "Sign in" : "Create workspace"}</Button>
          <p className="text-center text-sm text-muted">
            {mode === "login" ? "New here?" : "Already have an account?"}{" "}
            <button type="button" className="font-medium text-accent hover:underline" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(null); }}>
              {mode === "login" ? "Create a workspace" : "Sign in"}
            </button>
          </p>
        </form>
      </div>
    </div>
  );
}
