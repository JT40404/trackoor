import type { Metadata } from "next";
import LeaderboardView from "@/components/LeaderboardView";

export const metadata: Metadata = { title: "Smart wallets" };

export default function SmartPage() {
  return <LeaderboardView />;
}
