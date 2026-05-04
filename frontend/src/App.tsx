import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { PublicSearch } from "./pages/PublicSearch";
import { Admin } from "./pages/Admin";
import { ApiKeyProvider } from "./lib/state/apiKey";

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<PublicSearch />} />
      <Route path="/admin" element={<Admin />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export function App() {
  return (
    <ApiKeyProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </ApiKeyProvider>
  );
}
