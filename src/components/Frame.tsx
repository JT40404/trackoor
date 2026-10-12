/** A bordered box with crosshair marks on each corner, like a drafting frame. */
export default function Frame({
  children,
  className,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={className ? `frame ${className}` : "frame"} {...rest}>
      <span className="plus tl" aria-hidden />
      <span className="plus tr" aria-hidden />
      <span className="plus bl" aria-hidden />
      <span className="plus br" aria-hidden />
      {children}
    </div>
  );
}
