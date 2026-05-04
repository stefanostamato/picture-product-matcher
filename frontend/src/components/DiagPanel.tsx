import type { ExtractedAttributes, SearchResponseMeta } from "shared/wire";

interface DiagPanelProps {
  meta: SearchResponseMeta;
}

const ATTR_KEYS: ReadonlyArray<keyof ExtractedAttributes> = [
  "category",
  "type",
  "style",
  "material",
  "color",
  "priceBand",
  "description",
];

// Best-effort built-query string. The query-build pipeline stage assembles
// the real Mongo $text query, but it isn't on the wire today; surface what
// we have so the panel still answers "what did this search look up?".
const buildQueryString = (extracted: ExtractedAttributes): string =>
  ATTR_KEYS.flatMap((key) => {
    const value = extracted[key];
    return typeof value === "string" && value.length > 0 ? [value] : [];
  }).join(" ");

export function DiagPanel({ meta }: DiagPanelProps) {
  const builtQuery = buildQueryString(meta.extracted);
  return (
    <details className="diag-panel" data-testid="diag-panel" open>
      <summary>Diagnostics (dev only)</summary>

      <section className="diag-section">
        <h4>Extracted attributes</h4>
        <dl className="diag-attrs">
          {ATTR_KEYS.flatMap((key) => {
            const value = meta.extracted[key];
            return typeof value === "string" && value.length > 0
              ? [
                  <div key={key} className="diag-attr">
                    <dt>{key}</dt>
                    <dd>{value}</dd>
                  </div>,
                ]
              : [];
          })}
        </dl>
      </section>

      <section className="diag-section">
        <h4>Built query</h4>
        <code data-testid="diag-built-query">{builtQuery}</code>
      </section>

      <section className="diag-section">
        <h4>Top results (raw)</h4>
        <ol className="diag-top" data-testid="diag-top-results">
          {meta.topResults.slice(0, 3).map((row) => (
            <li key={row.productId}>
              <span className="diag-id">{row.productId}</span>
              <span className="diag-score">{row.score.toFixed(2)}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="diag-section" data-testid="diag-latency">
        <h4>Latency</h4>
        <p>Total: {meta.latencyMs} ms</p>
        <ul className="diag-stages">
          {meta.stagesRan.map((stage) => (
            <li key={stage} data-stage={stage}>
              {stage}
            </li>
          ))}
        </ul>
      </section>

      <section className="diag-section" data-testid="diag-tokens">
        <h4>Tokens</h4>
        <p>
          prompt {meta.tokens.prompt} / completion {meta.tokens.completion} /
          total {meta.tokens.total}
        </p>
      </section>

      <section className="diag-section">
        <h4>Cost</h4>
        <p data-testid="diag-cost">${meta.costUsd.toFixed(5)}</p>
      </section>
    </details>
  );
}
