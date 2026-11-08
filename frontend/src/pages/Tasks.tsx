import { useQuery } from "@tanstack/react-query";
import { BellRing, ListChecks, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import FormModal, { type FieldDef } from "../components/FormModal";
import { Badge, Button, Card, Confirm, EmptyState, ErrorState, PageHeader, Select, Spinner } from "../components/ui";
import { api } from "../lib/api";
import { PRIORITIES, cap, todayStr, useAction } from "../lib/crm";
import { fmtDate } from "../lib/format";
import type { Client, Task, Website } from "../lib/types";

type State = "open" | "overdue" | "done" | "";
const plusDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

export default function TasksPage() {
  const [state, setState] = useState<State>("open");
  const [form, setForm] = useState<"new" | Task | null>(null);
  const [del, setDel] = useState<Task | null>(null);
  const tasks = useQuery({ queryKey: ["tasks", state], queryFn: () => api<Task[]>(`/tasks${state ? `?state=${state}` : ""}`) });
  const open = useQuery({ queryKey: ["tasks", "open-all"], queryFn: () => api<Task[]>("/tasks?state=open") });  // drives the reminder banner
  const team = useQuery({ queryKey: ["team"], queryFn: () => api<{ id: number; full_name: string }[]>("/team") });
  const sites = useQuery({ queryKey: ["websites"], queryFn: () => api<Website[]>("/websites") });
  const clients = useQuery({ queryKey: ["clients", ""], queryFn: () => api<Client[]>("/clients") });
  const inv = ["tasks", "overview"];
  const save = useAction((p: { id?: number; body: Record<string, unknown> }) => api(p.id ? `/tasks/${p.id}` : "/tasks", { method: p.id ? "PATCH" : "POST", body: p.body }), { invalidate: inv, ok: "Task saved" });
  const toggle = useAction((t: Task) => api(`/tasks/${t.id}`, { method: "PATCH", body: { done: !t.completed_at } }), { invalidate: inv });
  const remove = useAction((t: Task) => api(`/tasks/${t.id}`, { method: "DELETE" }), { invalidate: inv, ok: "Task deleted", done: () => setDel(null) });

  const today = todayStr(), soon = plusDays(2);
  const overdue = (open.data ?? []).filter((t) => t.due_date && t.due_date < today).length;
  const dueSoon = (open.data ?? []).filter((t) => t.due_date && t.due_date >= today && t.due_date <= soon).length;
  const nameOf = (list: { id: number; name?: string; full_name?: string }[] | undefined, id: number | null) => list?.find((x) => x.id === id);

  const fields: FieldDef[] = [
    { key: "title", label: "Task", required: true, wide: true },
    { key: "due_date", label: "Due date", kind: "date" },
    { key: "priority", label: "Priority", kind: "select", options: PRIORITIES.map((p) => [p, cap(p)]) },
    { key: "assignee_id", label: "Assigned to", kind: "id", options: [["", "Unassigned"], ...(team.data ?? []).map((u): [string, string] => [String(u.id), u.full_name])] },
    { key: "website_id", label: "Website", kind: "id", options: [["", "None"], ...(sites.data ?? []).map((w): [string, string] => [String(w.id), w.name])] },
    { key: "client_id", label: "Client", kind: "id", options: [["", "None"], ...(clients.data ?? []).map((c): [string, string] => [String(c.id), c.name])] },
    { key: "notes", label: "Notes", kind: "textarea" },
  ];

  return (
    <>
      <PageHeader title="Tasks & Reminders" subtitle="Reminders appear here and on the Overview. Nothing is sent by email or message."
        actions={<><Select aria-label="Show" className="!w-auto" value={state} onChange={(e) => setState(e.target.value as State)}>
          <option value="open">Open</option><option value="overdue">Overdue</option><option value="done">Completed</option><option value="">All</option></Select>
          <Button variant="primary" onClick={() => setForm("new")}><Plus className="size-4" />Add task</Button></>} />

      {(overdue > 0 || dueSoon > 0) && (
        <div role="status" className="mb-4 flex items-center gap-3 rounded-2xl border border-warn/30 bg-warnsoft px-4 py-3 text-sm text-warn">
          <BellRing className="size-4 shrink-0" aria-hidden />
          <span>{overdue > 0 && <strong>{overdue} overdue</strong>}{overdue > 0 && dueSoon > 0 && " · "}{dueSoon > 0 && <>{dueSoon} due within 2 days</>}</span>
        </div>
      )}

      {tasks.isLoading ? <Spinner /> : tasks.error ? <ErrorState error={tasks.error} retry={tasks.refetch} /> : !tasks.data?.length ? (
        <EmptyState icon={<ListChecks className="size-6" />} title={state === "done" ? "Nothing completed yet" : "No tasks here"} body="Create tasks for websites, clients and follow-ups, with due dates and priorities." action={<Button variant="primary" onClick={() => setForm("new")}><Plus className="size-4" />Add task</Button>} />
      ) : (
        <Card pad={false}>
          <ul>
            {tasks.data.map((t) => {
              const late = !t.completed_at && !!t.due_date && t.due_date < today;
              const site = nameOf(sites.data, t.website_id), cl = nameOf(clients.data, t.client_id), who = nameOf(team.data, t.assignee_id);
              return (
                <li key={t.id} className="flex items-start gap-3 border-t border-line px-4 py-3 first:border-t-0">
                  <input type="checkbox" className="mt-1 size-4 accent-[var(--accent)]" checked={!!t.completed_at} onChange={() => toggle.mutate(t)} aria-label={`Complete ${t.title}`} />
                  <div className="min-w-0 flex-1">
                    <div className={`text-sm font-medium ${t.completed_at ? "text-muted line-through" : ""}`}>{t.title}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                      {t.due_date && <Badge tone={late ? "danger" : "muted"}>{late ? "Overdue · " : "Due "}{fmtDate(t.due_date)}</Badge>}
                      <Badge tone={t.priority === "high" ? "danger" : t.priority === "medium" ? "warn" : "muted"}>{cap(t.priority)}</Badge>
                      {site && <Link to={`/websites/${site.id}`}><Badge tone="info">{site.name}</Badge></Link>}
                      {cl && <Link to={`/clients/${cl.id}`}><Badge tone="info">{cl.name}</Badge></Link>}
                      {who && <span className="text-muted">→ {who.full_name}</span>}
                    </div>
                    {t.notes && <p className="mt-1 whitespace-pre-wrap text-xs text-muted">{t.notes}</p>}
                  </div>
                  <Button size="sm" variant="ghost" aria-label={`Edit ${t.title}`} onClick={() => setForm(t)}><Pencil className="size-3.5" /></Button>
                  <Button size="sm" variant="ghost" aria-label={`Delete ${t.title}`} onClick={() => setDel(t)}><Trash2 className="size-3.5" /></Button>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
      {form && <FormModal title={form === "new" ? "Add task" : "Edit task"} fields={fields} initial={form === "new" ? { priority: "medium" } : { ...form }} submitLabel="Save task"
        onSubmit={(body) => save.mutateAsync({ id: form === "new" ? undefined : form.id, body })} onClose={() => setForm(null)} />}
      {del && <Confirm title="Delete this task?" confirmLabel="Delete task" busy={remove.isPending} onCancel={() => setDel(null)} onConfirm={() => remove.mutate(del)} body={<>“{del.title}” will be permanently deleted.</>} />}
    </>
  );
}
