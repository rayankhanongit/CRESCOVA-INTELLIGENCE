import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Globe, Pencil, Plus, ScanSearch, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { fmtDate, hostOf } from "../lib/format";
import type { Website } from "../lib/types";
import { Button, Card, Confirm, EmptyState, ErrorState, Field, Input, Modal, PageHeader, ScoreRing, Select, Spinner, Textarea, useToast } from "../components/ui";

const PLATFORMS = ["", "WordPress", "Shopify", "Wix", "Squarespace", "Webflow", "Custom / code", "Other"];
type Draft = Pick<Website, "name" | "url" | "category" | "target_audience" | "market" | "platform" | "description">;
const blank: Draft = { name: "", url: "", category: "", target_audience: "", market: "", platform: "", description: "" };

export function WebsiteForm({ initial, onClose }: { initial?: Website; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [d, setD] = useState<Draft>(initial ? { ...initial } : blank);
  const [err, setErr] = useState<Record<string, string>>({});
  const [serverErr, setServerErr] = useState<string | null>(null);
  const set = (k: keyof Draft) => (e: { target: { value: string } }) => setD((x) => ({ ...x, [k]: e.target.value }));

  const save = useMutation({
    mutationFn: () => initial
      ? api<Website>(`/websites/${initial.id}`, { method: "PATCH", body: { ...d, url: undefined } })
      : api<Website>("/websites", { method: "POST", body: d }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["websites"] }); qc.invalidateQueries({ queryKey: ["website"] }); qc.invalidateQueries({ queryKey: ["overview"] });
      toast("success", initial ? "Website updated" : "Website added");
      onClose();
    },
    onError: (e: Error) => setServerErr(e.message),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!d.name.trim()) next.name = "Enter a name.";
    if (!initial && !/^(https?:\/\/)?[^\s/$.?#][^\s]*\.[^\s]{2,}/i.test(d.url.trim())) next.url = "Enter a valid address, e.g. example.com";
    setErr(next);
    setServerErr(null);
    if (!Object.keys(next).length) save.mutate();
  }

  return (
    <Modal title={initial ? "Edit website" : "Add website"} onClose={onClose} wide>
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
        <Field label="Website name" error={err.name}>{(id) => <Input id={id} value={d.name} onChange={set("name")} placeholder="Acme Plumbing" />}</Field>
        <Field label="Website URL" error={err.url} hint={initial ? "The address can't be changed. Add a new website instead." : "Public sites only. Private and internal addresses are rejected."}>
          {(id) => <Input id={id} value={d.url} onChange={set("url")} disabled={!!initial}placeholder="https://example.com" inputMode="url" />}
        </Field>
        <Field label="Business category">{(id) => <Input id={id} value={d.category} onChange={set("category")} placeholder="Home services" />}</Field>
        <Field label="Platform">{(id) => <Select id={id} value={d.platform} onChange={set("platform")}>{PLATFORMS.map((p) => <option key={p} value={p}>{p || "Not specified"}</option>)}</Select>}</Field>
        <Field label="Primary market">{(id) => <Input id={id} value={d.market} onChange={set("market")} placeholder="Bengaluru, India" />}</Field>
        <Field label="Target audience">{(id) => <Input id={id} value={d.target_audience} onChange={set("target_audience")} placeholder="Homeowners aged 30–55" />}</Field>
        <div className="sm:col-span-2"><Field label="Project description">{(id) => <Textarea id={id} value={d.description} onChange={set("description")} />}</Field></div>
        {serverErr && <p role="alert" className="rounded-lg bg-dangersoft px-3 py-2 text-sm text-danger sm:col-span-2">{serverErr}</p>}
        <div className="flex justify-end gap-2 sm:col-span-2">
          <Button type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" busy={save.isPending}>{initial ? "Save changes" : "Add website"}</Button>
        </div>
      </form>
    </Modal>
  );
}

export function DeleteWebsite({ site, onClose, onDeleted }: { site: Website; onClose: () => void; onDeleted?: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const del = useMutation({
    mutationFn: () => api(`/websites/${site.id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries(); toast("success", `Deleted ${site.name}`); onClose(); onDeleted?.(); },
    onError: (e: Error) => toast("error", e.message),
  });
  return <Confirm title="Delete website?" confirmLabel="Delete website" busy={del.isPending} onCancel={onClose} onConfirm={() => del.mutate()}
    body={<>This permanently deletes <strong>{site.name}</strong> and all of its audits, pages and findings. This cannot be undone.</>} />;
}

export default function WebsitesPage() {
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["websites"], queryFn: () => api<Website[]>("/websites") });
  const [form, setForm] = useState<"new" | Website | null>(null);
  const [del, setDel] = useState<Website | null>(null);

  return (
    <>
      <PageHeader title="Websites" subtitle="Every site Crescova manages. Open one to audit it and review its history."
        actions={<Button variant="primary" onClick={() => setForm("new")}><Plus className="size-4" />Add website</Button>} />
      {isLoading ? <Spinner /> : error ? <ErrorState error={error} retry={refetch} /> : !data?.length ? (
        <EmptyState icon={<Globe className="size-6" />} title="No websites yet" body="Add a website to start crawling and auditing it." action={<Button variant="primary" onClick={() => setForm("new")}><Plus className="size-4" />Add website</Button>} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.map((w) => (
            <Card key={w.id} className="flex flex-col">
              <div className="flex items-start gap-4">
                <ScoreRing score={w.current_score} size={72} />
                <div className="min-w-0 flex-1">
                  <Link to={`/websites/${w.id}`} className="block truncate font-display text-lg font-semibold hover:text-accent">{w.name}</Link>
                  <div className="truncate text-sm text-muted">{hostOf(w.url)}</div>
                  <div className="mt-1 text-xs text-muted">{w.category || "Uncategorised"}{w.market ? ` · ${w.market}` : ""}</div>
                </div>
              </div>
              <div className="mt-4 flex items-center justify-between border-t border-line pt-3 text-xs text-muted">
                <span>{w.last_audit_at ? `Audited ${fmtDate(w.last_audit_at)}` : "Never audited"}</span>
                <div className="flex gap-1">
                  <Link to={`/websites/${w.id}`}><Button size="sm" variant="primary"><ScanSearch className="size-3.5" />Audit</Button></Link>
                  <Button size="sm" variant="ghost" aria-label={`Edit ${w.name}`} onClick={() => setForm(w)}><Pencil className="size-3.5" /></Button>
                  <Button size="sm" variant="ghost" aria-label={`Delete ${w.name}`} onClick={() => setDel(w)}><Trash2 className="size-3.5" /></Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
      {form && <WebsiteForm initial={form === "new" ? undefined : form} onClose={() => setForm(null)} />}
      {del && <DeleteWebsite site={del} onClose={() => setDel(null)} />}
    </>
  );
}
