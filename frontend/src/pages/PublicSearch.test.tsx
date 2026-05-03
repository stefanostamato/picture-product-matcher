import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { SearchResponse } from "shared/wire";
import { PublicSearch } from "./PublicSearch";
import { ApiKeyProvider } from "../lib/state/apiKey";
import { SearchClientError } from "../lib/api/searchClient";

vi.mock("../lib/api/searchClient", async () => {
  const actual =
    await vi.importActual<typeof import("../lib/api/searchClient")>(
      "../lib/api/searchClient",
    );
  return {
    ...actual,
    searchClient: vi.fn(),
  };
});

import { searchClient } from "../lib/api/searchClient";
const searchClientMock = vi.mocked(searchClient);

const renderPage = () =>
  render(
    <ApiKeyProvider>
      <PublicSearch />
    </ApiKeyProvider>,
  );

const okResponse: SearchResponse = {
  results: [
    {
      _id: "1",
      title: "Modern Sofa",
      description: "A sleek modern sofa",
      category: "Sofas",
      type: "Sectional",
      price: 999,
      width: 200,
      height: 90,
      depth: 100,
    },
  ],
  meta: {
    latencyMs: 42,
    stagesRan: ["visionExtract", "queryBuild", "catalogSearch"],
    extracted: { description: "modern sofa", category: "Sofas" },
  },
};

const fileFromBytes = (name = "x.jpg") =>
  new File([new Uint8Array([1, 2, 3])], name, { type: "image/jpeg" });

const setFile = (input: HTMLElement, file: File) => {
  fireEvent.change(input, { target: { files: [file] } });
};

describe("PublicSearch", () => {
  beforeEach(() => {
    searchClientMock.mockReset();
  });

  it("disables the submit button until both an API key and an image are present", () => {
    renderPage();
    const submit = screen.getByRole("button", { name: /search/i });
    expect(submit).toBeDisabled();

    const apiKey = screen.getByLabelText(/api key/i);
    fireEvent.change(apiKey, { target: { value: "k" } });
    expect(submit).toBeDisabled();

    const image = screen.getByLabelText(/image/i);
    setFile(image, fileFromBytes());
    expect(submit).not.toBeDisabled();
  });

  it("calls searchClient with the api key, image, and prompt on submit", async () => {
    searchClientMock.mockResolvedValue(okResponse);
    renderPage();

    fireEvent.change(screen.getByLabelText(/api key/i), {
      target: { value: "sk-test" },
    });
    const file = fileFromBytes("couch.jpg");
    setFile(screen.getByLabelText(/image/i), file);
    fireEvent.change(screen.getByLabelText(/prompt/i), {
      target: { value: "leather brown" },
    });

    fireEvent.click(screen.getByRole("button", { name: /search/i }));

    await waitFor(() => expect(searchClientMock).toHaveBeenCalledOnce());
    expect(searchClientMock).toHaveBeenCalledWith({
      apiKey: "sk-test",
      image: file,
      prompt: "leather brown",
    });
  });

  it("renders the results grid on success", async () => {
    searchClientMock.mockResolvedValue(okResponse);
    renderPage();

    fireEvent.change(screen.getByLabelText(/api key/i), {
      target: { value: "sk" },
    });
    setFile(screen.getByLabelText(/image/i), fileFromBytes());
    fireEvent.click(screen.getByRole("button", { name: /search/i }));

    await screen.findByText("Modern Sofa");
    expect(screen.getByText("Sofas")).toBeInTheDocument();
    expect(screen.getByText("Sectional")).toBeInTheDocument();
    expect(screen.getByText(/999/)).toBeInTheDocument();
    expect(screen.getByText(/sleek modern sofa/i)).toBeInTheDocument();
  });

  it("renders an error banner when the client throws", async () => {
    searchClientMock.mockRejectedValue(
      new SearchClientError("PROVIDER_ERROR", "Upstream blew up", 502),
    );
    renderPage();

    fireEvent.change(screen.getByLabelText(/api key/i), {
      target: { value: "sk" },
    });
    setFile(screen.getByLabelText(/image/i), fileFromBytes());
    fireEvent.click(screen.getByRole("button", { name: /search/i }));

    await screen.findByRole("alert");
    expect(screen.getByRole("alert")).toHaveTextContent(/upstream blew up/i);
  });

  it("shows a low-confidence banner above results when meta.lowConfidence is true", async () => {
    searchClientMock.mockResolvedValue({
      ...okResponse,
      meta: { ...okResponse.meta, lowConfidence: true },
    });
    renderPage();

    fireEvent.change(screen.getByLabelText(/api key/i), {
      target: { value: "sk" },
    });
    setFile(screen.getByLabelText(/image/i), fileFromBytes());
    fireEvent.click(screen.getByRole("button", { name: /search/i }));

    await screen.findByText("Modern Sofa");
    expect(screen.getByText(/low confidence/i)).toBeInTheDocument();
  });
});
