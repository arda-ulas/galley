import { expect, test } from "@playwright/test";

test("renders the static demo room", async ({ page }) => {
  await page.goto("/r/demo");

  await expect(page.getByText("Echo/Rewind")).toBeVisible();
  await expect(page.getByText("/r/demo")).toBeVisible();
  await expect(page.getByText("CodeMirror placeholder")).toBeVisible();
  await expect(page.getByText("Session timeline")).toBeVisible();
});
