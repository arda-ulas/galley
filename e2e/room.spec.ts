import { randomUUID } from "node:crypto";
import { expect, test as base, type Page } from "@playwright/test";

type EchoFixtures = {
  roomPath: string;
};

const test = base.extend<EchoFixtures>({
  roomPath: async ({}, use, testInfo) => {
    const safeTitle = testInfo.title
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase()
      .slice(0, 60);

    await use(
      `/r/demo?__e2eRoom=e2e-${testInfo.workerIndex}-${safeTitle}-${randomUUID().slice(0, 8)}`,
    );
  },
});

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

test.afterEach(async ({ page }) => {
  if (!page.isClosed()) {
    await page.goto("about:blank");
  }
});

// ─── Step 12: starter code seeding ───────────────────────────────────────────

test("starter code: seeds automatically on first load", async ({ page, roomPath }) => {
  await page.goto(roomPath);

  // Seed is inserted server-side at room creation time and flows to the client
  // during the initial Yjs sync step. Wait for Live as proxy for sync completion.
  await expect(page.getByText("Live")).toBeVisible();
  await expect(page.locator(".cm-content")).toContainText("captureSnapshot", {
    timeout: 3000,
  });
});

test("starter code: appears exactly once with two tabs opened concurrently", async ({
  browser,
  roomPath,
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
    await Promise.all([pageA.goto(roomPath), pageB.goto(roomPath)]);

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

test("renders the amber room shell", async ({ page, roomPath }) => {
  await page.goto(roomPath);

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

test("CodeMirror editor mounts and accepts input", async ({ page, roomPath }) => {
  await page.goto(roomPath);

  // CodeMirror root and content layer must be visible
  await expect(page.locator(".cm-editor")).toBeVisible();
  await expect(page.locator(".cm-content")).toBeVisible();

  // Editor must accept keyboard input
  await page.locator(".cm-content").click();
  await page.keyboard.type("hello_editor");
  await expect(page.locator(".cm-content")).toContainText("hello_editor");
});

test("realtime sync between two tabs", async ({ browser, roomPath }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();

  try {
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    await pageA.goto(roomPath);
    await pageB.goto(roomPath);

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

test("awareness presence: two tabs see each other's avatar", async ({ browser, roomPath }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();

  try {
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    await pageA.goto(roomPath);
    await pageB.goto(roomPath);

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

test("awareness cleanup: Page A drops to 1 avatar when Page B closes", async ({ browser, roomPath }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();

  try {
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    await pageA.goto(roomPath);
    await pageB.goto(roomPath);

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

test("remote cursor: Page A renders Page B's cursor widget", async ({ browser, roomPath }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();

  try {
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    await pageA.goto(roomPath);
    await pageB.goto(roomPath);

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

test("does not render stale placeholder copy", async ({ page, roomPath }) => {
  await page.goto(roomPath);

  await expect(page.getByText("CodeMirror placeholder")).not.toBeAttached();
  await expect(page.getByText("static scaffold")).not.toBeAttached();
  await expect(page.getByText("markers only")).not.toBeAttached();
  await expect(page.getByText("Session timeline")).not.toBeAttached();
  await expect(page.getByText("Echo/Rewind")).not.toBeAttached();
});

// ─── Step 14: real timeline markers ──────────────────────────────────────────

test("timeline: snapshot marker appears after typing pause", async ({
  page,
  roomPath,
}) => {
  await page.goto(roomPath);
  await expect(page.getByText("Live")).toBeVisible();

  // Confirm no marker exists before typing — proves the marker is created by
  // the snapshot recorder, not carried over from a prior static state.
  await expect(page.getByTestId("timeline-marker")).toHaveCount(0);

  // Type something unique so the snapshot recorder has non-empty text to capture
  await page.locator(".cm-content").click();
  await page.keyboard.type(`tl_${Date.now()}`);

  // The recorder debounces at 1500 ms then Framer Motion animates the dot in
  // (~200 ms). Poll up to 5 s — avoids a fixed sleep and handles CI variance.
  await expect(page.getByTestId("timeline-marker").first()).toBeVisible({
    timeout: 5000,
  });
});

// ─── Step 17: rail-click nearest-snapshot selection ──────────────────────────

test("timeline: clicking rail enters past preview for nearest snapshot", async ({
  page,
  roomPath,
}) => {
  await page.goto(roomPath);
  await expect(page.getByText("Live")).toBeVisible();

  // Type tokenA and wait for the snapshot marker to commit
  const tokenA = `rail_a_${Date.now()}`;
  await page.locator(".cm-content").click();
  await page.keyboard.type(tokenA);
  await expect(page.getByTestId("timeline-marker").first()).toBeVisible({
    timeout: 5000,
  });

  // Type tokenB immediately — it will only be in the live document, not the snapshot
  const tokenB = `rail_b_${Date.now()}`;
  await page.keyboard.type(tokenB);

  // Click the rail at 10% from the left — the only snapshot (at 80%) is still nearest
  const rail = page.getByTestId("timeline-rail");
  const railBox = await rail.boundingBox();
  expect(railBox).not.toBeNull();
  await rail.click({
    position: { x: Math.floor(railBox!.width * 0.1), y: railBox!.height / 2 },
  });

  // Past pill must appear
  await expect(page.getByText("Viewing the past")).toBeVisible();
  await expect(page.getByTestId("return-to-now")).toBeVisible();

  // Past editor shows tokenA (from snapshot) but not tokenB (live only)
  const pastText = await getEditorText(page);
  expect(pastText).toContain(tokenA);
  expect(pastText).not.toContain(tokenB);

  // Return to now restores live editor with tokenB
  await page.getByTestId("return-to-now").click();
  await expect(page.getByText("Viewing the past")).not.toBeVisible();
  await expect
    .poll(() => getEditorText(page), { timeout: 3000 })
    .toContain(tokenB);
});

// ─── Step 18: drag scrub ─────────────────────────────────────────────────────

test("timeline: drag across two snapshots selects via pointermove", async ({
  page,
  roomPath,
}) => {
  await page.goto(roomPath);
  await expect(page.getByText("Live")).toBeVisible();

  // Snapshot 1: seed + tokenA  (taken after tokenA typed, before tokenB)
  const tokenA = `drag_a_${Date.now()}`;
  await page.locator(".cm-content").click();
  await page.keyboard.type(tokenA);
  await expect(page.getByTestId("timeline-marker").first()).toBeVisible({
    timeout: 5000,
  });

  // Snapshot 2: seed + tokenA + tokenB  (taken after tokenB typed)
  const tokenB = `drag_b_${Date.now()}`;
  await page.keyboard.type(tokenB);
  await expect(page.getByTestId("timeline-marker")).toHaveCount(2, {
    timeout: 5000,
  });

  // tokenC is live-only — not captured in either snapshot
  const tokenC = `drag_c_${Date.now()}`;
  await page.keyboard.type(tokenC);

  // Rail layout with two snapshots: marker 1 ≈ 5%, marker 2 ≈ 88%.
  // Strategy: press down near marker 2 (right) → pointermove to marker 1 (left).
  //
  // pointerdown at right  → selects snapshot 2 (tokenA + tokenB, no tokenC)
  // pointermove to left   → should update selection to snapshot 1 (tokenA only)
  //
  // We assert BEFORE mouse.up() to eliminate the trailing-click fallback:
  // after mouse.up() Chromium fires a click at endX which would select snapshot 1
  // via the onClick rail handler — masking a broken pointermove.
  // Asserting mid-drag (button still held) catches that hole.
  const rail = page.getByTestId("timeline-rail");
  const railBox = await rail.boundingBox();
  expect(railBox).not.toBeNull();

  const startX = railBox!.x + railBox!.width * 0.85; // near marker 2
  const endX   = railBox!.x + railBox!.width * 0.08; // near marker 1
  const midY   = railBox!.y + railBox!.height / 2;

  await page.mouse.move(startX, midY);
  await page.mouse.down();                      // pointerdown → snapshot 2 selected
  await page.mouse.move(startX - 20, midY);    // nudge to start drag
  await page.mouse.move(endX, midY);           // sweep to marker 1 via pointermove

  // Assert mid-drag (before mouse.up) — proves pointermove changed selection.
  // If pointermove is a no-op, snapshot 2 remains selected and tokenB is present.
  try {
    await expect(page.getByText("Viewing the past")).toBeVisible({
      timeout: 1000,
    });
    const midDragText = await getEditorText(page);
    expect(midDragText).toContain(tokenA);
    expect(midDragText).not.toContain(tokenB);  // snapshot 2 has tokenB; snapshot 1 does not
    expect(midDragText).not.toContain(tokenC);  // neither snapshot has tokenC
  } finally {
    await page.mouse.up();
  }

  // Past pill remains after release; Return to now restores the live doc
  await expect(page.getByText("Viewing the past")).toBeVisible();
  await page.getByTestId("return-to-now").click();
  await expect(page.getByText("Viewing the past")).not.toBeVisible();
  await expect
    .poll(() => getEditorText(page), { timeout: 3000 })
    .toContain(tokenC);
});

// ─── Timeline keyboard navigation ────────────────────────────────────────────

test("timeline: keyboard ArrowLeft enters past mode; Escape returns to now", async ({
  page,
  roomPath,
}) => {
  await page.goto(roomPath);
  await expect(page.getByText("Live")).toBeVisible();

  // Create at least one snapshot so ArrowLeft has somewhere to go
  const tokenA = `kb_a_${Date.now()}`;
  await page.locator(".cm-content").click();
  await page.keyboard.type(tokenA);
  await expect(page.getByTestId("timeline-marker").first()).toBeVisible({
    timeout: 5000,
  });

  // Focus the rail via keyboard focus (no pointer event, no click-triggered selection)
  await page.getByTestId("timeline-rail").focus();

  // ArrowLeft from live → selects the most recent snapshot → enters past mode
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByText("Viewing the past")).toBeVisible();
  await expect(page.getByTestId("return-to-now")).toBeVisible();

  // Escape → returns to live without clicking Return to now
  await page.keyboard.press("Escape");
  await expect(page.getByText("Viewing the past")).not.toBeVisible();

  // Live editor is restored — typed content is still present
  await expect
    .poll(() => getEditorText(page), { timeout: 3000 })
    .toContain(tokenA);
});

// ─── Step 15: past preview mode ──────────────────────────────────────────────

test("past mode: click marker enters read-only past preview", async ({
  page,
  roomPath,
}) => {
  await page.goto(roomPath);
  await expect(page.getByText("Live")).toBeVisible();

  // Phase 1: type tokenA and wait for its snapshot marker to appear.
  // The marker appearing confirms the first snapshot was committed to the
  // Y.Array — that snapshot's text contains tokenA but not tokenB.
  const tokenA = `past_a_${Date.now()}`;
  await page.locator(".cm-content").click();
  await page.keyboard.type(tokenA);

  const firstMarker = page.getByTestId("timeline-marker").first();
  await expect(firstMarker).toBeVisible({ timeout: 5000 });

  // Phase 2: type tokenB immediately (no pause so the first snapshot is already
  // committed with only tokenA in it, and tokenB is only in the live text).
  const tokenB = `past_b_${Date.now()}`;
  await page.keyboard.type(tokenB);

  // Phase 3: click the first marker to enter past preview.
  await firstMarker.click();

  // Past pill must be visible with the mode label and the exit button.
  await expect(page.getByText("Viewing the past")).toBeVisible();
  await expect(page.getByTestId("return-to-now")).toBeVisible();

  // Editor shows the older snapshot: tokenA present, tokenB absent.
  const pastText = await getEditorText(page);
  expect(pastText).toContain(tokenA);
  expect(pastText).not.toContain(tokenB);

  // Editor is read-only: typing should not change the displayed text.
  await page.locator(".cm-content").click();
  await page.keyboard.type("should_not_appear");
  const afterTypeText = await getEditorText(page);
  expect(afterTypeText).not.toContain("should_not_appear");

  // Phase 4: exit past mode via Return to now.
  await page.getByTestId("return-to-now").click();

  // Pill gone and live editor restored.
  await expect(page.getByText("Viewing the past")).not.toBeVisible();

  // Live editor shows the full current content including tokenB.
  await expect
    .poll(() => getEditorText(page), { timeout: 3000 })
    .toContain(tokenB);

  // The text typed in past mode must not have leaked into the live document.
  expect(await getEditorText(page)).not.toContain("should_not_appear");
});

// ─── NOW terminus: drag/click far-right returns to live ──────────────────────

test("timeline: clicking far-right rail edge from past mode returns to live", async ({
  page,
  roomPath,
}) => {
  await page.goto(roomPath);
  await expect(page.getByText("Live")).toBeVisible();

  // Snapshot 1: tokenA
  const tokenA = `now_edge_a_${Date.now()}`;
  await page.locator(".cm-content").click();
  await page.keyboard.type(tokenA);
  await expect(page.getByTestId("timeline-marker").first()).toBeVisible({
    timeout: 5000,
  });

  // Snapshot 2: tokenA + tokenB (live-only tokenC added after)
  const tokenB = `now_edge_b_${Date.now()}`;
  await page.keyboard.type(tokenB);
  await expect(page.getByTestId("timeline-marker")).toHaveCount(2, {
    timeout: 5000,
  });
  const tokenC = `now_edge_live_${Date.now()}`;
  await page.keyboard.type(tokenC);

  // Enter past mode by clicking the first (oldest) marker
  await page.getByTestId("timeline-marker").first().click();
  await expect(page.getByText("Viewing the past")).toBeVisible();

  // Click the far-right edge of the rail (>=98% of width) to trigger NOW threshold
  const rail = page.getByTestId("timeline-rail");
  const railBox = await rail.boundingBox();
  expect(railBox).not.toBeNull();
  await rail.click({
    position: {
      x: Math.floor(railBox!.width * 0.99),
      y: railBox!.height / 2,
    },
  });

  // Past pill must disappear
  await expect(page.getByText("Viewing the past")).not.toBeVisible();

  // Live editor is restored and contains the latest content
  await expect
    .poll(() => getEditorText(page), { timeout: 3000 })
    .toContain(tokenC);
});

test("past mode: Tab A views past locally while Tab B edits live; Return to now picks up Tab B edits", async ({ browser, roomPath }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();

  try {
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    await pageA.goto(roomPath);
    await pageB.goto(roomPath);

    // Both tabs must reach Live status before testing
    await expect(pageA.getByText("Live")).toBeVisible();
    await expect(pageB.getByText("Live")).toBeVisible();

    // Step 3: Type tokenA in Tab A
    const tokenA = `past_iso_a_${Date.now()}`;
    await pageA.locator(".cm-content").click();
    await pageA.keyboard.type(tokenA);

    // Step 4: Wait for the first snapshot marker (tokenA is now committed to a snapshot)
    await expect(pageA.getByTestId("timeline-marker").first()).toBeVisible({ timeout: 6000 });

    // Step 5: Type tokenB immediately — live-only; no pause so a second snapshot
    // won't fire before we enter past mode (marker appeared → tokenA's snapshot exists)
    const tokenB = `past_iso_b_${Date.now()}`;
    await pageA.keyboard.type(tokenB);

    // Step 6: Enter past mode in Tab A — click the first timeline marker
    await pageA.getByTestId("timeline-marker").first().click();

    // Step 7: Verify Tab A is in past mode
    await expect(pageA.getByText("Viewing the past")).toBeVisible();
    await expect(pageA.getByTestId("return-to-now")).toBeVisible();

    // Past editor shows tokenA (from snapshot) but not tokenB (live only)
    const pastText = await getEditorText(pageA);
    expect(pastText).toContain(tokenA);
    expect(pastText).not.toContain(tokenB);

    // Editor is read-only in past mode
    const contentEditableInPast = await pageA.evaluate(() =>
      document.querySelector(".cm-content")?.getAttribute("contenteditable"),
    );
    expect(contentEditableInPast).toBe("false");

    // Step 8: While Tab A is in past mode, type tokenC in Tab B
    const tokenC = `TAB_B_EDIT_WHILE_A_IN_PAST_${Date.now()}`;
    await pageB.locator(".cm-content").click();
    await pageB.keyboard.type(tokenC);

    // Step 9: Confirm Tab B is still live — past mode is local-only
    await expect(pageB.getByText("Live")).toBeVisible();

    // Step 10: Return Tab A to now
    await pageA.getByTestId("return-to-now").click();

    // Step 11: Verify Tab A after returning to now
    await expect(pageA.getByText("Viewing the past")).not.toBeVisible();

    // Editor is editable again
    const contentEditableAfterReturn = await pageA.evaluate(() =>
      document.querySelector(".cm-content")?.getAttribute("contenteditable"),
    );
    expect(contentEditableAfterReturn).toBe("true");

    // Tab A picks up Tab B's live edit — use expect.poll because Yjs sync is async
    await expect
      .poll(() => getEditorText(pageA), { timeout: 4000 })
      .toContain(tokenC);
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});
