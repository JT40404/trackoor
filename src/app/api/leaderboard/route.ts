import { handle, ok } from "@/lib/http";
import { getLeaderboard } from "@/lib/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return handle(async () => ok(await getLeaderboard(), { sMaxAge: 30, swr: 120 }));
}
