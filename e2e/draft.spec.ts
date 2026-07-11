import { expect, test } from "@playwright/test";

const MOD = process.platform === "darwin" ? "Meta" : "Control";

test.describe("M1 local draft at /", () => {
  test("renders a truthful, empty local draft with no remote chrome", async ({
    page,
  }) => {
    await page.goto("/");

    await expect(page.getByText("Local draft — not uploaded")).toBeVisible();
    await expect(page.getByLabel("Sheet title")).toBeVisible();
    await expect(page.getByLabel("Sheet language")).toBeVisible();
    await expect(page.getByLabel("Code editor")).toBeVisible();
    await expect(page.locator(".cm-editor")).toBeVisible();

    // No remote claims or controls.
    await expect(page.getByText(/\bLive\b|Connecting|Shared|Saving|Saved/)).toHaveCount(0);
    await expect(page.getByRole("button", { name: /share/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /copy .*link/i })).toHaveCount(0);
    await expect(page.getByLabel(/echo:\/\//)).toHaveCount(0);
    await expect(page.getByTestId("timeline-rail")).toHaveCount(0);

    await expect(page.locator(".cm-content")).toHaveText("");
  });

  test("non-root paths render the unavailable state, not a draft", async ({
    page,
  }) => {
    for (const path of ["/r/demo", "/some/arbitrary/path"]) {
      await page.goto(path);
      await expect(page.getByText("This link is unavailable")).toBeVisible();
      await expect(page.locator(".cm-editor")).toHaveCount(0);
      await expect(page.getByText("Local draft — not uploaded")).toHaveCount(0);
      await expect(page.getByLabel("Sheet title")).toHaveCount(0);
      await expect(page.getByText(/\bLive\b|Connecting|Shared|Saved/)).toHaveCount(0);
    }
  });

  test("opens no collaboration/application WebSocket while editing (no upload before Share)", async ({
    page,
  }) => {
    const sockets: string[] = [];
    page.on("websocket", (ws) => sockets.push(ws.url()));

    await page.goto("/");
    await page.locator(".cm-content").click();
    await page.keyboard.type("const x = 1;");
    await page.waitForTimeout(300);

    // In development Vite may open exactly its own HMR channel, which is
    // same-origin with the dev server and matches this precise pattern. Galley
    // itself opens NO WebSocket before Share — in particular nothing to a
    // collaboration server (:1234), no `/r/` path, no other non-HMR socket.
    const VITE_HMR = /^ws:\/\/127\.0\.0\.1:5173\/\?token=/;
    for (const url of sockets) {
      expect(url).not.toContain(":1234");
      expect(url).not.toContain("/r/");
    }
    const nonHmr = sockets.filter((url) => !VITE_HMR.test(url));
    expect(nonHmr).toEqual([]);
  });

  test("local editing works", async ({ page }) => {
    await page.goto("/");
    const token = `draft_edit_${Date.now()}`;
    await page.locator(".cm-content").click();
    await page.keyboard.type(token);
    await expect(page.locator(".cm-content")).toContainText(token);
  });

  test("real Yjs undo and redo via the editor keymap", async ({ page }) => {
    await page.goto("/");
    const token = `redo_${Date.now()}`;
    await page.locator(".cm-content").click();
    await page.keyboard.type(token);
    await expect(page.locator(".cm-content")).toContainText(token);

    // Undo (Mod-Z on all platforms).
    await page.keyboard.press(`${MOD}+z`);
    await expect(page.locator(".cm-content")).not.toContainText(token);

    // Redo (Mod-Shift-Z — the macOS redo binding, also bound on other platforms
    // by the installed yUndoManagerKeymap).
    await page.keyboard.press(`${MOD}+Shift+z`);
    await expect(page.locator(".cm-content")).toContainText(token);
  });

  test("Find: query highlights matches, Escape closes and returns focus to the editor", async ({
    page,
  }) => {
    await page.goto("/");
    await page.locator(".cm-content").click();
    await page.keyboard.type("alpha beta alpha beta alpha");

    // Open the standard CodeMirror search panel; the search field is focused.
    await page.keyboard.press(`${MOD}+f`);
    await expect(page.locator(".cm-panel.cm-search")).toBeVisible();

    // Enter a query and verify real matches are highlighted.
    await page.keyboard.type("alpha");
    await expect(page.locator(".cm-searchMatch").first()).toBeVisible();

    // Escape closes the panel and returns focus to the editor.
    await page.keyboard.press("Escape");
    await expect(page.locator(".cm-panel.cm-search")).toHaveCount(0);

    // Editing continues in the editor (focus was restored).
    await page.keyboard.type(" gamma");
    await expect(page.locator(".cm-content")).toContainText("gamma");
  });

  test("language control updates and the editor remains usable", async ({
    page,
  }) => {
    await page.goto("/");
    const select = page.getByLabel("Sheet language");
    await expect(select).toHaveValue("typescript");
    await select.selectOption("python");
    await expect(select).toHaveValue("python");

    // Editing still works after changing the language.
    await page.locator(".cm-content").click();
    await page.keyboard.type("value = 1");
    await expect(page.locator(".cm-content")).toContainText("value = 1");
  });

  test("reload starts a fresh, empty draft", async ({ page }) => {
    await page.goto("/");
    await page.locator(".cm-content").click();
    await page.keyboard.type("should not survive reload");
    await expect(page.locator(".cm-content")).toContainText("should not survive");

    await page.reload();
    await expect(page.locator(".cm-content")).toHaveText("");
  });
});
