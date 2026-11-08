import { useState, type FormEvent } from "react";
import { Button, Field, Input, Modal, Select, Textarea } from "./ui";

export interface FieldDef {
  key: string;
  label: string;
  /** "id" is a select whose value is a number, or null when "" is chosen. */
  kind?: "text" | "email" | "tel" | "url" | "number" | "date" | "textarea" | "select" | "id";
  options?: [value: string, label: string][];
  required?: boolean;
  hint?: string;
  placeholder?: string;
  wide?: boolean;
  step?: string;
  /** id of a <datalist> on the page that offers suggestions for a text field */
  list?: string;
}

type Values = Record<string, unknown>; // a whole record can be passed; only keys that match a field are read

/** Data-driven form in a modal: converts blanks to null for numbers/dates/ids, shows server errors inline. */
export default function FormModal({ title, fields, initial = {}, submitLabel, onSubmit, onClose }: {
  title: string; fields: FieldDef[]; initial?: Values; submitLabel: string; onSubmit: (payload: Record<string, unknown>) => Promise<unknown>; onClose: () => void;
}) {
  const [v, setV] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f.key, String(initial[f.key] ?? "")])));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const missing = Object.fromEntries(fields.filter((f) => f.required && !v[f.key].trim()).map((f) => [f.key, "This field is required."]));
    setErrors(missing);
    setServerError(null);
    if (Object.keys(missing).length) return;
    const payload: Record<string, unknown> = {};
    for (const f of fields) {
      const raw = v[f.key];
      payload[f.key] = f.kind === "number" ? (raw === "" ? null : Number(raw)) : f.kind === "id" ? (raw === "" ? null : Number(raw)) : f.kind === "date" ? (raw === "" ? null : raw) : raw.trim();
    }
    setBusy(true);
    try {
      await onSubmit(payload);
      onClose();
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={title} onClose={onClose} wide>
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
        {fields.map((f) => {
          const set = (e: { target: { value: string } }) => setV((x) => ({ ...x, [f.key]: e.target.value }));
          const common = { value: v[f.key], onChange: set, placeholder: f.placeholder };
          return (
            <div key={f.key} className={f.wide || f.kind === "textarea" ? "sm:col-span-2" : ""}>
              <Field label={f.required ? `${f.label} *` : f.label} hint={f.hint} error={errors[f.key]}>
                {(id) =>
                  f.kind === "textarea" ? <Textarea id={id} {...common} />
                  : f.kind === "select" || f.kind === "id" ? <Select id={id} value={v[f.key]} onChange={set}>{(f.options ?? []).map(([val, label]) => <option key={val} value={val}>{label}</option>)}</Select>
                  : <Input id={id} type={f.kind === "number" ? "number" : f.kind ?? "text"} step={f.step} list={f.list} min={f.kind === "number" ? 0 : undefined} {...common} />
                }
              </Field>
            </div>
          );
        })}
        {serverError && <p role="alert" className="rounded-lg bg-dangersoft px-3 py-2 text-sm text-danger sm:col-span-2">{serverError}</p>}
        <div className="flex justify-end gap-2 sm:col-span-2">
          <Button type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" busy={busy}>{submitLabel}</Button>
        </div>
      </form>
    </Modal>
  );
}
