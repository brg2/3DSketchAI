import { test as base, expect, type Page } from "@playwright/test";

let sharedContext = null;
let sharedPage = null;
let sharedPageTiled = false;
let sharedPageTitle = "";
let sharedPageTitleListenerInstalled = false;

const TILE_WINDOWS = process.env.PLAYWRIGHT_TILE_WINDOWS !== "0";
const TILE_COLUMNS = optionalPositiveInteger(process.env.PLAYWRIGHT_TILE_COLUMNS);
const TILE_COUNT = optionalPositiveInteger(process.env.PLAYWRIGHT_TILE_COUNT);
const TILE_WIDTH = optionalPositiveInteger(process.env.PLAYWRIGHT_TILE_WIDTH);
const TILE_HEIGHT = optionalPositiveInteger(process.env.PLAYWRIGHT_TILE_HEIGHT);
const TILE_SCREEN_WIDTH = positiveInteger(process.env.PLAYWRIGHT_TILE_SCREEN_WIDTH, 3440);
const TILE_SCREEN_HEIGHT = positiveInteger(process.env.PLAYWRIGHT_TILE_SCREEN_HEIGHT, 1440);
const TILE_SCREEN_LEFT = integer(process.env.PLAYWRIGHT_TILE_SCREEN_LEFT, 0);
const TILE_SCREEN_TOP = integer(process.env.PLAYWRIGHT_TILE_SCREEN_TOP, 0);
const TILE_LEFT = nonNegativeInteger(process.env.PLAYWRIGHT_TILE_LEFT, 0);
const TILE_TOP = nonNegativeInteger(process.env.PLAYWRIGHT_TILE_TOP, 24);
const TILE_GAP = nonNegativeInteger(process.env.PLAYWRIGHT_TILE_GAP, 8);
const TILE_TARGET_ASPECT = positiveNumber(process.env.PLAYWRIGHT_TILE_TARGET_ASPECT, 16 / 9);

type TestTitleWindow = Window & {
  __PW_TEST_TITLE__?: string;
  __PW_SHOW_TEST_TITLE__?: (title: string) => void;
};

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
  page: async ({ context }, use, testInfo) => {
    sharedPageTitle = testInfo.title;
    if (!sharedPage || sharedPage.isClosed()) {
      sharedPage = await context.newPage();
      await sharedPage.addInitScript((title) => {
        const showTitle = (label: string) => {
          const testWindow = window as TestTitleWindow;
          testWindow.__PW_TEST_TITLE__ = label;
          testWindow.__PW_SHOW_TEST_TITLE__ = showTitle;
          let banner = document.getElementById("pw-test-title");
          if (!banner) {
            banner = document.createElement("div");
            banner.id = "pw-test-title";
            banner.style.position = "fixed";
            banner.style.left = "12px";
            banner.style.bottom = "12px";
            banner.style.zIndex = "2147483647";
            banner.style.maxWidth = "min(920px, calc(100vw - 24px))";
            banner.style.padding = "7px 10px";
            banner.style.borderRadius = "6px";
            banner.style.background = "rgba(10, 17, 28, 0.84)";
            banner.style.color = "#ffffff";
            banner.style.font = "12px/1.35 system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
            banner.style.boxShadow = "0 8px 24px rgba(0, 0, 0, 0.2)";
            banner.style.pointerEvents = "none";
            banner.style.whiteSpace = "normal";
            (document.body ?? document.documentElement).appendChild(banner);
          }
          banner.textContent = `E2E: ${label}`;
        };
        window.addEventListener("DOMContentLoaded", () => {
          showTitle(title);
        });
      }, testInfo.title);
      sharedPageTitleListenerInstalled = false;
    }
    if (!sharedPageTitleListenerInstalled) {
      sharedPage.on("domcontentloaded", () => {
        const title = sharedPageTitle;
        void showTestTitle(sharedPage, title);
      });
      sharedPageTitleListenerInstalled = true;
    }
    if (!sharedPageTiled) {
      await tileHeadedWorkerWindow(sharedPage, testInfo.workerIndex, testInfo.config.workers);
      sharedPageTiled = true;
    }
    await showTestTitle(sharedPage, testInfo.title);
    await use(sharedPage);
  },
});

export { expect };

async function tileHeadedWorkerWindow(page: Page, workerIndex: number, configuredWorkers: number) {
  if (!TILE_WINDOWS) {
    return;
  }
  try {
    const screenBounds = {
      left: TILE_SCREEN_LEFT,
      top: TILE_SCREEN_TOP,
      width: TILE_SCREEN_WIDTH,
      height: TILE_SCREEN_HEIGHT,
    };
    const tileCount = Math.max(1, TILE_COUNT ?? configuredWorkers ?? 1);
    const layout = chooseTileLayout(tileCount, screenBounds.width, screenBounds.height);
    const columns = Math.max(1, Math.min(TILE_COLUMNS ?? layout.columns, tileCount));
    const rows = Math.max(1, Math.ceil(tileCount / columns));
    const slot = positiveModulo(workerIndex, tileCount);
    const column = slot % columns;
    const row = Math.floor(slot / columns);
    const availableWidth = Math.max(1, screenBounds.width - TILE_LEFT * 2 - TILE_GAP * (columns - 1));
    const availableHeight = Math.max(1, screenBounds.height - TILE_TOP * 2 - TILE_GAP * (rows - 1));
    const autoWidth = Math.floor(availableWidth / columns);
    const autoHeight = Math.floor(availableHeight / rows);
    const width = Math.max(1, Math.min(TILE_WIDTH ?? autoWidth, autoWidth));
    const height = Math.max(1, Math.min(TILE_HEIGHT ?? autoHeight, autoHeight));

    const session = await page.context().newCDPSession(page);
    const { windowId } = await session.send("Browser.getWindowForTarget");
    await session.send("Browser.setWindowBounds", {
      windowId,
      bounds: {
        left: screenBounds.left + TILE_LEFT + column * (autoWidth + TILE_GAP),
        top: screenBounds.top + TILE_TOP + row * (autoHeight + TILE_GAP),
        width,
        height,
        windowState: "normal",
      },
    });
    await session.detach();
  } catch {
    // Headless and non-Chromium runs may not expose a movable browser window.
  }
}

async function showTestTitle(page: Page, title: string) {
  await page.evaluate((nextTitle) => {
    const testWindow = window as TestTitleWindow;
    testWindow.__PW_TEST_TITLE__ = nextTitle;
    testWindow.__PW_SHOW_TEST_TITLE__ = (label) => {
      let banner = document.getElementById("pw-test-title");
      if (!banner) {
        banner = document.createElement("div");
        banner.id = "pw-test-title";
        banner.style.position = "fixed";
        banner.style.left = "12px";
        banner.style.bottom = "12px";
        banner.style.zIndex = "2147483647";
        banner.style.maxWidth = "min(920px, calc(100vw - 24px))";
        banner.style.padding = "7px 10px";
        banner.style.borderRadius = "6px";
        banner.style.background = "rgba(10, 17, 28, 0.84)";
        banner.style.color = "#ffffff";
        banner.style.font = "12px/1.35 system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
        banner.style.boxShadow = "0 8px 24px rgba(0, 0, 0, 0.2)";
        banner.style.pointerEvents = "none";
        banner.style.whiteSpace = "normal";
        (document.body ?? document.documentElement).appendChild(banner);
      }
      banner.textContent = `E2E: ${label}`;
    };
    testWindow.__PW_SHOW_TEST_TITLE__(nextTitle);
  }, title).catch(() => {});
}

function optionalPositiveInteger(value: string | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function integer(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
}

function nonNegativeInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

function positiveNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function positiveModulo(value: number, divisor: number) {
  return ((value % divisor) + divisor) % divisor;
}

function chooseTileLayout(tileCount: number, screenWidth: number, screenHeight: number) {
  let best = { columns: 1, rows: tileCount, score: -Infinity };
  for (let columns = 1; columns <= tileCount; columns += 1) {
    const rows = Math.ceil(tileCount / columns);
    const availableWidth = Math.max(1, screenWidth - TILE_LEFT * 2 - TILE_GAP * (columns - 1));
    const availableHeight = Math.max(1, screenHeight - TILE_TOP * 2 - TILE_GAP * (rows - 1));
    const cellWidth = availableWidth / columns;
    const cellHeight = availableHeight / rows;
    const aspect = cellWidth / cellHeight;
    const wastedSlots = columns * rows - tileCount;
    const aspectPenalty = Math.abs(Math.log(aspect / TILE_TARGET_ASPECT));
    const score = (cellWidth * cellHeight) - aspectPenalty * 120_000 - wastedSlots * 20_000;
    if (score > best.score) {
      best = { columns, rows, score };
    }
  }
  return best;
}
