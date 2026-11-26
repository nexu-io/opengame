import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { JSDOM } from 'jsdom';

function makeCanvasContextStub() {
  const grad = { addColorStop() {} };
  return new Proxy(
    {
      canvas: { width: 750, height: 1440 },
      measureText: (t: string) => ({ width: String(t).length * 8 }),
      createLinearGradient: () => grad,
      createRadialGradient: () => grad,
      getImageData: () => ({ data: new Uint8ClampedArray(4) }),
      setLineDash() {},
    },
    {
      get(target, prop) {
        if (prop in target) return (target as Record<PropertyKey, unknown>)[prop];
        return () => {};
      },
      set(target, prop, value) {
        (target as Record<PropertyKey, unknown>)[prop] = value;
        return true;
      },
    },
  );
}

async function bootTemplateInJsdom(templateDir: string, scriptPaths: string[], initialStorage?: Record<string, string>) {
  const html = await readFile(path.join(templateDir, 'index.html'), 'utf8');
  // Strip script tags so we execute local scripts in controlled order with stubbed canvas/timers.
  const cleanHtml = html.replace(/<script\b[^>]*><\/script>/gi, '');
  const dom = new JSDOM(cleanHtml, {
    url: 'http://localhost/?lang=en',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const win = dom.window as unknown as Record<string, any>;

  const ctxStub = makeCanvasContextStub();
  win.HTMLCanvasElement.prototype.getContext = () => ctxStub;
  win.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,iVBORw0KGgo=';
  win.scrollTo = () => {};

  if (initialStorage) {
    for (const [k, v] of Object.entries(initialStorage)) {
      win.localStorage.setItem(k, v);
    }
  }

  // Deterministic controllable rAF + setInterval harness
  let nextId = 1;
  let rafQueue = new Map<number, (ts: number) => void>();
  const intervals = new Map<number, () => void>();
  let nowMs = 1000;

  win.requestAnimationFrame = (cb: (ts: number) => void) => {
    const id = nextId++;
    rafQueue.set(id, cb);
    return id;
  };
  win.cancelAnimationFrame = (id: number) => {
    rafQueue.delete(id);
  };
  win.setInterval = (cb: () => void) => {
    const id = nextId++;
    intervals.set(id, cb);
    return id;
  };
  win.clearInterval = (id: number) => {
    intervals.delete(id);
  };

  const stepFrame = (deltaMs = 32) => {
    nowMs += deltaMs;
    const batch = [...rafQueue.values()];
    rafQueue = new Map();
    for (const cb of batch) cb(nowMs);
  };
  const tickIntervals = (times = 1) => {
    for (let i = 0; i < times; i++) {
      for (const cb of [...intervals.values()]) cb();
    }
  };

  for (const rel of scriptPaths) {
    const src = await readFile(path.join(templateDir, rel), 'utf8');
    dom.window.eval(src);
  }
  // Scripts register DOMContentLoaded or run init() immediately when readyState !== 'loading'.
  stepFrame(16);

  return { dom, win, stepFrame, tickIntervals };
}

test('slacking-evo pauses physics and 60s Rush countdown while a modal is open and resumes on close', async () => {
  const { dom, win, stepFrame, tickIntervals } = await bootTemplateInJsdom(
    path.resolve('templates/games/slacking-evo'),
    ['data.js', 'storage.js', 'slack-art.js', 'app.js'],
  );
  try {
    const doc = dom.window.document;
    // Switch to 60s Rush mode
    const rushTab = doc.querySelector<HTMLButtonElement>('.mode-tab[data-mode="lunch60"]');
    assert.ok(rushTab);
    rushTab.click();
    assert.equal(doc.getElementById('hudMidVal')?.textContent?.trim(), '60s');

    // Run 2 ticks + 2 seconds normally
    stepFrame(32);
    stepFrame(32);
    tickIntervals(2);
    const tickBeforeModal = win.__omGame.getState().tick;
    assert.equal(doc.getElementById('hudMidVal')?.textContent?.trim(), '58s');
    assert.equal(win.__omGame.getState().running, true);

    // Open Rank modal: physics and countdown must pause
    doc.getElementById('btnOpenRank')!.click();
    assert.equal(win.__omGame.getState().running, false);
    stepFrame(32);
    stepFrame(32);
    tickIntervals(5);
    assert.equal(win.__omGame.getState().tick, tickBeforeModal);
    assert.equal(doc.getElementById('hudMidVal')?.textContent?.trim(), '58s');

    // Close Rank modal: both physics and countdown resume
    doc.querySelector<HTMLButtonElement>('[data-close-modal="rankModal"]')!.click();
    assert.equal(win.__omGame.getState().running, true);
    stepFrame(32);
    tickIntervals(1);
    assert.equal(win.__omGame.getState().tick, tickBeforeModal + 1);
    assert.equal(doc.getElementById('hudMidVal')?.textContent?.trim(), '57s');

    // Open Dex modal: also pauses, and Boss Camo pause still holds independently
    doc.getElementById('btnOpenDex')!.click();
    stepFrame(32);
    tickIntervals(3);
    assert.equal(win.__omGame.getState().tick, tickBeforeModal + 1);
    assert.equal(doc.getElementById('hudMidVal')?.textContent?.trim(), '57s');

    doc.querySelector<HTMLButtonElement>('[data-close-modal="dexModal"]')!.click();
    doc.getElementById('btnBossCamo')!.click();
    assert.equal(win.__omGame.getState().running, false);
    stepFrame(32);
    tickIntervals(3);
    assert.equal(win.__omGame.getState().tick, tickBeforeModal + 1);
    assert.equal(doc.getElementById('hudMidVal')?.textContent?.trim(), '57s');
  } finally {
    dom.window.close();
  }
});

test('slacking-evo resets Daily Seed best and local leaderboard when the date rolls past midnight while open', async () => {
  const { dom, win } = await bootTemplateInJsdom(
    path.resolve('templates/games/slacking-evo'),
    ['data.js', 'storage.js', 'slack-art.js', 'app.js'],
  );
  try {
    const doc = dom.window.document;
    const todayKey = win.SlackData.getLocalDateKey();
    // Seed a saved same_desk record for today and re-boot so hydrateProfile keeps today's data
    const seeded = JSON.stringify({
      lang: 'en',
      soundEnabled: true,
      bestByMode: { daily_office: 100, lunch60: 200, same_desk: 450 },
      runsByMode: {
        daily_office: [],
        lunch60: [],
        same_desk: [{ score: 450, maxLevel: 6, maxCombo: 3, kingCount: 0, ts: Date.now() }],
      },
      unlockedLevels: [0, 1, 2, 6],
      totalKings: 0,
      totalGames: 1,
      totalBossDodges: 0,
      dailyDateKey: todayKey,
    });
    dom.window.close();

    const session = await bootTemplateInJsdom(
      path.resolve('templates/games/slacking-evo'),
      ['data.js', 'storage.js', 'slack-art.js', 'app.js'],
      { og_slacking_evo_v1: seeded },
    );
    try {
      const sDoc = session.dom.window.document;
      // Switch to same_desk while still on todayKey: yesterday/today seeded best 450 is visible
      sDoc.querySelector<HTMLButtonElement>('.mode-tab[data-mode="same_desk"]')!.click();
      assert.equal(sDoc.getElementById('hudMidVal')?.textContent?.trim(), '450');

      // Advance clock past midnight while the tab stays open
      const tomorrowKey = String(Number(todayKey) + 1);
      session.win.SlackData.getLocalDateKey = () => tomorrowKey;

      // Start a new Daily Seed run (via Restart): stale best & runs must reset and persist new key
      sDoc.getElementById('btnRestart')!.click();
      assert.equal(sDoc.getElementById('hudMidVal')?.textContent?.trim(), '0');

      sDoc.getElementById('btnOpenRank')!.click();
      assert.equal(sDoc.querySelectorAll('#rankList .rank-item').length, 0);

      const persisted = JSON.parse(session.win.localStorage.getItem('og_slacking_evo_v1') || '{}');
      assert.equal(persisted.dailyDateKey, tomorrowKey);
      assert.equal(persisted.bestByMode.same_desk, 0);
      assert.deepEqual(persisted.runsByMode.same_desk, []);
    } finally {
      session.dom.window.close();
    }
  } finally {
    // outer dom already closed
  }
});

test('fruit-gym restores the next-day start card when dismissing Shop or Poster via backdrop after finishDay', async () => {
  const { dom, win, stepFrame } = await bootTemplateInJsdom(
    path.resolve('templates/games/fruit-gym'),
    ['js/data.js', 'js/sound.js', 'js/storage.js', 'js/poster.js', 'js/game.js'],
  );
  try {
    const doc = dom.window.document;
    const startOverlay = doc.getElementById('startOverlay')!;
    const modalSummary = doc.getElementById('modalSummary')!;
    const modalShop = doc.getElementById('modalShop')!;
    const modalPoster = doc.getElementById('modalPoster')!;

    // Start Day 1 and step frames until Day 1 ends and Summary opens
    doc.getElementById('btnStartDay')!.click();
    assert.equal(startOverlay.classList.contains('hidden'), true);
    assert.equal(win.__omGame.getState().running, true);

    for (let i = 0; i < 2000 && win.__omGame.getState().running; i++) {
      stepFrame(50);
    }
    assert.equal(win.__omGame.getState().running, false);
    assert.equal(modalSummary.classList.contains('hidden'), false);
    assert.equal(startOverlay.classList.contains('hidden'), true);

    // Case 1: Summary -> Upgrade Gym -> dismiss Shop by clicking its backdrop
    doc.getElementById('btnSumShop')!.click();
    assert.equal(modalSummary.classList.contains('hidden'), true);
    assert.equal(modalShop.classList.contains('hidden'), false);

    modalShop.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    assert.equal(modalShop.classList.contains('hidden'), true);
    assert.equal(startOverlay.classList.contains('hidden'), false, 'Next-day start overlay must be restored after Shop backdrop dismissal');

    // Start Day 2, finish Day 2, then test Summary -> Daily Receipt Poster -> dismiss Poster via backdrop
    doc.getElementById('btnStartDay')!.click();
    assert.equal(win.__omGame.getState().running, true);
    for (let i = 0; i < 2500 && win.__omGame.getState().running; i++) {
      stepFrame(50);
    }
    assert.equal(win.__omGame.getState().running, false);
    assert.equal(modalSummary.classList.contains('hidden'), false);

    doc.getElementById('btnSumPoster')!.click();
    assert.equal(modalPoster.classList.contains('hidden'), false);

    modalPoster.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    assert.equal(modalPoster.classList.contains('hidden'), true);
    assert.equal(startOverlay.classList.contains('hidden'), false, 'Next-day start overlay must be restored after Poster backdrop dismissal');
  } finally {
    dom.window.close();
  }
});
