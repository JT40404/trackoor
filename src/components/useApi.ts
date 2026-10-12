"use client";

import { useEffect, useState } from "react";
import type { ApiError } from "@/lib/types";

export type ApiState<T> =
  | { status: "loading" }
  | { status: "error"; error: string; hint?: string; code: number }
  | { status: "ready"; data: T };

export function useApi<T>(url: string | null): ApiState<T> {
  const [state, setState] = useState<ApiState<T>>({ status: "loading" });
  useEffect(() => {
    if (!url) return;
    let alive = true;
    setState({ status: "loading" });
    fetch(url)
      .then(async (res) => {
        const body = await res.json().catch(() => ({ error: `Request failed (HTTP ${res.status}).` }));
        if (!alive) return;
        if (!res.ok) {
          const e = body as ApiError;
          setState({ status: "error", error: e.error, hint: e.hint, code: res.status });
        } else setState({ status: "ready", data: body as T });
      })
      .catch(() => alive && setState({ status: "error", error: "Couldn't reach the server. Check your connection.", code: 0 }));
    return () => {
      alive = false;
    };
  }, [url]);
  return state;
}
