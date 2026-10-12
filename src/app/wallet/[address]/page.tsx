import type { Metadata } from "next";
import WalletView from "@/components/WalletView";
import { short } from "@/lib/format";

export async function generateMetadata({ params }: { params: Promise<{ address: string }> }): Promise<Metadata> {
  const { address } = await params;
  return { title: `Wallet ${short(address)}` };
}

export default async function WalletPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  return <WalletView address={address} />;
}
