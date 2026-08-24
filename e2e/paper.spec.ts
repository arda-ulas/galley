import { expect, test } from "@playwright/test";

/**
 * DEF-1 / DEF-2 (M4.5 §5.2) verified in a real browser.
 *
 * The amber leak was not visible in any unit test: `tokens.css` reached the page
 * through three computed CSS rules, and jsdom computes no cascade worth trusting.
 * These assertions read the values the browser actually resolved.
 *
 * Amber was `--accent: #F5A623` → `rgb(245, 166, 35)`, on a `:root` that also
 * declared `color-scheme: dark`, which forced dark native `<select>` dropdowns,
 * scrollbars, and focus rings inside a warm-white sheet.
 */

/** The retired amber accent, in the form getComputedStyle returns. */
const AMBER = "245, 166, 35";
/** The retired dark page background, `--bg: #0D0B09`. */
const DARK_BG = "13, 11, 9";

test.describe("Paper surface — no amber, no dark native UI (DEF-1)", () => {
  test("::selection is the Paper accent, not amber", async ({ page }) => {
    await page.goto("/");

    const selectionBackground = await page.evaluate(() => {
      const declaration = getComputedStyle(document.documentElement, "::selection");
      return declaration.backgroundColor;
    });

    expect(selectionBackground).not.toContain(AMBER);
    // The restrained blue accent (PAPER.accentYou #3B5BA5) at a 14% wash.
    expect(selectionBackground).toContain("59, 91, 165");
  });

  test("a real text selection paints no amber pixel", async ({ page }) => {
    await page.goto("/");

    // Select the header status phrase — real, non-CodeMirror page text, which is
    // exactly what the amber ::selection rule used to paint.
    const phrase = page.getByTestId("draft-state");
    await expect(phrase).toBeVisible();
    await phrase.evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    });
    await expect
      .poll(() => page.evaluate(() => String(window.getSelection())))
      .not.toBe("");

    // Sample the rendered pixels of the selected phrase and assert none of them
    // is the amber highlight. A screenshot is the only way to see the painted
    // selection layer — it is not in the DOM.
    const shot = await phrase.screenshot();
    const amberPixels = await page.evaluate(
      async (bytes) => {
        const blob = new Blob([new Uint8Array(bytes)], { type: "image/png" });
        const bitmap = await createImageBitmap(blob);
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(bitmap, 0, 0);
        const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
        let hits = 0;
        for (let i = 0; i < data.length; i += 4) {
          // Amber #F5A623 blended at 38% over warm white lands near
          // (250, 220, 172). Anything strongly orange — red high, blue low —
          // is the retired accent; Paper's palette has no such colour.
          const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
          if (r > 200 && g > 140 && g < 230 && b < 150 && r - b > 80) hits++;
        }
        return hits;
      },
      Array.from(shot),
    );

    expect(amberPixels).toBe(0);
  });

  test("the page background is Paper canvas, not the retired dark", async ({
    page,
  }) => {
    await page.goto("/");
    const background = await page.evaluate(
      () => getComputedStyle(document.documentElement).backgroundColor,
    );
    expect(background).not.toContain(DARK_BG);
    expect(background).toBe("rgb(236, 231, 221)"); // PAPER.canvas #ECE7DD
  });

  test("color-scheme is light, so native controls render light", async ({
    page,
  }) => {
    await page.goto("/");

    const scheme = await page.evaluate(
      () => getComputedStyle(document.documentElement).colorScheme,
    );
    expect(scheme).toBe("light");

    // The language control is the one native <select> on the page. It inherits
    // the root color-scheme, which is what made its dropdown render dark.
    const selectScheme = await page
      .getByLabel("Sheet language")
      .evaluate((el) => getComputedStyle(el).colorScheme);
    expect(selectScheme).toBe("light");
  });

  test("no stylesheet still declares the amber token", async ({ page }) => {
    await page.goto("/");

    // `--accent`, `--bg`, and the rest came from tokens.css. If any survives,
    // the deletion was partial and the cascade can regress silently.
    const tokens = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      return {
        accent: root.getPropertyValue("--accent").trim(),
        bg: root.getPropertyValue("--bg").trim(),
        text: root.getPropertyValue("--text").trim(),
      };
    });

    expect(tokens).toEqual({ accent: "", bg: "", text: "" });
  });
});

test.describe("Document identity (DEF-2)", () => {
  test("the tab title names the current product, not the retired one", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page).toHaveTitle("Galley");
    // Names the RETIRED product deliberately — the guard is only meaningful
    // against the literal wording it asserts is absent.
    await expect(page).not.toHaveTitle(/Echo|Rewind/);
  });

  test("a favicon is declared and actually served", async ({ page }) => {
    await page.goto("/");

    const href = await page
      .locator('link[rel="icon"]')
      .getAttribute("href");
    expect(href).toBe("/favicon.svg");

    const response = await page.request.get("/favicon.svg");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("image/svg+xml");
  });
});
