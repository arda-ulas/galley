import { expect, test } from "@playwright/test";

/**
 * T5 (M4.5 §5.5) end-to-end: one click yields a file whose name derives from the
 * sheet's title and whose extension derives from its language, containing exactly
 * the current live text.
 *
 * The unit tests cover derivation and sanitization in isolation. What only a real
 * browser can prove is that the anchor/blob mechanism actually produces a
 * download — and that the deferred `revokeObjectURL` does not cancel it before
 * the bytes are written.
 */

/** Read a completed download's bytes as text. */
async function downloadText(download: {
  createReadStream: () => Promise<NodeJS.ReadableStream>;
}): Promise<string> {
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

test.describe("Download / export", () => {
  test("downloads the live text under a title-derived name and language extension", async ({
    page,
  }) => {
    await page.goto("/");

    await page.getByLabel("Sheet title").fill("binary search");
    await page.getByLabel("Sheet language").selectOption("python");

    const body = "def search(xs, target):\n    return -1\n";
    await page.locator(".cm-content").click();
    await page.keyboard.type(body);
    await expect(page.locator(".cm-content")).toContainText("def search");

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId("download-button").click(),
    ]);

    expect(download.suggestedFilename()).toBe("binary search.py");
    // Exactly the current live text — CodeMirror auto-indents, so compare on the
    // content that was actually typed rather than the raw keystrokes.
    const text = await downloadText(download);
    expect(text).toContain("def search(xs, target):");
    expect(text).toContain("return -1");
  });

  test("uses the canonical extension for each language", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Sheet title").fill("utils");

    for (const [language, extension] of [
      ["javascript", "js"],
      ["typescript", "ts"],
      ["python", "py"],
      ["plaintext", "txt"],
    ] as const) {
      await page.getByLabel("Sheet language").selectOption(language);
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        page.getByTestId("download-button").click(),
      ]);
      expect(download.suggestedFilename()).toBe(`utils.${extension}`);
    }
  });

  test("falls back to untitled when the sheet has no title", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByLabel("Sheet title")).toHaveValue("");

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId("download-button").click(),
    ]);

    expect(download.suggestedFilename()).toBe("untitled.ts");
  });

  test("sanitizes a title that would otherwise escape the download folder", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByLabel("Sheet title").fill("../../etc/passwd");
    await page.getByLabel("Sheet language").selectOption("plaintext");

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId("download-button").click(),
    ]);

    const name = download.suggestedFilename();
    expect(name).toBe("etc-passwd.txt");
    expect(name).not.toContain("/");
    expect(name).not.toContain("\\");
  });

  test("downloads an empty sheet without failing", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Sheet title").fill("empty");
    await page.getByLabel("Sheet language").selectOption("plaintext");

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId("download-button").click(),
    ]);

    expect(download.suggestedFilename()).toBe("empty.txt");
    expect(await downloadText(download)).toBe("");
  });

  test("a joiner on a shared sheet can download the text too", async ({
    browser,
    page,
  }) => {
    // Sharer: create a sheet with real content.
    await page.goto("/");
    await page.getByLabel("Sheet title").fill("shared notes");
    await page.getByLabel("Sheet language").selectOption("plaintext");
    await page.locator(".cm-content").click();
    await page.keyboard.type("visible to both sides");

    // `exact` matters: the Download control's accessible name embeds the sheet
    // title, and this sheet's title contains the word "shared".
    await page.getByRole("button", { name: "Share", exact: true }).click();
    await expect(page.getByTestId("draft-state")).toContainText("Shared");
    // The id alphabet is base64url — `-` and `_` are in it (src/lib/sheetId.ts).
    await expect(page).toHaveURL(/\/[A-Za-z0-9_-]{16}$/);
    const sheetUrl = page.url();

    // Joiner: open the same link in a separate browser context.
    const joinerContext = await browser.newContext();
    const joiner = await joinerContext.newPage();
    try {
      await joiner.goto(sheetUrl);
      await expect(joiner.locator(".cm-content")).toContainText(
        "visible to both sides",
      );

      const [download] = await Promise.all([
        joiner.waitForEvent("download"),
        joiner.getByTestId("download-button").click(),
      ]);

      expect(download.suggestedFilename()).toBe("shared notes.txt");
      expect(await downloadText(download)).toContain("visible to both sides");
    } finally {
      await joinerContext.close();
    }
  });
});
