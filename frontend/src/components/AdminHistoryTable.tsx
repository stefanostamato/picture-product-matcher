import type { HistoryRow } from "shared/wire";

interface AdminHistoryTableProps {
  rows: HistoryRow[];
}

function formatTimestamp(ts: string): string {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return ts;
  return date.toLocaleString();
}

function formatCost(cost: number): string {
  return `$${cost.toFixed(4)}`;
}

function formatRatio(value: number): string {
  return value.toFixed(3);
}

export function AdminHistoryTable({ rows }: AdminHistoryTableProps) {
  if (rows.length === 0) {
    return (
      <p className="admin-history-empty">
        No eval runs yet — run <code>npm run eval</code> from{" "}
        <code>backend/</code> to populate history.
      </p>
    );
  }

  return (
    <table className="admin-history-table">
      <thead>
        <tr>
          <th>Timestamp</th>
          <th>Git SHA</th>
          <th>Gold set</th>
          <th>Recall@5</th>
          <th>MRR</th>
          <th>p95 latency (ms)</th>
          <th>Total $</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={`${row.ts}-${row.gitSha}-${index}`}>
            <td>{formatTimestamp(row.ts)}</td>
            <td>
              <code>{row.gitSha.slice(0, 7)}</code>
              {row.gitDirty ? "*" : ""}
            </td>
            <td>{row.goldSetVersion}</td>
            <td>{formatRatio(row.metrics.recallAt5)}</td>
            <td>{formatRatio(row.metrics.mrr)}</td>
            <td>{Math.round(row.metrics.p95LatencyMs)}</td>
            <td>{formatCost(row.metrics.totalCostUsd)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
