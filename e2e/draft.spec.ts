import { expect, test } from "@playwright/test";

const MOD = process.platform === "darwin" ? "Meta" : "Control";

// Redo is verified through each platform's canonical, first-class binding from
// the installed `yUndoManagerKeymap` — `{ key: 'Mod-y', mac: 'Mod-Shift-z', run:
// redo }` — i.e. Cmd-Shift-Z on macOS and Ctrl-Y on Linux/Windows.
//
// Ctrl-Shift-Z is also bound on non-mac, but it is NOT reliable through
// synthesized input: a Shift+letter chord can arrive with a lowercase `key`
// ("z"), which `w3c-keyname` (mac=false) reports verbatim. CodeMirror then
// resolves the Ctrl-Z (undo) binding first, and y-codemirror.next's undo command
// returns truthy even on an empty stack (`undoManager.undo() != null || true`),
// so the keymap treats the event as handled and never falls through to redo —
// the redo becomes a silent no-op. Ctrl-Y carries no Shift and collides with no
// other binding, so it exercises redo unambiguously on those platforms. On macOS
// the same chord resolves cleanly (keyName maps the shifted code to "Z", which
// routes to Cmd-Shift-Z), so the platform-native shortcut is used there.
const REDO = process.platform === "darwin" ? `${MOD}+Shift+z` : `${MOD}+y`;

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

    // The visible Share control is present (M4 gate); no post-share/remote claims.
    await expect(page.getByRole("button", { name: "Share" })).toBeVisible();
    await expect(page.getByText(/\bLive\b|Connecting|Shared|Saving|Saved/)).toHaveCount(0);
    await expect(page.getByRole("button", { name: /copy .*link/i })).toHaveCount(0);
    // The RETIRED prototype's room-address aria-label, named deliberately: the
    // guard only works against the literal string it asserts is absent.
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
    const editor = page.locator(".cm-content");
    await editor.click();
    // The keymap only fires when the editable surface holds focus, so every
    // undo/redo below is gated on an explicit focus assertion rather than a
    // timing assumption.
    await expect(editor).toBeFocused();
    await page.keyboard.type(token);
    await expect(editor).toContainText(token);

    // Undo (Mod-Z on all platforms).
    await expect(editor).toBeFocused();
    await page.keyboard.press(`${MOD}+z`);
    await expect(editor).not.toContainText(token);

    // Redo via the platform's canonical editor binding (see REDO above).
    await expect(editor).toBeFocused();
    await page.keyboard.press(REDO);
    await expect(editor).toContainText(token);
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
