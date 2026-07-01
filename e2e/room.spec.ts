import { expect, test } from "@playwright/test";

test("renders the amber room shell", async ({ page }) => {
  await page.goto("/r/demo");

  // Top-bar room label
  await expect(page.getByText(/echo \/ demo/)).toBeVisible();

  // Connection status — Playwright starts the WS server, so this must reach Live
  await expect(page.getByText("Live")).toBeVisible();

  // Share button is present and interactive
  await expect(page.getByRole("button", { name: "Share" })).toBeVisible();

  // Two presence avatars: local user (You) + static collaborator
  await expect(page.getByTitle(/· You/)).toBeVisible();
  await expect(page.getByTitle("Lin · viewing")).toBeVisible();

  // Timeline "now" indicator — scoped to footer to avoid collision with Date.now() tokens in editor
  await expect(page.locator("footer").getByText("now", { exact: true })).toBeVisible();
});

test("CodeMirror editor mounts and renders seed code", async ({ page }) => {
  await page.goto("/r/demo");

  // CodeMirror root and content layer must be visible
  await expect(page.locator(".cm-editor")).toBeVisible();
  await expect(page.locator(".cm-content")).toBeVisible();

  // Seed text must be rendered — captureSnapshot is a unique function name in editorSeed
  await expect(page.locator(".cm-content").getByText("captureSnapshot", { exact: false })).toBeVisible();
});

test("does not render stale placeholder copy", async ({ page }) => {
  await page.goto("/r/demo");

  await expect(page.getByText("CodeMirror placeholder")).not.toBeAttached();
  await expect(page.getByText("static scaffold")).not.toBeAttached();
  await expect(page.getByText("markers only")).not.toBeAttached();
  await expect(page.getByText("Session timeline")).not.toBeAttached();
  await expect(page.getByText("Echo/Rewind")).not.toBeAttached();
});
