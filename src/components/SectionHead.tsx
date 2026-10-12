export default function SectionHead({
  n,
  id,
  title,
  note,
  aside,
}: {
  n: number;
  id: string;
  title: string;
  note?: React.ReactNode;
  aside?: React.ReactNode;
}) {
  return (
    <div className="sec-head">
      <span className="mono-label sec-num">[{String(n).padStart(2, "0")}]</span>
      <div className="sec-head-main">
        <h2 id={id}>{title}</h2>
        {note && <p className="sec-note">{note}</p>}
      </div>
      {aside && <div className="sec-aside">{aside}</div>}
    </div>
  );
}
