import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("App", () => {
  it("renders the demo room shell", () => {
    render(<App />);

    expect(screen.getByText(/echo \/ demo/)).toBeInTheDocument();
    expect(screen.getByText("Live")).toBeInTheDocument();
  });

  it("renders presence avatars for demo users", () => {
    render(<App />);

    expect(screen.getByTitle("Ada · editing")).toBeInTheDocument();
    expect(screen.getByTitle("Lin · viewing")).toBeInTheDocument();
  });
});
