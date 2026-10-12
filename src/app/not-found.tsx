import Link from "next/link";

export default function NotFound() {
  return (
    <section className="empty">
      <span className="mono-label">[404]</span>
      <h1>Nothing at this address</h1>
      <p>
        This page doesn&apos;t exist. <Link href="/">Search for a token or wallet</Link>.
      </p>
    </section>
  );
}
