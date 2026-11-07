export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** FastAPI returns either a string or a list of validation errors in `detail`. */
export function detailMessage(detail: unknown): string {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((d: any) => `${(d.loc ?? []).filter((x: string) => x !== "body").join(".") || "input"}: ${d.msg ?? "invalid"}`)
      .join("; ");
  }
  return "Something went wrong";
}

export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init.method ?? "GET",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-Requested-With": "crescova" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (res.status === 204) return undefined as T;
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON error body */
  }
  if (!res.ok) throw new ApiError(res.status, detailMessage(data?.detail));
  return data as T;
}
