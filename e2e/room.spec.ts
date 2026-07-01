import { expect, test } from "@playwright/test";

test("renders the amber room shell", async ({ page }) => {
  await page.goto("/r/demo");

  // Top-bar room label
  await expect(page.getByText(/echo \/ demo/)).toBeVisible();

  // Connection status — Playwright starts the WS server, so this must reach Live
  await expect(page.getByText("Live")).toBeVisible();

  // Share button is present and interactive
  await expect(page.getByRole("button", { name: "Share" })).toBeVisible();

  // Local user avatar is visible
  await expect(page.getByTitle(/· You/)).toBeVisible();

  // Timeline "now" indicator — scoped to footer to avoid collision with Date.now() tokens in editor
  await expect(page.locator("footer").getByText("now", { exact: true })).toBeVisible();
});

test("CodeMirror editor mounts and accepts input", async ({ page }) => {
  await page.goto("/r/demo");

  // CodeMirror root and content layer must be visible
  await expect(page.locator(".cm-editor")).toBeVisible();
  await expect(page.locator(".cm-content")).toBeVisible();

  // Editor must accept keyboard input
  await page.locator(".cm-content").click();
  await page.keyboard.type("hello_editor");
  await expect(page.locator(".cm-content")).toContainText("hello_editor");
});

test("realtime sync between two tabs", async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();

  try {
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    await pageA.goto("/r/demo");
    await pageB.goto("/r/demo");

    // Both tabs must reach Live before testing sync
    await expect(pageA.getByText("Live")).toBeVisible();
    await expect(pageB.getByText("Live")).toBeVisible();

    // Unique token per run — avoids false positives from a reused server with old content
    const syncToken = `sync_check_${Date.now()}`;

    // Type the token in Tab A
    await pageA.locator(".cm-content").click();
    await pageA.keyboard.type(syncToken);

    // Tab B must receive the content within 3 seconds via Yjs WebSocket sync
    await expect(pageB.locator(".cm-content")).toContainText(syncToken, {
      timeout: 3000,
    });

    // Pressing undo in Tab B must not delete Tab A's remote content.
    // (Native CM history is disabled; yCollab undoManager is false for now.)
    await pageB.locator(".cm-content").click();
    await pageB.keyboard.press("ControlOrMeta+z");
    await expect(pageB.locator(".cm-content")).toContainText(syncToken);
    await expect(pageA.locator(".cm-content")).toContainText(syncToken);
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});

test("awareness presence: two tabs see each other's avatar", async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();

  try {
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    await pageA.goto("/r/demo");
    await pageB.goto("/r/demo");

    // Both tabs must be live (WebSocket connected and Yjs synced)
    await expect(pageA.getByText("Live")).toBeVisible();
    await expect(pageB.getByText("Live")).toBeVisible();

    // Each tab must show two avatars: its own local user + the remote user
    await expect(pageA.getByTitle(/·/)).toHaveCount(2);
    await expect(pageB.getByTitle(/·/)).toHaveCount(2);

    // Each tab has exactly one avatar marked as "You"
    await expect(pageA.getByTitle(/· You/)).toHaveCount(1);
    await expect(pageB.getByTitle(/· You/)).toHaveCount(1);
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});

test("awareness cleanup: Page A drops to 1 avatar when Page B closes", async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();

  try {
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    await pageA.goto("/r/demo");
    await pageB.goto("/r/demo");

    // Both tabs must be live before we rely on awareness state
    await expect(pageA.getByText("Live")).toBeVisible();
    await expect(pageB.getByText("Live")).toBeVisible();

    // Confirm Page A sees both avatars before we tear down Page B
    await expect(pageA.getByTitle(/·/)).toHaveCount(2);

    // Close the page before the context so the WebSocket close event fires cleanly
    // and the server has time to broadcast the awareness removal before we assert.
    await pageB.close();

    // After Page B's WebSocket closes, the server calls removeAwarenessStates which
    // broadcasts a removal update to Page A. Page A should drop back to 1 avatar.
    await expect(pageA.getByTitle(/·/)).toHaveCount(1, { timeout: 5000 });

    // The surviving avatar must still be the local "You" — not a ghost of the remote user
    await expect(pageA.getByTitle(/· You/)).toHaveCount(1);
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});

test("does not render stale placeholder copy", async ({ page }) => {
  await page.goto("/r/demo");

  await expect(page.getByText("CodeMirror placeholder")).not.toBeAttached();
  await expect(page.getByText("static scaffold")).not.toBeAttached();
  await expect(page.getByText("markers only")).not.toBeAttached();
  await expect(page.getByText("Session timeline")).not.toBeAttached();
  await expect(page.getByText("Echo/Rewind")).not.toBeAttached();
});
