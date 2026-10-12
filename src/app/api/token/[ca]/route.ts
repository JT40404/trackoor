import type { NextRequest } from "next/server";
import { HttpError } from "@/lib/errors";
import { clientIp, handle, ok } from "@/lib/http";
import { isValidAddress } from "@/lib/solana/address";
import { getLaunch, launchTtl } from "@/lib/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest, ctx: { params: Promise<{ ca: string }> }) {
  return handle(async () => {
    const { ca } = await ctx.params;
    if (!isValidAddress(ca)) throw new HttpError(400, "That isn't a valid Solana address.");
    const { value } = await getLaunch(ca, clientIp(req));
    const ttl = launchTtl(value);
    return ok(value, { sMaxAge: Math.min(ttl, 3600), swr: 86400 });
  });
}
