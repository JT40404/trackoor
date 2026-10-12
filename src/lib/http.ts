import { NextResponse, type NextRequest } from "next/server";
import { HttpError } from "./errors";

export function clientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "anon";
}

export function ok(data: unknown, cdn?: { sMaxAge: number; swr: number }) {
  return NextResponse.json(data, {
    headers: cdn
      ? { "Cache-Control": `public, s-maxage=${cdn.sMaxAge}, stale-while-revalidate=${cdn.swr}` }
      : { "Cache-Control": "no-store" },
  });
}

export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message, hint: err.hint }, { status: err.status, headers: { "Cache-Control": "no-store" } });
    }
    console.error(err);
    return NextResponse.json({ error: "Analysis failed unexpectedly. Try again in a moment." }, { status: 500 });
  }
}
