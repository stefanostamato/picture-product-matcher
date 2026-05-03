import type { Product } from "shared/catalog";

interface ResultsGridProps {
  results: Product[];
}

const formatPrice = (n: number) =>
  new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);

export function ResultsGrid({ results }: ResultsGridProps) {
  if (results.length === 0) {
    return <p className="empty">No matches yet.</p>;
  }
  return (
    <ul className="results">
      {results.map((product) => (
        <li key={product._id} className="result-card">
          <h3>{product.title}</h3>
          <p className="meta">
            <span>{product.category}</span>
            <span>{product.type}</span>
            <span>{formatPrice(product.price)}</span>
          </p>
          <p className="description">{product.description}</p>
        </li>
      ))}
    </ul>
  );
}
