// Single fetch wrapper for the control plane. Session cookies are HTTP-only;
// on a 401 we attempt one silent refresh-token rotation, then retry once.

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code: string | null = null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

interface ApiOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
}

let refreshing: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  // Collapse concurrent 401s into one refresh call.
  refreshing ??= fetch("/api/auth/refresh", { method: "POST", credentials: "include" })
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

export async function api<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  const doFetch = () =>
    fetch(path, {
      method: opts.method ?? "GET",
      credentials: "include",
      headers: opts.body !== undefined ? { "content-type": "application/json" } : {},
      body: opts.body !== undefined ? JSON.stringify(opts.body) : null,
      ...(opts.signal ? { signal: opts.signal } : {}),
    });

  let res = await doFetch();
  if (res.status === 401 && !path.startsWith("/api/auth/")) {
    if (await tryRefresh()) res = await doFetch();
  }
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    let code: string | null = null;
    try {
      const body = (await res.json()) as { error?: { message?: string; code?: string } };
      message = body.error?.message ?? message;
      code = body.error?.code ?? null;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, message, code);
  }
  return (await res.json()) as T;
}
