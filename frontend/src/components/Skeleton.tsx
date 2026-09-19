// Static loading placeholders reproducing the old template's skeleton markup
// (six metric tiles, five queue rows). Shimmer only kicks in via body.shimmer-on
// once useShimmer's 300ms timer fires — see App.tsx.
const TILE_COUNT = 6;
const ROW_SHORT_SUBJECT = [false, true, false, true, false];

export function MetricsSkeleton() {
  return (
    <section className="metrics" aria-label="Desk metrics">
      {Array.from({ length: TILE_COUNT }, (_, i) => (
        <div className="tile skeleton" key={i}>
          <div className="sk sk-label" />
          <div className="sk sk-value" />
          <div className="sk sk-context" />
        </div>
      ))}
    </section>
  );
}

export function QueueSkeleton() {
  return (
    <>
      {ROW_SHORT_SUBJECT.map((short, i) => (
        <div className="skel-row skeleton" key={i}>
          <div className="sk sk-num" />
          <div className="sk sk-dot" />
          <div className={short ? "sk sk-subj short" : "sk sk-subj"} />
          <div className="sk sk-sla" />
        </div>
      ))}
    </>
  );
}
