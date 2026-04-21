import { test as base, expect } from "@playwright/test";

let sharedContext = null;
let sharedPage = null;

export const test = base.extend({
  context: async (
    { browser },
    use,
  ) => {
    if (!sharedContext) {
      sharedContext = await browser.newContext({
        viewport: { width: 1280, height: 720 },
        deviceScaleFactor: 1,
        colorScheme: "light",
        reducedMotion: "reduce",
      });
    }
    await use(sharedContext);
  },
  page: async ({ context }, use) => {
    if (!sharedPage || sharedPage.isClosed()) {
      sharedPage = await context.newPage();
    }
    await use(sharedPage);
  },
});

export { expect };
