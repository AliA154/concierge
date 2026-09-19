import type { ApiErrorBody } from "./types";

export class ApiError extends Error {
  readonly code: number;
  constructor(code: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.code = code;
  }
}

export interface ApiOptions {
  method?: "GET" | "POST" | "PATCH";
  body?: unknown;
  agent?: string;
}

function isErrorBody(value: unknown): value is ApiErrorBody {
  return typeof value === "object" && value !== null && "error" in value;
}

export async function api<T>(path: string, { method = "GET", body, agent = "" }: ApiOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (method !== "GET") {
    headers["Content-Type"] = "application/json";
    headers["X-Agent"] = agent; // cosmetic actor attribution; server falls back to "System"
  }
  const res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const message = isErrorBody(data) ? data.error.message : `Request failed (${res.status})`;
    throw new ApiError(res.status, message);
  }
  return data as T;
}
