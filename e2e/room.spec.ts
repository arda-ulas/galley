import { expect, test, type Page } from "@playwright/test";

/**
 * Read the CodeMirror editor's true text content, stripping remote cursor
 * widgets (.cm-ySelectionCaret) before returning.
 *
 * Background: y-codemirror.next renders remote cursors as inline WidgetDecorations
 * that inject DOM nodes (word-joiner characters + a name label) into .cm-content.
 * Playwright's textContent() includes those text nodes, which can split the
 * asserted strings and cause false-negative toContain failures. Removing the
 * widget elements from a clone gives us the real document text.
 */
async function getEditorText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.querySelector(".cm-content");
    if (!el) return "";
    const clone = el.cloneNode(true) as Element;
    clone.querySelectorAll(".cm-ySelectionCaret").forEach((w) => w.remove());
    return clone.textContent ?? "";
  });
}

// Reset the in-memory room state before every test so each test starts with a
// fresh Y.Doc seeded by the server. Requires the server to be running with
// ECHO_REWIND_TEST=1 (set via playwright.config.ts webServer env option).
test.beforeEach(async ({ request }) => {
  const res = await request.post("http://127.0.0.1:1234/__test/reset");
  if (!res.ok()) {
    throw new Error(
      `/__test/reset returned ${res.status()} — is the server running with ECHO_REWIND_TEST=1?`,
    );
  }
});

// ─── Step 12: starter code seeding ───────────────────────────────────────────

test("starter code: seeds automatically on first load", async ({ page }) => {
  await page.goto("/r/demo");

  // Seed is inserted server-side at room creation time and flows to the client
  // during the initial Yjs sync step. Wait for Live as proxy for sync completion.
  await expect(page.getByText("Live")).toBeVisible();
  await expect(page.locator(".cm-content")).toContainText("captureSnapshot", {
    timeout: 3000,
  });
});

test("starter code: appears exactly once with two tabs opened concurrently", async ({
  browser,
}) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();

  try {
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    // Navigate both tabs simultaneously. With client-side seeding this was a
    // race: both tabs could see an empty Y.Text and both insert the seed.
    // Server-side seeding eliminates the race — the room is created (and seeded)
    // exactly once before any WS client connects, regardless of concurrency.
    await Promise.all([pageA.goto("/r/demo"), pageB.goto("/r/demo")]);

    // Both tabs must sync before we check content
    await expect(pageA.getByText("Live")).toBeVisible();
    await expect(pageB.getByText("Live")).toBeVisible();

    // Both tabs must display the seed content (strip cursor widgets before matching)
    await expect
      .poll(() => getEditorText(pageA), { timeout: 3000 })
      .toContain("captureSnapshot");
    await expect
      .poll(() => getEditorText(pageB), { timeout: 3000 })
      .toContain("captureSnapshot");

    // Exactly 1 occurrence of the seed marker — two concurrent inserts would
    // produce 2. Strip cursor widgets so the caret DOM cannot split the word.
    const textA = await getEditorText(pageA);
    const occurrences = (textA.match(/captureSnapshot/g) ?? []).length;
    expect(occurrences).toBe(1);

    // User edits must flow A → B without overwriting the seed
    const joinToken = `join_safe_${Date.now()}`;
    await pageA.locator(".cm-content").click();
    await pageA.keyboard.type(joinToken);
    await expect
      .poll(() => getEditorText(pageB), { timeout: 3000 })
      .toContain(joinToken);

    // Seed intact on both sides after the user edit
    expect(await getEditorText(pageA)).toContain("captureSnapshot");
    expect(await getEditorText(pageB)).toContain("captureSnapshot");
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});

// ─────────────────────────────────────────────────────────────────────────────

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

  // Seed content is visible (seeded server-side on room creation)
  await expect(page.locator(".cm-content")).toContainText("captureSnapshot");

  // Timeline "now" indicator — scoped to footer to avoid collision with Date.now() tokens in editor
  await expect(
    page.locator("footer").getByText("now", { exact: true }),
  ).toBeVisible();
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

    // Tab B must receive the content within 3 seconds via Yjs WebSocket sync.
    // Use getEditorText to strip remote cursor widgets before matching —
    // y-codemirror.next injects cursor DOM (word-joiners + label) into .cm-content
    // which can split the asserted token in Playwright's textContent() view.
    await expect
      .poll(() => getEditorText(pageB), { timeout: 3000 })
      .toContain(syncToken);

    // Pressing undo in Tab B must not delete Tab A's remote content.
    // (Native CM history is disabled; yCollab undoManager is false for now.)
    await pageB.locator(".cm-content").click();
    await pageB.keyboard.press("ControlOrMeta+z");
    expect(await getEditorText(pageB)).toContain(syncToken);
    expect(await getEditorText(pageA)).toContain(syncToken);
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

test("remote cursor: Page A renders Page B's cursor widget", async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();

  try {
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    await pageA.goto("/r/demo");
    await pageB.goto("/r/demo");

    // Both tabs must be live and synced before exercising cursors
    await expect(pageA.getByText("Live")).toBeVisible();
    await expect(pageB.getByText("Live")).toBeVisible();

    // Type content in Page A so there is a shared Y.Text for cursors to live inside.
    // y-codemirror.next encodes cursors as relative positions within the Y.Text — they
    // resolve to null on the remote side if the Y.Text is empty.
    const cursorToken = `cursor_test_${Date.now()}`;
    await pageA.locator(".cm-content").click();
    await pageA.keyboard.type(cursorToken);

    // Wait for Page B to receive the content (confirms Y.Text is populated on both sides).
    // Page A's cursor widget lives inside Page B's .cm-content, so strip it before matching.
    await expect
      .poll(() => getEditorText(pageB), { timeout: 3000 })
      .toContain(cursorToken);

    // Focus Page B's editor and move the cursor — this triggers the awareness cursor update.
    // yRemoteSelections calls awareness.setLocalStateField('cursor', {anchor, head}) on every
    // view update where the editor has focus, which broadcasts Page B's cursor to Page A.
    await pageB.locator(".cm-content").click();
    await pageB.keyboard.press("End"); // navigate without modifying content

    // Page A must render Page B's remote cursor widget (.cm-ySelectionCaret is the span
    // y-codemirror.next injects at the remote cursor position).
    await expect(pageA.locator(".cm-ySelectionCaret")).toBeVisible({
      timeout: 5000,
    });

    // Presence bar must be unaffected: still 2 avatars, exactly 1 "You"
    await expect(pageA.getByTitle(/·/)).toHaveCount(2);
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
