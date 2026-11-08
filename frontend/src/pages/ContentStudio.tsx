import { useQuery } from "@tanstack/react-query";
import { Pencil, RefreshCw, Save, Sparkles, Trash2, Wand2 } from "lucide-react";
import { useState } from "react";
import { AiBadge, AiNotice, useAi } from "../components/Ai";
import FormModal from "../components/FormModal";
import { Badge, Button, Card, Confirm, ErrorState, Field, Input, PageHeader, SectionTitle, Select, Spinner, Textarea } from "../components/ui";
import { api } from "../lib/api";
import { cap, useAction } from "../lib/crm";
import { fmtDate } from "../lib/format";
import type { Client, ContentEntry, ContentKind } from "../lib/types";

export const KIND_LABEL: Record<ContentKind, string> = {
  blog_article: "Blog article", seo_page: "SEO page content", instagram_caption: "Instagram caption", facebook_post: "Facebook post", linkedin_post: "LinkedIn post",
  video_script: "Short-form video script", content_ideas: "Content ideas", content_calendar: "Content calendar", meta_title: "Meta titles", meta_description: "Meta descriptions",
  faq: "FAQs", service_description: "Website service description",
};
const STATUSES = ["idea", "draft", "in_review", "approved", "scheduled", "published"];
const SOCIAL: Partial<Record<ContentKind, string>> = { instagram_caption: "Instagram", facebook_post: "Facebook", linkedin_post: "LinkedIn", video_script: "Short-form video" };

interface Brief { kind: ContentKind; topic: string; audience: string; brand_voice: string; platform: string; keywords: string; length: string; objective: string }
const blank: Brief = { kind: "blog_article", topic: "", audience: "", brand_voice: "", platform: "", keywords: "", length: "", objective: "" };

export default function ContentStudio() {
  const ai = useAi();
  const [brief, setBrief] = useState<Brief>(blank);
  const [text, setText] = useState("");
  const [fromAi, setFromAi] = useState(false);
  const [title, setTitle] = useState("");
  const [clientId, setClientId] = useState("");
  const [revise, setRevise] = useState("");
  const [edit, setEdit] = useState<ContentEntry | null>(null);
  const [del, setDel] = useState<ContentEntry | null>(null);
  const clients = useQuery({ queryKey: ["clients", ""], queryFn: () => api<Client[]>("/clients") });
  const drafts = useQuery({ queryKey: ["content"], queryFn: () => api<ContentEntry[]>("/content") });
  const set = (k: keyof Brief) => (e: { target: { value: string } }) => setBrief({ ...brief, [k]: e.target.value });

  const generate = useAction((withRevision: boolean) => api<{ text: string }>("/content/generate", { method: "POST", body: { ...brief, platform: brief.platform || SOCIAL[brief.kind] || "", ...(withRevision ? { previous_text: text, revise_instruction: revise } : {}) } }),
    { invalidate: ["usage"], done: (r) => { setText(r.text); setFromAi(true); setRevise(""); if (!title) setTitle(brief.topic.slice(0, 80)); } });
  const save = useAction(() => api("/content", { method: "POST", body: { title: title || brief.topic.slice(0, 80) || "Untitled", kind: brief.kind, platform: brief.platform || SOCIAL[brief.kind] || "", body: text, params: brief, ai_generated: fromAi, status: "draft", client_id: clientId ? Number(clientId) : null } }),
    { invalidate: ["content"], ok: "Draft saved" });
  const update = useAction((p: { id: number; body: Record<string, unknown> }) => api(`/content/${p.id}`, { method: "PATCH", body: p.body }), { invalidate: ["content"], ok: "Draft updated" });
  const remove = useAction((e: ContentEntry) => api(`/content/${e.id}`, { method: "DELETE" }), { invalidate: ["content"], ok: "Draft deleted", done: () => setDel(null) });
  const canGenerate = ai.configured && brief.topic.trim().length > 0;

  return (
    <>
      <PageHeader title="AI Content Studio" subtitle="Draft, revise and save content. Output is a starting point for a person to edit. Nothing is published anywhere." />
      <AiNotice />
      <div className="grid gap-4 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <Card>
          <SectionTitle>Brief</SectionTitle>
          <div className="space-y-3">
            <Field label="Content type">{(id) => <Select id={id} value={brief.kind} onChange={set("kind")}>{(Object.keys(KIND_LABEL) as ContentKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</Select>}</Field>
            <Field label="Topic *">{(id) => <Textarea id={id} value={brief.topic} onChange={set("topic")} placeholder="What should it be about?" />}</Field>
            <Field label="Target audience">{(id) => <Input id={id} value={brief.audience} onChange={set("audience")} />}</Field>
            <Field label="Brand voice">{(id) => <Input id={id} value={brief.brand_voice} onChange={set("brand_voice")} placeholder="Friendly, expert, concise…" />}</Field>
            {!SOCIAL[brief.kind] && <Field label="Platform (optional)">{(id) => <Input id={id} value={brief.platform} onChange={set("platform")} />}</Field>}
            <Field label="Keywords to include">{(id) => <Input id={id} value={brief.keywords} onChange={set("keywords")} />}</Field>
            <Field label="Desired length">{(id) => <Input id={id} value={brief.length} onChange={set("length")} placeholder="e.g. about 600 words" />}</Field>
            <Field label="Objective">{(id) => <Input id={id} value={brief.objective} onChange={set("objective")} placeholder="e.g. get enquiries" />}</Field>
            <Button variant="primary" className="w-full" busy={generate.isPending} disabled={!canGenerate} title={ai.configured ? undefined : "AI is not configured"} onClick={() => generate.mutate(false)}><Wand2 className="size-4" />Generate</Button>
          </div>
        </Card>

        <Card>
          <SectionTitle aside={fromAi ? <AiBadge /> : undefined}>Draft</SectionTitle>
          <Textarea aria-label="Draft text" className="min-h-72 font-sans" value={text} onChange={(e) => { setText(e.target.value); }} placeholder="Generated text appears here. You can also type or paste your own. It's fully editable." />
          {fromAi && <p className="mt-1 text-xs text-muted">AI-generated. Check facts, names, claims and tone before using it.</p>}
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <div className="min-w-48 flex-1"><Field label="Revise with AI">{(id) => <Input id={id} value={revise} onChange={(e) => setRevise(e.target.value)} placeholder="e.g. make it shorter and friendlier" />}</Field></div>
            <Button busy={generate.isPending} disabled={!canGenerate || !text.trim() || !revise.trim()} onClick={() => generate.mutate(true)}><Sparkles className="size-4" />Revise</Button>
            <Button busy={generate.isPending} disabled={!canGenerate} onClick={() => generate.mutate(false)}><RefreshCw className="size-4" />Regenerate</Button>
          </div>
          <div className="mt-4 grid gap-3 border-t border-line pt-4 sm:grid-cols-[1fr_12rem_auto] sm:items-end">
            <Field label="Title">{(id) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} />}</Field>
            <Field label="Client (optional)">{(id) => <Select id={id} value={clientId} onChange={(e) => setClientId(e.target.value)}><option value="">None</option>{(clients.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>}</Field>
            <Button variant="primary" busy={save.isPending} disabled={!text.trim()} onClick={() => save.mutate()}><Save className="size-4" />Save draft</Button>
          </div>
        </Card>
      </div>

      <div className="mt-6">
        <SectionTitle>Saved content</SectionTitle>
        {drafts.isLoading ? <Spinner /> : drafts.error ? <ErrorState error={drafts.error} retry={drafts.refetch} /> : !drafts.data?.length ? <p className="text-sm text-muted">Nothing saved yet.</p> : (
          <Card pad={false}>
            <ul className="divide-y divide-line">
              {drafts.data.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                  <div className="min-w-0 flex-1"><div className="truncate font-medium">{e.title}</div><div className="text-xs text-muted">{KIND_LABEL[e.kind]}{e.platform ? ` · ${e.platform}` : ""}{clients.data?.find((c) => c.id === e.client_id) ? ` · ${clients.data.find((c) => c.id === e.client_id)!.name}` : ""}</div></div>
                  {e.ai_generated && <AiBadge label="AI draft" />}
                  <Select aria-label={`Status of ${e.title}`} className="!w-auto !py-1 text-xs" value={e.status} onChange={(ev) => update.mutate({ id: e.id, body: { status: ev.target.value } })}>{STATUSES.map((s) => <option key={s} value={s}>{cap(s)}</option>)}</Select>
                  <Badge>{fmtDate(e.publish_date)}</Badge>
                  <Button size="sm" variant="ghost" aria-label={`Edit ${e.title}`} onClick={() => setEdit(e)}><Pencil className="size-3.5" /></Button>
                  <Button size="sm" variant="ghost" aria-label={`Delete ${e.title}`} onClick={() => setDel(e)}><Trash2 className="size-3.5" /></Button>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
      {edit && <FormModal title="Edit content" submitLabel="Save changes" initial={{ ...edit }} onClose={() => setEdit(null)} onSubmit={(b) => update.mutateAsync({ id: edit.id, body: b })}
        fields={[{ key: "title", label: "Title", required: true, wide: true }, { key: "body", label: "Text", kind: "textarea" }]} />}
      {del && <Confirm title="Delete this content?" confirmLabel="Delete" busy={remove.isPending} onCancel={() => setDel(null)} onConfirm={() => remove.mutate(del)} body={<>“{del.title}” will be permanently deleted.</>} />}
    </>
  );
}
