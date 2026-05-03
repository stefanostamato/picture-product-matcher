import { useState } from "react";
import type { SearchResponse } from "shared/wire";
import { ApiKeyInput } from "../components/ApiKeyInput";
import { ImageDrop } from "../components/ImageDrop";
import { PromptInput } from "../components/PromptInput";
import { ResultsGrid } from "../components/ResultsGrid";
import { ErrorBanner } from "../components/ErrorBanner";
import { searchClient, SearchClientError } from "../lib/api/searchClient";
import { useApiKey } from "../lib/state/apiKey";

interface ErrorState {
  code: string;
  message: string;
}

export function PublicSearch() {
  const { apiKey, setApiKey } = useApiKey();
  const [image, setImage] = useState<File | null>(null);
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [error, setError] = useState<ErrorState | null>(null);

  const canSubmit = apiKey.length > 0 && image !== null && !loading;

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!image || apiKey.length === 0) return;
    setLoading(true);
    setError(null);
    setResponse(null);
    try {
      const result = await searchClient({
        apiKey,
        image,
        ...(prompt !== "" ? { prompt } : {}),
      });
      setResponse(result);
    } catch (err) {
      if (err instanceof SearchClientError) {
        setError({ code: err.code, message: err.message });
      } else {
        setError({
          code: "UNKNOWN",
          message: err instanceof Error ? err.message : "Unknown error",
        });
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="page">
      <header>
        <h1>Picture Product Matcher</h1>
        <p>Upload a photo to find matching products in the catalog.</p>
      </header>

      <form onSubmit={onSubmit} className="search-form">
        <ApiKeyInput value={apiKey} onChange={setApiKey} />
        <ImageDrop file={image} onFile={setImage} />
        <PromptInput value={prompt} onChange={setPrompt} />
        <button type="submit" disabled={!canSubmit}>
          {loading ? "Searching..." : "Search"}
        </button>
      </form>

      {error ? <ErrorBanner code={error.code} message={error.message} /> : null}

      {response ? (
        <section className="results-section">
          {response.meta.lowConfidence ? (
            <div className="banner banner-warning" role="status">
              Low confidence — these are best-effort matches.
            </div>
          ) : null}
          <ResultsGrid results={response.results} />
        </section>
      ) : null}
    </main>
  );
}
