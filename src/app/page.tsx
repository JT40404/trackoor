import HeroSpecimen from "@/components/HeroSpecimen";
import SearchBox from "@/components/SearchBox";

const CHECKS = [
  ["Bundled buys", "Wallets that landed in the creation slot, bought identical amounts, or shared one transaction."],
  ["Funding links", "Where each early wallet got its SOL, grouped so related wallets show up together."],
  ["Hold times", "How long early wallets held before selling or moving tokens, and how much they still have."],
] as const;

export default function Home() {
  return (
    <>
      <section className="hero">
        <div className="hero-title-cell">
          <h1 className="hero-title">Who got in before you did</h1>
        </div>
        <div className="hero-side">
          <p className="hero-lede">
            Paste a pump.fun contract address. See which wallets bought in the first blocks, whether they were funded
            from the same place, and whether they&apos;re still holding.
          </p>
          <SearchBox autoFocus />
        </div>
      </section>
      <section className="hero-specimen-row">
        <HeroSpecimen />
      </section>
      <section className="checks" aria-label="What gets checked">
        {CHECKS.map(([title, body], i) => (
          <div className="check" key={title}>
            <div className="check-head">
              <span className="mono-label">{title}</span>
              <span className="mono-label muted">[{String(i + 1).padStart(2, "0")}]</span>
            </div>
            <p>{body}</p>
          </div>
        ))}
      </section>
    </>
  );
}
