import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("App", () => {
  it("renders the static demo room scaffold", () => {
    render(<App />);

    expect(screen.getByText("Echo/Rewind")).toBeInTheDocument();
    expect(screen.getByText("/r/demo")).toBeInTheDocument();
    expect(screen.getByText("Session timeline")).toBeInTheDocument();
    expect(screen.getByText("2 present")).toBeInTheDocument();
  });
});
