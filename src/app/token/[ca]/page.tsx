import type { Metadata } from "next";
import TokenView from "@/components/TokenView";
import { short } from "@/lib/format";

export async function generateMetadata({ params }: { params: Promise<{ ca: string }> }): Promise<Metadata> {
  const { ca } = await params;
  return { title: `Token ${short(ca)}` };
}

export default async function TokenPage({ params }: { params: Promise<{ ca: string }> }) {
  const { ca } = await params;
  return <TokenView ca={ca} />;
}
