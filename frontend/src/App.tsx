import { PublicSearch } from "./pages/PublicSearch";
import { ApiKeyProvider } from "./lib/state/apiKey";

export function App() {
  return (
    <ApiKeyProvider>
      <PublicSearch />
    </ApiKeyProvider>
  );
}
