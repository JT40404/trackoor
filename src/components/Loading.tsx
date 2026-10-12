export default function Loading({ title, steps }: { title: string; steps: string[] }) {
  return (
    <section className="loading" aria-live="polite">
      <p className="mono-label loading-title">
        [ {title} <span className="spin" aria-hidden /> ]
      </p>
      <ol className="loading-steps">
        {steps.map((s, i) => (
          <li key={s} className="mono-label">
            <span className="muted">{String(i + 1).padStart(3, "0")}</span> {s}
          </li>
        ))}
      </ol>
    </section>
  );
}
