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

  // Timeline "now" indicator (exact match avoids collision with Date.now() in editor code)
  await expect(page.getByText("now", { exact: true })).toBeVisible();
});

test("does not render stale placeholder copy", async ({ page }) => {
  await page.goto("/r/demo");

  await expect(page.getByText("CodeMirror placeholder")).not.toBeAttached();
  await expect(page.getByText("static scaffold")).not.toBeAttached();
  await expect(page.getByText("markers only")).not.toBeAttached();
  await expect(page.getByText("Session timeline")).not.toBeAttached();
  await expect(page.getByText("Echo/Rewind")).not.toBeAttached();
});
