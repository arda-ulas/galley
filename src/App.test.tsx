import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("App", () => {
  it("renders the demo room shell", () => {
    render(<App />);

    expect(screen.getByText(/echo \/ demo/)).toBeInTheDocument();
    expect(screen.getByText(/Live|Connecting|Offline/)).toBeInTheDocument();
  });

  it("renders a local user avatar marked as You", () => {
    render(<App />);

    expect(screen.getByTitle(/· You/)).toBeInTheDocument();
  });

  it("renders the static demo collaborator", () => {
    render(<App />);

    expect(screen.getByTitle("Lin · viewing")).toBeInTheDocument();
  });

  it("renders exactly two presence avatars", () => {
    render(<App />);

    expect(screen.getAllByTitle(/·/)).toHaveLength(2);
  });

  it("persists identity in sessionStorage", () => {
    render(<App />);

    const stored = sessionStorage.getItem("echo-rewind:identity");
    expect(stored).not.toBeNull();

    const parsed = JSON.parse(stored!) as unknown;
    expect(parsed).toMatchObject({
      id: expect.any(String),
      name: expect.any(String),
      color: expect.any(String),
    });
  });
});
