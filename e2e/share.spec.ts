import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from "@playwright/test";

const MOD = process.platform === "darwin" ? "Meta" : "Control";
const SERVER = "http://127.0.0.1:1234";
const SHEET_URL = /\/[A-Za-z0-9_-]{16}$/;

// Each test owns its contexts (which own the collaboration providers). They are
// closed BEFORE the durable reset so no provider can reconnect during the reset.
const contexts: BrowserContext[] = [];
async function freshPage(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext();
  contexts.push(ctx);
  return ctx.newPage();
}

test.afterEach(async ({ request }) => {
  for (const ctx of contexts.splice(0)) await ctx.close(); // (1) close pages/providers
  // (2) Reset only once nothing is live. Reset failure fails the test immediately
  // so a leaked/half-reset server can never mask a later assertion.
  const res = await request.post(`${SERVER}/__test/reset`);
  expect(res.status()).toBe(200);
  expect(await res.text()).toBe("ok");
});

async function typeInto(page: Page, text: string) {
  await page.locator(".cm-content").click();
  await page.keyboard.type(text);
}

/** Focus the editor and append at the document end (deterministic caret). */
async function appendInto(page: Page, text: string) {
  await page.locator(".cm-content").click();
  await page.keyboard.press(`${MOD}+a`);
  await page.keyboard.press("ArrowRight"); // collapse selection to doc end
  await page.keyboard.type(text);
}

/** Focus the editor and prepend at the document start. */
async function prependInto(page: Page, text: string) {
  await page.locator(".cm-content").click();
  await page.keyboard.press(`${MOD}+a`);
  await page.keyboard.press("ArrowLeft"); // collapse selection to doc start
  await page.keyboard.type(text);
}

/** Deterministic undo-capture boundary via the dev-only test hook (no wall clock). */
async function closeUndoGroup(page: Page) {
  await page.evaluate(() => {
    (window as unknown as { __galleyTest: { stopUndoCapturing: () => void } }).__galleyTest.stopUndoCapturing();
  });
}

/** Arm a fresh barrier generation; returns its holdId (all controls are scoped to it). */
async function armCreateHold(request: APIRequestContext): Promise<string> {
  const r = await request.post(`${SERVER}/__test/hold-create`);
  expect(r.status()).toBe(200);
  const { holdId } = await r.json();
  expect(holdId).toBeTruthy();
  return holdId;
}
/** Block until the server acknowledges a create for THIS holdId has REACHED the
 *  barrier — so the test never races ahead of the server (no timing reliance). */
async function waitCreateReached(request: APIRequestContext, holdId: string) {
  const r = await request.get(`${SERVER}/__test/hold-create/reached?holdId=${holdId}`);
  expect(r.status()).toBe(200);
  expect((await r.json()).reached).toBe(true);
}
async function releaseCreateHold(request: APIRequestContext, holdId: string) {
  const r = await request.post(`${SERVER}/__test/release-create?holdId=${holdId}`);
  expect(r.status()).toBe(200);
}

test.describe("M4 S6 — visible Share flow (two tabs)", () => {
  test("share, join in a second tab, converge both ways, undo, and rejoin on reload", async ({
    browser,
  }) => {
    const a = await freshPage(browser);
    await a.goto("/");
    await expect(a.getByLabel("Code editor")).toBeVisible();

    // Mark the live editor node so a remount would be detectable.
    await a.evaluate(() =>
      document.querySelector(".cm-editor")?.setAttribute("data-marked", "1"),
    );

    await typeInto(a, "hello-A");
    await a.getByRole("button", { name: "Share" }).click();
    // An edit around the Share round-trip must survive (re-focus the editor,
    // which lost focus to the Share button, then append at the end).
    await appendInto(a, " during");

    // URL becomes /{sheetId} without a reload (marker survives; no navigation).
    await a.waitForURL(SHEET_URL);
    await expect(a.locator('.cm-editor[data-marked="1"]')).toBeVisible();
    await expect(a.getByTestId("draft-state")).toHaveText(/^Shared/);
    const url = a.url();
    await expect(a.locator(".cm-content")).toContainText("hello-A during");

    // Second tab joins the same sheet by direct load.
    const b = await freshPage(browser);
    await b.goto(url);
    // Observe the joining state and/or the mounted editor (join completes fast).
    await expect(
      b.getByText("Connecting…").or(b.getByLabel("Code editor")),
    ).toBeVisible();
    await expect(b.getByLabel("Code editor")).toBeVisible();

    // Complete shared text appears exactly once (no duplicated initial content).
    const bLine = b.locator(".cm-line").first();
    await expect(bLine).toContainText("hello-A during");
    await expect(b.locator(".cm-line")).toHaveCount(1);
    expect((await bLine.innerText()).match(/hello-A/g)?.length).toBe(1);
    await expect(b.getByTestId("draft-state")).toHaveText("Shared");

    // Edits flow A → B.
    await appendInto(a, " A2TOKEN");
    await expect(b.locator(".cm-content")).toContainText("A2TOKEN");

    // Edits flow B → A.
    await prependInto(b, "B0 ");
    await expect(a.locator(".cm-content")).toContainText("B0 ");

    // Reload B → rejoins the current live room state (both peers' edits present).
    await b.reload();
    await expect(b.getByLabel("Code editor")).toBeVisible();
    await expect(b.locator(".cm-content")).toContainText("A2TOKEN");
    await expect(b.locator(".cm-content")).toContainText("B0 ");
  });

  test("held Share: a during-Share edit and a pre-Share undo group survive the handoff", async ({
    browser,
    request,
  }) => {
    const a = await freshPage(browser);
    await a.goto("/");
    await expect(a.getByLabel("Code editor")).toBeVisible();

    // Two pre-Share edits, each its own deterministic undo group.
    await appendInto(a, "ALPHA");
    await closeUndoGroup(a);
    await appendInto(a, "BETA");
    await closeUndoGroup(a);

    // Arm the barrier so the create response is deterministically held.
    const holdId = await armCreateHold(request);
    await a.getByRole("button", { name: "Share" }).click();
    // Wait for the SERVER to acknowledge the held create request has arrived — the
    // client cannot race ahead of the server, so this needs no timing assumption.
    await waitCreateReached(request, holdId);
    // The create response is definitely held → the UI is in Sharing….
    await expect(a.getByRole("button", { name: "Sharing" })).toBeVisible();

    // Type during Share (its own undo group), while the response is still held.
    await appendInto(a, "GAMMA");

    // Release the held durable success; the URL flips to /{sheetId} (no reload).
    await releaseCreateHold(request, holdId);
    await a.waitForURL(SHEET_URL);
    await expect(a.getByTestId("draft-state")).toHaveText(/^Shared/);

    // The edit made WHILE Share was held survived the handoff.
    await expect(a.locator(".cm-content")).toContainText("ALPHABETAGAMMA");

    // Undo #1 reverts the during-Share group (GAMMA); pre-Share content remains.
    await a.locator(".cm-content").click();
    await a.keyboard.press(`${MOD}+z`);
    await expect(a.locator(".cm-content")).not.toContainText("GAMMA");
    await expect(a.locator(".cm-content")).toContainText("ALPHABETA");

    // Undo #2 reverts a GENUINE pre-Share group (BETA), created before Share —
    // proving the pre-Share undo stack survived the handoff — while the earliest
    // pre-Share content (ALPHA) remains.
    await a.keyboard.press(`${MOD}+z`);
    await expect(a.locator(".cm-content")).not.toContainText("BETA");
    await expect(a.locator(".cm-content")).toContainText("ALPHA");
  });

  test("clipboard write rejection → sharing still succeeds; a repeated manual copy also fails safely", async ({
    browser,
  }) => {
    const a = await freshPage(browser);
    // Force every clipboard write to reject BEFORE the app loads.
    await a.addInitScript(() => {
      // @ts-expect-error override for the test
      navigator.clipboard = { writeText: () => Promise.reject(new Error("denied")) };
    });
    await a.goto("/");
    await expect(a.getByLabel("Code editor")).toBeVisible();
    await typeInto(a, "clip-fail");
    await a.getByRole("button", { name: "Share" }).click();

    await a.waitForURL(SHEET_URL);
    // Sharing succeeded: the standing state is Shared (never claims copied).
    await expect(a.getByTestId("draft-state")).toHaveText("Shared");
    // Fallback: a selectable absolute URL + an inline Copy link action.
    const link = a.getByLabel("Shared URL");
    await expect(link).toBeVisible();
    await expect(link).toHaveValue(a.url());
    const copyBtn = a.getByRole("button", { name: "Copy link" });
    await expect(copyBtn).toBeVisible();

    // Retry the manual copy — it rejects again. Nothing rolls back or crashes.
    await copyBtn.click();
    await expect(a.getByTestId("draft-state")).toHaveText("Shared");
    await expect(link).toBeVisible();
    await expect(link).toHaveValue(a.url());
    await expect(copyBtn).toBeVisible();
  });

  test("a valid-shaped but nonexistent sheet id is unavailable", async ({ browser }) => {
    const page = await freshPage(browser);
    await page.goto("/zzzzzzzzzzzzzzzz");
    await expect(page.getByText("This link is unavailable")).toBeVisible();
    await expect(page.getByLabel("Code editor")).toHaveCount(0);
  });
});
