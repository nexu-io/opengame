/* ==========================================================================
   game.js — Fruit Gym Tycoon 2.5D H5 Canvas Game Engine (Bilingual ZH / EN)
   Living storefront, swinging glass doors, walking/hopping fruits,
   drag-or-tap controls, playable sprinting Gym Boss, flying gold coins,
   day/night/VIP/Olympics lighting & roaming hired helpers.
   ========================================================================== */
(function (global) {
  'use strict';

  var D = global.FruitGymData;
  var S = global.FruitGymSound;
  var ST = global.FruitGymStorage;
  var P = global.FruitGymPoster;

  var W = 750;
  var H = 1440;
  var viewScale = 1;
  var offsetX = 0;
  var cssW = 390;
  var cssH = 780;

  var L = {
    hudBottom: 112,
    dockTop: 1290,
    sidewalkY: 162,
    awningTop: 186,
    wallTop: 244,
    floorTop: 376,
    doorX: 258,
    counterX: 500,
    queueY: 446,
    row1Y: 676,
    row2Y: 942,
    staffY: 1170
  };

  var QUEUE_XS = [118, 258, 398];

  var UI = {
    zh: {
      pageTitle: '水果健身房',
      cur: '¥',
      langToggle: 'EN',
      dayBadge: function (d) { return '第 ' + d + ' 天'; },
      startKicker: function (d, goal) { return '第 ' + d + ' 天 · 三星目标 ¥' + goal; },
      startBtn: function (d) { return '开门营业（第 ' + d + ' 天）'; },
      shopBtn: '扩店升级',
      feverActive: function (s) { return '暴汗加速 ' + s + 's'; },
      feverReady: '敲打气钟!',
      feverPct: function (p) { return '打气 ' + p + '%'; },
      tipStart: '点按或拖拽门口水果上器械，点气泡派店长奔跑照料！',
      tipDirty: function (name) { return name + '有汗渍，点一下让店长擦干！'; },
      tipBusy: function (name) { return name + '正被占用，稍等片刻～'; },
      tipBusyAlt: function (name) { return name + '正忙，等里面的水果练完～'; },
      tipEmpty: function (name) { return name + '正空着，等待想来练它的水果～'; },
      tipSeated: function (fruit, st) { return fruit + '欢快跑向' + st + '！'; },
      tipFlash: function (combo) { return '明星打卡闪光！Combo x' + combo + ' 全单结账 +25%！'; },
      tipServed: function (byHelper, combo, tip) {
        return (byHelper ? '西瓜助教出手！' : '店长送达！') + '连击 Combo x' + combo + ' 小费 +¥' + tip;
      },
      tipCoinsDay5: function (total) { return '爆金币 +¥' + total + '！点汗渍派店长擦干再领 ¥10 赏金！'; },
      tipCoins: function (total) { return '暴汗蜕变爆金币 +¥' + total + '！点汗渍擦干迎下一位～'; },
      floatWake: '拍醒加油! ',
      floatSupply: '贴心补给! ',
      floatMopDay5: function (byHelper) { return (byHelper ? '小柠檬擦净 ' : '擦汗赏金 ') + '+¥10'; },
      floatMop: function (byHelper) { return byHelper ? '小柠檬擦净!' : '焕然一新!'; },
      floatLeft: '等太久溜啦',
      feverBanner: '全场敲响打气钟！锻炼速度 x2 暴汗冲刺！',
      chalkTitle: '水果能量补给吧',
      unlockBoxing: '点此扩店 · 拳击区 ¥150',
      needSleep: '点我拍醒!',
      needWater: '点我递水!',
      needShake: '点我递奶昔!',
      needTowel: '点我擦汗!',
      dirtyDay5: '点我擦汗 +¥10!',
      dirtyNormal: '点我擦干汗渍!',
      cleanerOn: '小柠檬保洁中',
      cleanerOff: '雇小柠檬 ¥220',
      coachOn: '西瓜助教巡场',
      coachOff: '雇西瓜助教 ¥280',
      sumTitle: function (d, title) { return '第 ' + d + ' 天打烊小票 · ' + title; },
      sumStarOlympic: '今日评价：水果奥运冠军馆！太强了！',
      sumStar3: '今日评价：三星明星健身馆！太强了！',
      sumStar2: '今日评价：二星人气健身馆！继续冲！',
      sumStar1: '今日评价：元气开业馆！升级器械赚更多',
      sumServedLbl: '服务水果会员',
      sumServedVal: function (n) { return n + ' 位'; },
      sumComboLbl: '最高连击 Combo',
      sumTipsLbl: '小费 & 蜕变奖励',
      sumEarnedLbl: '今日总营收',
      btnSumShop: '用金币扩店',
      btnNextDay: function (d) { return '开启第 ' + d + ' 天'; },
      btnSumPoster: '查看 3:4 今日营业财报',
      shopTitle: '健身房扩建 & 雇员',
      shopSub: function (c) { return '当前可用金币：¥' + c; },
      shopMaxed: '已满级',
      toastUpgraded: function (name) { return '已升级：' + name + '！'; },
      albumTitle: '水果蜕变图鉴',
      albumSub: function (u, total) { return '已解锁 ' + u + ' / ' + total + ' 位明星水果蜕变图鉴'; },
      albumLocked: function (name) { return '未解锁 · ' + name; },
      albumCount: function (c) { return '已蜕变 ' + c + ' 次'; },
      rankTitle: '明星馆长营收榜',
      rankSub: '本机单日最高营收纪录',
      rankTabTop: '按营收排行',
      rankTabRecent: '按营业日期',
      rankBanner: function (best, day, served) {
        return '单日最高：¥' + best + ' · 当前第 ' + day + ' 天 · 累计服务 ' + served + ' 位';
      },
      rankRowTitle: function (day, title) { return '第 ' + day + ' 天 · ' + title; },
      rankRowDetail: function (served, combo, stars) {
        return '服务 ' + served + ' 位 · Combo x' + combo + ' · ' + stars + '★';
      },
      rankEmpty: '完成第 1 天营业后，你的每日营收纪录就会登上馆长榜！',
      posterTitle: '今日健身房财报',
      posterSub: '3:4 复古原图，可下载或保存留念',
      btnSavePoster: '下载 PNG 财报',
      posterHint: '也可右键或长按上方财报保存图片',
      posterDownloaded: '今日财报图片已开始下载！',
      posterFallback: '请右键或长按上方财报保存图片'
    },
    en: {
      pageTitle: 'Fruit Gym Tycoon',
      cur: '$',
      langToggle: '中',
      dayBadge: function (d) { return 'Day ' + d; },
      startKicker: function (d, goal) { return 'Day ' + d + ' · 3★ Goal $' + goal; },
      startBtn: function (d) { return 'Open Gym (Day ' + d + ')'; },
      shopBtn: 'Upgrades',
      feverActive: function (s) { return 'FEVER ' + s + 's'; },
      feverReady: 'Ring Bell!',
      feverPct: function (p) { return 'Fever ' + p + '%'; },
      tipStart: 'Tap or drag fruits onto machines, then tap bubbles to assist!',
      tipDirty: function (name) { return name + ' is sweaty—tap to mop it clean!'; },
      tipBusy: function (name) { return name + ' is occupied—wait a moment!'; },
      tipBusyAlt: function (name) { return name + ' is busy right now!'; },
      tipEmpty: function (name) { return name + ' is open—waiting for a fruit!'; },
      tipSeated: function (fruit, st) { return fruit + ' hops onto ' + st + '!'; },
      tipFlash: function (combo) { return 'Spotlight Flash! Combo x' + combo + ' Checkout +25%!'; },
      tipServed: function (byHelper, combo, tip) {
        return (byHelper ? 'Coach helped! ' : 'Served! ') + 'Combo x' + combo + ' +$' + tip;
      },
      tipCoinsDay5: function (total) { return '+$' + total + '! Tap puddles to mop for a $10 bonus!'; },
      tipCoins: function (total) { return 'Buff transformation +$' + total + '! Tap puddles to mop!'; },
      floatWake: 'Wake Up! ',
      floatSupply: 'Boost! ',
      floatMopDay5: function (byHelper) { return (byHelper ? 'Lemon Mop ' : 'Mop Bonus ') + '+$10'; },
      floatMop: function (byHelper) { return byHelper ? 'Lemon Clean!' : 'Sparkling!'; },
      floatLeft: 'Left waiting!',
      feverBanner: 'FEVER BELL RUNG! 2x WORKOUT SPEED!',
      chalkTitle: 'FRUIT ENERGY BAR',
      unlockBoxing: 'Tap to Unlock · Boxing $150',
      needSleep: 'Wake Up!',
      needWater: 'Water!',
      needShake: 'Shake!',
      needTowel: 'Towel!',
      dirtyDay5: 'Mop Sweat +$10!',
      dirtyNormal: 'Tap to Mop!',
      cleanerOn: 'Lemon Active',
      cleanerOff: 'Hire Lemon $220',
      coachOn: 'Coach Active',
      coachOff: 'Hire Coach $280',
      sumTitle: function (d, title) { return 'Day ' + d + ' Receipt · ' + title; },
      sumStarOlympic: 'Rating: Fruit Olympics Champion Gym!',
      sumStar3: 'Rating: 3-Star Superstar Fitness Club!',
      sumStar2: 'Rating: 2-Star Popular Gym! Keep pushing!',
      sumStar1: 'Rating: Cozy Starter Gym! Upgrade gear to earn more.',
      sumServedLbl: 'Fruits Served',
      sumServedVal: function (n) { return String(n); },
      sumComboLbl: 'Max Combo',
      sumTipsLbl: 'Tips & Bonuses',
      sumEarnedLbl: 'Today’s Revenue',
      btnSumShop: 'Upgrade Gym',
      btnNextDay: function (d) { return 'Start Day ' + d; },
      btnSumPoster: 'View 3:4 Daily Receipt Poster',
      shopTitle: 'Gym Upgrades & Staff',
      shopSub: function (c) { return 'Available Coins: $' + c; },
      shopMaxed: 'MAX',
      toastUpgraded: function (name) { return 'Upgraded: ' + name + '!'; },
      albumTitle: 'Star Fruit Album',
      albumSub: function (u, total) { return 'Unlocked ' + u + ' / ' + total + ' Buff Star Fruits'; },
      albumLocked: function (name) { return 'Locked · ' + name; },
      albumCount: function (c) { return 'Transformed ' + c + 'x'; },
      rankTitle: 'Manager Revenue Board',
      rankSub: 'Local Single-Day Revenue Records',
      rankTabTop: 'Top Days',
      rankTabRecent: 'Recent Days',
      rankBanner: function (best, day, served) {
        return 'Best Day: $' + best + ' · Day ' + day + ' · ' + served + ' Served';
      },
      rankRowTitle: function (day, title) { return 'Day ' + day + ' · ' + title; },
      rankRowDetail: function (served, combo, stars) {
        return served + ' served · Combo x' + combo + ' · ' + stars + '★';
      },
      rankEmpty: 'Finish Day 1 to record your first daily revenue entry on the board!',
      posterTitle: 'Daily Gym Receipt',
      posterSub: '3:4 retro receipt poster — download or save image',
      btnSavePoster: 'Download PNG Poster',
      posterHint: 'Or right-click / long-press the poster above to save',
      posterDownloaded: 'Downloading daily receipt PNG!',
      posterFallback: 'Right-click or long-press the poster above to save'
    }
  };

  function detectInitialLang() {
    try {
      var params = new URLSearchParams(global.location.search || '');
      var q = (params.get('lang') || '').toLowerCase();
      if (q.indexOf('en') === 0) return 'en';
      if (q.indexOf('zh') === 0) return 'zh';
    } catch (e) {}
    var nav = (global.navigator && global.navigator.language || '').toLowerCase();
    return nav.indexOf('zh') === 0 ? 'zh' : 'en';
  }

  /* Persistent Career State */
  var career = {
    lang: detectInitialLang(),
    day: 1,
    coins: 0,
    bestDayRev: 0,
    totalServed: 0,
    upgrades: {
      boxing: 0,
      gear: 0,
      bar: 0,
      cleaner: 0,
      coach: 0,
      vipSign: 0
    },
    album: {},
    dayHistory: []
  };

  /* Live Day Runtime */
  var running = false;
  var dayCfg = D.getDayConfig(1);
  var dayTimeLeft = 72;
  var dayEarned = 0;
  var dayTips = 0;
  var dayServed = 0;
  var combo = 0;
  var maxCombo = 0;
  var comboTimer = 0;
  var feverCharge = 0;
  var feverLeft = 0;
  var eventTriggered = false;
  var eventBanner = { text: '', left: 0 };
  var speedBoostLeft = 0;
  var tipBoostActive = false;
  var cameraFlash = 0;
  var shakeTime = 0;
  var shakeMag = 0;

  var spawnCooldown = 1.0;
  var doorSwing = 0;
  var queue = [null, null, null];
  var selectedQueueIdx = -1;
  var stations = [];

  var passersby = [];
  var walkers = [];
  var leavers = [];
  var flyingCoins = [];
  var particles = [];
  var floatTexts = [];
  var confetti = [];

  /* Playable Sprinting Manager (Red-Headband Watermelon Boss) */
  var boss = {
    x: 375,
    y: 790,
    homeX: 375,
    homeY: 790,
    carry: null,
    facing: 1,
    task: null,
    queue: []
  };

  var helperCleaner = { x: 126, y: 1170, homeX: 126, homeY: 1170, targetStation: -1 };
  var helperCoach = { x: 624, y: 1170, homeX: 624, homeY: 1170, targetStation: -1 };

  var drag = {
    active: false,
    qIdx: -1,
    startX: 0,
    startY: 0,
    x: 0,
    y: 0,
    moved: false
  };

  var lastDayReport = null;
  var rankSort = 'top';
  var canvas = null;
  var ctx = null;
  var rafId = 0;
  var lastTs = 0;
  var elapsed = 0;
  var tick = 0;
  var pageHidden = false;
  var openModalId = null;
  var dom = {};

  function $(id) { return document.getElementById(id); }
  function T() { return UI[career.lang] || UI.en; }
  function lang() { return career.lang; }
  function pick(v) { return D.pickText(v, career.lang); }

  function addShake(mag, dur) {
    if (mag >= shakeMag) {
      shakeMag = mag;
      shakeTime = Math.max(shakeTime, dur || 0.2);
    }
  }

  function showToast(msg) {
    if (!dom.toast) return;
    dom.toast.textContent = msg;
    dom.toast.classList.add('show');
    if (dom.toast._tid) clearTimeout(dom.toast._tid);
    dom.toast._tid = setTimeout(function () {
      dom.toast.classList.remove('show');
    }, 2000);
  }

  function formatMMSS(sec) {
    var s = Math.max(0, Math.ceil(sec));
    var m = Math.floor(s / 60);
    var r = s % 60;
    return (m < 10 ? '0' : '') + m + ':' + (r < 10 ? '0' : '') + r;
  }

  function countAlbum() {
    return Object.keys(career.album || {}).length;
  }

  function hasAffordableUpgrade() {
    for (var i = 0; i < D.UPGRADES.length; i++) {
      var u = D.UPGRADES[i];
      var lv = career.upgrades[u.id] || 0;
      if (lv < u.maxLv && career.coins >= u.costs[lv]) return true;
    }
    return false;
  }

  function persistCareer() {
    ST.saveState(career);
  }

  function popCoinPill() {
    if (!dom.coinPill) return;
    dom.coinPill.classList.add('pop');
    if (dom.coinPill._tid) clearTimeout(dom.coinPill._tid);
    dom.coinPill._tid = setTimeout(function () {
      dom.coinPill.classList.remove('pop');
    }, 130);
  }

  function updateHud() {
    var t = T();
    dom.dayBadge.textContent = t.dayBadge(career.day);
    dom.timerBadge.textContent = formatMMSS(dayTimeLeft);
    if (running && dayTimeLeft <= 12) dom.timerBadge.classList.add('urgent');
    else dom.timerBadge.classList.remove('urgent');

    dom.coinDisplay.textContent = String(career.coins);
    dom.albumCount.textContent = countAlbum() + '/' + D.FRUITS.length;

    if (hasAffordableUpgrade()) dom.shopDot.classList.remove('hidden');
    else dom.shopDot.classList.add('hidden');

    if (feverLeft > 0) {
      dom.btnFever.disabled = true;
      dom.btnFever.classList.add('ready');
      dom.feverLabel.textContent = t.feverActive(Math.ceil(feverLeft));
    } else if (feverCharge >= 100 && running) {
      dom.btnFever.disabled = false;
      dom.btnFever.classList.add('ready');
      dom.feverLabel.textContent = t.feverReady;
    } else {
      dom.btnFever.disabled = true;
      dom.btnFever.classList.remove('ready');
      dom.feverLabel.textContent = t.feverPct(Math.floor(feverCharge));
    }
  }

  function applyLanguage() {
    var t = T();
    document.documentElement.lang = lang() === 'zh' ? 'zh-CN' : 'en';
    document.title = t.pageTitle;
    dom.btnLang.textContent = t.langToggle;
    dom.shopBtnLabel.textContent = t.shopBtn;
    dom.sumServedLbl.textContent = t.sumServedLbl;
    dom.sumComboLbl.textContent = t.sumComboLbl;
    dom.sumTipsLbl.textContent = t.sumTipsLbl;
    dom.sumEarnedLbl.textContent = t.sumEarnedLbl;
    dom.btnSumShop.textContent = t.btnSumShop;
    dom.btnSumPoster.textContent = t.btnSumPoster;
    dom.shopTitle.textContent = t.shopTitle;
    dom.albumTitle.textContent = t.albumTitle;
    dom.rankTitle.textContent = t.rankTitle;
    dom.rankSub.textContent = t.rankSub;
    dom.rankTabTop.textContent = t.rankTabTop;
    dom.rankTabRecent.textContent = t.rankTabRecent;
    dom.posterTitle.textContent = t.posterTitle;
    dom.posterSub.textContent = t.posterSub;
    dom.btnSavePoster.textContent = t.btnSavePoster;
    dom.posterHint.textContent = t.posterHint;

    if (!running) {
      refreshStartCard();
    } else {
      updateHud();
    }
    dom.statusTip.textContent = t.tipStart;
    if (openModalId === 'modalShop') renderShopModal();
    if (openModalId === 'modalAlbum') renderAlbumModal();
    if (openModalId === 'modalRank') renderRankModal(rankSort);
    if (openModalId === 'modalSummary' && lastDayReport) renderSummaryModal();
    if (openModalId === 'modalPoster') openPosterModal();
  }

  function setLang(nextLang) {
    career.lang = nextLang === 'en' ? 'en' : 'zh';
    persistCareer();
    applyLanguage();
  }

  /* ---------- Dynamic Full-Screen Canvas Sizing & Safe-Zone Layout ---------- */
  function resizeCanvas() {
    if (!canvas) return;
    var root = dom.gameRoot;
    cssW = (root && root.clientWidth) || global.innerWidth || 390;
    cssH = (root && root.clientHeight) || global.innerHeight || 780;

    var dpr = Math.min(2, global.devicePixelRatio || 1);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);

    if (cssW / cssH > 0.68) {
      viewScale = cssH / 1380;
      H = 1380;
      offsetX = (cssW - W * viewScale) / 2;
    } else {
      viewScale = cssW / W;
      H = Math.round(cssH / viewScale);
      offsetX = 0;
    }

    var hudRect = dom.floatHud ? dom.floatHud.getBoundingClientRect() : { bottom: 58 };
    var dockRect = dom.floatDock ? dom.floatDock.getBoundingClientRect() : { top: cssH - 84 };

    L.hudBottom = Math.max(82, Math.round(hudRect.bottom / viewScale));
    L.dockTop = Math.min(H - 126, Math.round(dockRect.top / viewScale));

    L.goalBarY = L.hudBottom + 14;
    L.sidewalkY = L.goalBarY + 62;
    L.awningTop = L.sidewalkY + 20;
    L.wallTop = L.awningTop + 50;
    L.floorTop = L.wallTop + 128;
    L.queueY = L.floorTop + 62;

    var arenaH = Math.max(500, L.dockTop - (L.floorTop + 126));
    L.row1Y = L.floorTop + 114 + Math.round(arenaH * 0.21);
    L.row2Y = L.floorTop + 114 + Math.round(arenaH * 0.61);
    L.staffY = L.dockTop - 80;

    boss.homeX = W / 2;
    boss.homeY = Math.round((L.row1Y + L.row2Y) / 2);
    if (!boss.task) { boss.x = boss.homeX; boss.y = boss.homeY; }

    helperCleaner.homeX = 126;
    helperCleaner.homeY = L.staffY;
    if (helperCleaner.targetStation === -1) { helperCleaner.x = helperCleaner.homeX; helperCleaner.y = helperCleaner.homeY; }

    helperCoach.homeX = 624;
    helperCoach.homeY = L.staffY;
    if (helperCoach.targetStation === -1) { helperCoach.x = helperCoach.homeX; helperCoach.y = helperCoach.homeY; }

    syncStationPositions();
  }

  function syncStationPositions() {
    var posMap = {
      treadmill: { x: 192, y: L.row1Y },
      dumbbell:  { x: 558, y: L.row1Y },
      yoga:      { x: 192, y: L.row2Y },
      boxing:    { x: 558, y: L.row2Y }
    };
    for (var i = 0; i < stations.length; i++) {
      var p = posMap[stations[i].id];
      if (p) {
        stations[i].x = p.x;
        stations[i].y = p.y;
      }
    }
  }

  /* ---------- Particles, Floating Text & Flying Coins ---------- */
  function spawnBurst(x, y, color, count) {
    for (var i = 0; i < count; i++) {
      var a = Math.random() * Math.PI * 2;
      var spd = 70 + Math.random() * 190;
      particles.push({
        x: x,
        y: y,
        vx: Math.cos(a) * spd,
        vy: Math.sin(a) * spd - 65,
        r: 4 + Math.random() * 5,
        life: 0.42 + Math.random() * 0.35,
        maxLife: 0.77,
        color: i % 2 === 0 ? color : '#FFFDF7'
      });
    }
  }

  function spawnDust(x, y) {
    particles.push({
      x: x + (Math.random() - 0.5) * 14,
      y: y + 22,
      vx: (Math.random() - 0.5) * 30,
      vy: -18 - Math.random() * 20,
      r: 5 + Math.random() * 4,
      life: 0.28,
      maxLife: 0.28,
      color: 'rgba(255, 250, 236, 0.85)'
    });
  }

  function spawnConfetti(count) {
    var cols = ['#FFD63B', '#E85A4F', '#6BBF4E', '#56D8FF', '#FF9BB2'];
    for (var i = 0; i < count; i++) {
      confetti.push({
        x: 40 + Math.random() * (W - 80),
        y: L.wallTop - 20 - Math.random() * 160,
        vx: (Math.random() - 0.5) * 80,
        vy: 130 + Math.random() * 120,
        rot: Math.random() * Math.PI,
        vrot: (Math.random() - 0.5) * 8,
        w: 10 + Math.random() * 6,
        h: 6 + Math.random() * 4,
        color: cols[i % cols.length],
        life: 2.2 + Math.random() * 1.4
      });
    }
  }

  function addFloatText(x, y, text, color) {
    floatTexts.push({
      x: x,
      y: y,
      vy: -68,
      life: 1.05,
      maxLife: 1.05,
      text: text,
      color: color || '#3B2A1A'
    });
  }

  function spawnFlyingCoins(x, y, count) {
    var targetX = 480;
    var targetY = Math.max(40, L.hudBottom - 26);
    for (var i = 0; i < count; i++) {
      flyingCoins.push({
        sx: x + (Math.random() - 0.5) * 44,
        sy: y - 16 + (Math.random() - 0.5) * 26,
        cx: x + (Math.random() - 0.5) * 180,
        cy: y - 150 - Math.random() * 90,
        tx: targetX,
        ty: targetY,
        t: -i * 0.07,
        dur: 0.52 + i * 0.04
      });
    }
  }

  function seedPassersby() {
    passersby = [];
    var ids = ['watermelon', 'lemon', 'strawberry', 'avocado', 'banana', 'pineapple'];
    for (var i = 0; i < 3; i++) {
      var dir = i % 2 === 0 ? 1 : -1;
      passersby.push({
        id: ids[Math.floor(Math.random() * ids.length)],
        x: 80 + i * 260,
        dir: dir,
        speed: 44 + Math.random() * 34
      });
    }
  }

  /* ---------- Stations & Day Lifecycle ---------- */
  function initStations() {
    stations = [];
    for (var i = 0; i < D.STATIONS.length; i++) {
      var def = D.STATIONS[i];
      stations.push({
        id: def.id,
        def: def,
        x: def.x,
        y: def.y,
        unlocked: def.unlockedDefault || (def.id === 'boxing' && (career.upgrades.boxing || 0) > 0),
        state: 'empty',
        fruit: null,
        progress: 0,
        workDuration: 6.5,
        needType: null,
        needTriggered: false,
        needTimer: 0,
        needMax: 9.5,
        payAmount: 0,
        tipEarned: 0,
        highlightTimer: 0
      });
    }
    syncStationPositions();
  }

  function refreshStartCard() {
    var t = T();
    dayCfg = D.getDayConfig(career.day);
    dayTimeLeft = dayCfg.duration;
    dom.startKicker.textContent = t.startKicker(dayCfg.day, dayCfg.stars[2]);
    dom.startTitle.textContent = pick(dayCfg.title);
    dom.startDesc.textContent = pick(dayCfg.tagline);
    var tips = (dayCfg.tips && (dayCfg.tips[lang()] || dayCfg.tips.zh)) || [];
    if (dom.startTips && tips.length) {
      dom.startTips.innerHTML = '';
      for (var i = 0; i < tips.length; i++) {
        var sp = document.createElement('span');
        sp.textContent = tips[i];
        dom.startTips.appendChild(sp);
      }
    }
    dom.btnStartDay.textContent = t.startBtn(dayCfg.day);
    dom.startOverlay.classList.remove('hidden');
    initStations();
    updateHud();
  }

  function startDay() {
    dayCfg = D.getDayConfig(career.day);
    running = true;
    dayTimeLeft = dayCfg.duration;
    dayEarned = 0;
    dayTips = 0;
    dayServed = 0;
    combo = 0;
    maxCombo = 0;
    comboTimer = 0;
    feverCharge = 0;
    feverLeft = 0;
    eventTriggered = false;
    eventBanner = { text: '', left: 0 };
    speedBoostLeft = 0;
    tipBoostActive = false;
    cameraFlash = 0;
    spawnCooldown = 0.7;
    doorSwing = 0;
    queue = [null, null, null];
    selectedQueueIdx = -1;
    walkers = [];
    leavers = [];
    flyingCoins = [];
    particles = [];
    floatTexts = [];
    confetti = [];
    boss.task = null;
    boss.queue = [];
    boss.carry = null;
    boss.x = boss.homeX;
    boss.y = boss.homeY;
    helperCleaner.targetStation = -1;
    helperCleaner.x = helperCleaner.homeX;
    helperCleaner.y = helperCleaner.homeY;
    helperCoach.targetStation = -1;
    helperCoach.x = helperCoach.homeX;
    helperCoach.y = helperCoach.homeY;

    initStations();
    dom.startOverlay.classList.add('hidden');
    dom.statusTip.textContent = T().tipStart;
    S.playDoorBell();
    spawnFruitToQueue(false);
    if (dayCfg.day === 7) spawnConfetti(26);
    updateHud();
  }

  function unlockedStationIds() {
    var ids = [];
    for (var i = 0; i < stations.length; i++) {
      if (stations[i].unlocked) ids.push(stations[i].id);
    }
    return ids;
  }

  function spawnFruitToQueue(forceVip) {
    var slotIdx = -1;
    for (var i = 0; i < queue.length; i++) {
      if (!queue[i]) { slotIdx = i; break; }
    }
    if (slotIdx === -1) return false;

    var pool = dayCfg.pool.slice();
    if ((career.upgrades.vipSign || 0) > 0 && career.day >= 2) {
      pool.push('pineapple');
      if (career.upgrades.vipSign >= 2) pool.push('pineapple');
    }

    var fid = forceVip ? 'pineapple' : pool[Math.floor(Math.random() * pool.length)];
    var spec = D.FRUIT_MAP[fid] || D.FRUITS[0];
    var avail = unlockedStationIds();
    var validFavs = [];
    for (var k = 0; k < spec.favStations.length; k++) {
      if (avail.indexOf(spec.favStations[k]) !== -1) validFavs.push(spec.favStations[k]);
    }
    var wantStation = validFavs.length
      ? validFavs[Math.floor(Math.random() * validFavs.length)]
      : avail[Math.floor(Math.random() * avail.length)];

    doorSwing = 1.0;
    queue[slotIdx] = {
      spec: spec,
      wantStation: wantStation,
      patience: spec.patience,
      maxPatience: spec.patience,
      x: L.doorX,
      y: L.floorTop - 16,
      tx: QUEUE_XS[slotIdx],
      ty: L.queueY,
      arrived: false
    };
    if (spec.isVip) {
      spawnBurst(L.doorX, L.floorTop + 8, '#FFD63B', 16);
      addShake(4, 0.16);
    }
    S.playDoorBell();
    return true;
  }

  function seatFruitFromQueue(qIdx, stationIdx) {
    var guest = queue[qIdx];
    var st = stations[stationIdx];
    var t = T();
    if (!guest || !st || !st.unlocked) return false;
    if (st.state !== 'empty') {
      st.highlightTimer = 0.7;
      S.playBuzz();
      var stName = pick(st.def.name);
      dom.statusTip.textContent = st.state === 'dirty' ? t.tipDirty(stName) : t.tipBusy(stName);
      return false;
    }

    var gearLv = career.upgrades.gear || 0;
    var speedMult = 1 + gearLv * 0.22;
    var payMult = 1 + gearLv * 0.25;

    st.state = 'incoming';
    st.fruit = guest.spec;
    st.progress = 0;
    st.workDuration = Math.max(3.4, guest.spec.workTime / speedMult);
    st.needTriggered = false;
    st.needType = null;
    st.needTimer = 0;
    st.payAmount = Math.round(guest.spec.basePay * payMult);
    st.tipEarned = 0;

    walkers.push({
      spec: guest.spec,
      stationIdx: stationIdx,
      sx: guest.x,
      sy: guest.y,
      x: guest.x,
      y: guest.y,
      tx: st.x,
      ty: st.y,
      t: 0,
      dur: 0.36
    });

    queue[qIdx] = null;
    selectedQueueIdx = -1;
    S.playSeat();
    spawnBurst(guest.x, guest.y, st.def.color, 8);
    dom.statusTip.textContent = t.tipSeated(pick(guest.spec.name), pick(st.def.name));
    return true;
  }

  function queueBossTask(stationIdx, kind) {
    var st = stations[stationIdx];
    if (!st) return;
    if (boss.task && boss.task.stationIdx === stationIdx && boss.task.kind === kind) return;
    for (var i = 0; i < boss.queue.length; i++) {
      if (boss.queue[i].stationIdx === stationIdx && boss.queue[i].kind === kind) return;
    }
    var carry = kind === 'clean' ? 'mop' : (st.needType === 'sleep' ? null : st.needType);
    boss.queue.push({ stationIdx: stationIdx, kind: kind, carry: carry });
    if (!boss.task) startNextBossTask();
  }

  function startNextBossTask() {
    boss.task = null;
    boss.carry = null;
    while (boss.queue.length > 0) {
      var next = boss.queue.shift();
      var st = stations[next.stationIdx];
      if (!st) continue;
      if (next.kind === 'serve' && st.state !== 'need') continue;
      if (next.kind === 'clean' && st.state !== 'dirty') continue;
      boss.task = next;
      boss.carry = next.carry;
      return;
    }
  }

  function serveStationNeed(st, byHelper) {
    if (st.state !== 'need') return;
    var t = T();
    var barLv = career.upgrades.bar || 0;
    var isSleep = st.needType === 'sleep';
    combo += 1;
    if (combo > maxCombo) maxCombo = combo;
    comboTimer = 8.5;

    var tip = 10 + barLv * 8 + Math.min(22, combo * 3);
    if (tipBoostActive || career.day === 5) tip = Math.round(tip * 1.35);
    if (st.fruit && st.fruit.isVip) tip = Math.round(tip * 1.8);
    st.tipEarned += tip;

    st.state = 'working';
    st.needType = null;
    st.progress = Math.min(0.92, st.progress + 0.25);

    if (feverLeft <= 0) {
      feverCharge = Math.min(100, feverCharge + 22 + barLv * 7);
    }

    if (isSleep) {
      S.playBonk();
      addShake(5, 0.16);
    } else {
      S.playServe(combo);
    }

    spawnBurst(st.x, st.y - 26, '#FFD63B', 16);
    var label = (isSleep ? t.floatWake : t.floatSupply) + '+' + t.cur + tip + (combo >= 2 ? (' x' + combo) : '');
    addFloatText(st.x, st.y - 68, label, '#C43D33');

    if (career.day === 6 && combo >= 3) {
      cameraFlash = 0.45;
      spawnBurst(st.x, st.y - 44, '#FFFDF7', 18);
      dom.statusTip.textContent = t.tipFlash(combo);
    } else {
      dom.statusTip.textContent = t.tipServed(byHelper, combo, tip);
    }
    updateHud();
  }

  function collectStationCoins(st) {
    if (st.state !== 'done') return;
    var t = T();
    var total = st.payAmount + st.tipEarned;
    if (tipBoostActive) total = Math.round(total * 1.2);
    if (career.day === 6 && combo >= 3) total = Math.round(total * 1.25);

    career.coins += total;
    dayEarned += total;
    dayTips += st.tipEarned;
    dayServed += 1;
    career.totalServed += 1;

    var finishedFruit = st.fruit;
    if (finishedFruit) {
      var fid = finishedFruit.id;
      career.album[fid] = (career.album[fid] || 0) + 1;
      leavers.push({
        spec: finishedFruit,
        sx: st.x,
        sy: st.y,
        x: st.x,
        y: st.y,
        tx: L.doorX,
        ty: L.floorTop - 16,
        t: 0,
        dur: 0.72
      });
    }

    if (feverLeft <= 0) {
      feverCharge = Math.min(100, feverCharge + 15);
    }

    S.playCoin();
    addShake(3.5, 0.12);
    spawnBurst(st.x, st.y - 16, '#FFD63B', 20);
    spawnFlyingCoins(st.x, st.y, finishedFruit && finishedFruit.isVip ? 7 : 4);
    addFloatText(st.x, st.y - 62, '+' + t.cur + total, '#2E8B57');

    st.state = 'dirty';
    st.fruit = null;
    st.progress = 0;
    st.payAmount = 0;
    st.tipEarned = 0;

    dom.statusTip.textContent = career.day === 5 ? t.tipCoinsDay5(total) : t.tipCoins(total);
    persistCareer();
    updateHud();
  }

  function cleanStationMat(st, byHelper) {
    if (st.state !== 'dirty') return;
    var t = T();
    st.state = 'empty';
    S.playClean();
    spawnBurst(st.x, st.y + 8, '#6CE2FF', 16);
    if (career.day === 5) {
      career.coins += 10;
      dayEarned += 10;
      dayTips += 10;
      spawnFlyingCoins(st.x, st.y, 2);
      persistCareer();
      updateHud();
      addFloatText(st.x, st.y - 34, t.floatMopDay5(byHelper), '#2E8B57');
    } else {
      addFloatText(st.x, st.y - 34, t.floatMop(byHelper), '#2E8B57');
    }
  }

  function triggerFever() {
    if (!running || feverCharge < 100 || feverLeft > 0) return;
    feverCharge = 0;
    feverLeft = 8.5;
    S.playFever();
    ST.vibrateMilestone();
    addShake(7, 0.28);
    spawnConfetti(32);
    eventBanner = { text: T().feverBanner, left: 2.8 };
    for (var i = 0; i < queue.length; i++) {
      if (queue[i]) queue[i].patience = Math.min(queue[i].maxPatience, queue[i].patience + 6);
    }
    updateHud();
  }

  function renderSummaryModal() {
    if (!lastDayReport) return;
    var t = T();
    var r = lastDayReport;
    var titleText = D.pickText(r.dayTitleObj, lang());
    dom.sumTitle.textContent = t.sumTitle(r.day, titleText);
    dom.sumStars.textContent = (r.day >= 7 && r.stars >= 3)
      ? t.sumStarOlympic
      : (r.stars >= 3 ? t.sumStar3 : (r.stars === 2 ? t.sumStar2 : t.sumStar1));
    dom.sumServed.textContent = t.sumServedVal(r.served);
    dom.sumCombo.textContent = 'x' + r.maxCombo;
    dom.sumTips.textContent = '+' + t.cur + r.tips;
    dom.sumEarned.textContent = '+' + t.cur + r.earned;
    dom.btnNextDay.textContent = t.btnNextDay(r.day + 1);
  }

  function finishDay() {
    running = false;
    drag.active = false;
    S.playDayEnd();
    ST.vibrateMilestone();

    var stars = 1;
    if (dayEarned >= dayCfg.stars[2]) stars = 3;
    else if (dayEarned >= dayCfg.stars[1]) stars = 2;

    if (dayEarned > career.bestDayRev) {
      career.bestDayRev = dayEarned;
    }

    lastDayReport = {
      day: career.day,
      dayTitleObj: dayCfg.title,
      earned: dayEarned,
      tips: dayTips,
      served: dayServed,
      maxCombo: maxCombo,
      stars: stars,
      bestDayRev: career.bestDayRev,
      unlocked: countAlbum()
    };

    if (!Array.isArray(career.dayHistory)) career.dayHistory = [];
    career.dayHistory.push({
      day: career.day,
      title: dayCfg.title,
      earned: dayEarned,
      served: dayServed,
      maxCombo: maxCombo,
      stars: stars,
      ts: Date.now()
    });
    if (career.dayHistory.length > 30) {
      career.dayHistory = career.dayHistory.slice(-30);
    }

    renderSummaryModal();

    career.day += 1;
    persistCareer();
    updateHud();
    openModal('modalSummary');
  }

  /* ---------- Simulation Step ---------- */
  function step(dt) {
    elapsed += dt;
    tick += 1;

    for (var pb = 0; pb < passersby.length; pb++) {
      var pObj = passersby[pb];
      pObj.x += pObj.dir * pObj.speed * dt;
      if (pObj.dir > 0 && pObj.x > W + 70) pObj.x = -70;
      if (pObj.dir < 0 && pObj.x < -70) pObj.x = W + 70;
    }

    if (doorSwing > 0) doorSwing = Math.max(0, doorSwing - dt * 2.4);
    if (shakeTime > 0) {
      shakeTime = Math.max(0, shakeTime - dt);
      if (shakeTime <= 0) shakeMag = 0;
    }
    if (cameraFlash > 0) cameraFlash = Math.max(0, cameraFlash - dt * 1.8);

    for (var p = particles.length - 1; p >= 0; p--) {
      var pt = particles[p];
      pt.life -= dt;
      if (pt.life <= 0) particles.splice(p, 1);
      else {
        pt.vy += 320 * dt;
        pt.x += pt.vx * dt;
        pt.y += pt.vy * dt;
      }
    }
    for (var cf = confetti.length - 1; cf >= 0; cf--) {
      var cObj = confetti[cf];
      cObj.life -= dt;
      if (cObj.life <= 0) confetti.splice(cf, 1);
      else {
        cObj.x += cObj.vx * dt + Math.sin(elapsed * 5 + cf) * 24 * dt;
        cObj.y += cObj.vy * dt;
        cObj.rot += cObj.vrot * dt;
      }
    }
    for (var f = floatTexts.length - 1; f >= 0; f--) {
      var ft = floatTexts[f];
      ft.life -= dt;
      if (ft.life <= 0) floatTexts.splice(f, 1);
      else ft.y += ft.vy * dt;
    }
    for (var fc = flyingCoins.length - 1; fc >= 0; fc--) {
      var coin = flyingCoins[fc];
      coin.t += dt / coin.dur;
      if (coin.t >= 1) {
        flyingCoins.splice(fc, 1);
        popCoinPill();
      }
    }

    if (!running || openModalId) return;

    dayTimeLeft -= dt;
    if (dayTimeLeft <= 0) {
      dayTimeLeft = 0;
      updateHud();
      finishDay();
      return;
    }

    if (comboTimer > 0) {
      comboTimer -= dt;
      if (comboTimer <= 0) combo = 0;
    }
    if (feverLeft > 0) feverLeft = Math.max(0, feverLeft - dt);
    if (speedBoostLeft > 0) speedBoostLeft = Math.max(0, speedBoostLeft - dt);
    if (eventBanner.left > 0) eventBanner.left = Math.max(0, eventBanner.left - dt);

    if (!eventTriggered && dayTimeLeft <= dayCfg.eventAt) {
      eventTriggered = true;
      eventBanner = { text: pick(dayCfg.eventName), left: 3.4 };
      S.playFever();
      addShake(5, 0.22);
      if (dayCfg.eventKind === 'rush') {
        spawnFruitToQueue(false);
        spawnFruitToQueue(false);
      } else if (dayCfg.eventKind === 'vipVisit') {
        spawnFruitToQueue(true);
        spawnConfetti(22);
      } else if (dayCfg.eventKind === 'olympicVip') {
        spawnFruitToQueue(true);
        spawnFruitToQueue(true);
        spawnConfetti(36);
      } else if (dayCfg.eventKind === 'speedBoost') {
        speedBoostLeft = 20;
      } else if (dayCfg.eventKind === 'tipBoost') {
        tipBoostActive = true;
        spawnConfetti(20);
      }
    }

    spawnCooldown -= dt;
    if (spawnCooldown <= 0) {
      spawnFruitToQueue(false);
      spawnCooldown = dayCfg.spawnInterval * (0.85 + Math.random() * 0.3);
    }

    for (var q = 0; q < queue.length; q++) {
      var g = queue[q];
      if (!g) continue;
      if (!g.arrived) {
        var qdx = g.tx - g.x;
        var qdy = g.ty - g.y;
        var qd = Math.sqrt(qdx * qdx + qdy * qdy);
        if (qd > 6) {
          var qStep = Math.min(qd, 420 * dt);
          g.x += (qdx / qd) * qStep;
          g.y += (qdy / qd) * qStep;
        } else {
          g.x = g.tx;
          g.y = g.ty;
          g.arrived = true;
        }
      }
      if (feverLeft <= 0) g.patience -= dt;
      if (g.patience <= 0) {
        addFloatText(g.x, g.y - 42, T().floatLeft, '#786653');
        queue[q] = null;
        if (selectedQueueIdx === q) selectedQueueIdx = -1;
        if (drag.active && drag.qIdx === q) drag.active = false;
        combo = 0;
        S.playBuzz();
      }
    }

    for (var wk = walkers.length - 1; wk >= 0; wk--) {
      var wObj = walkers[wk];
      wObj.t += dt / wObj.dur;
      if (Math.random() < 0.35) spawnDust(wObj.x, wObj.y);
      if (wObj.t >= 1) {
        var targetSt = stations[wObj.stationIdx];
        if (targetSt && targetSt.state === 'incoming') {
          targetSt.state = 'working';
          spawnBurst(targetSt.x, targetSt.y, targetSt.def.color, 10);
        }
        walkers.splice(wk, 1);
      } else {
        var et = 1 - Math.pow(1 - wObj.t, 2);
        wObj.x = wObj.sx + (wObj.tx - wObj.sx) * et;
        wObj.y = wObj.sy + (wObj.ty - wObj.sy) * et;
      }
    }

    for (var lv = leavers.length - 1; lv >= 0; lv--) {
      var lObj = leavers[lv];
      lObj.t += dt / lObj.dur;
      if (lObj.t >= 1) {
        doorSwing = Math.max(doorSwing, 0.75);
        leavers.splice(lv, 1);
      } else {
        lObj.x = lObj.sx + (lObj.tx - lObj.sx) * lObj.t;
        lObj.y = lObj.sy + (lObj.ty - lObj.sy) * lObj.t;
      }
    }

    updateBoss(dt);

    var globalSpeed = (feverLeft > 0 ? 2.0 : 1.0) * (speedBoostLeft > 0 ? 1.3 : 1.0);
    for (var i = 0; i < stations.length; i++) {
      var st = stations[i];
      if (st.highlightTimer > 0) st.highlightTimer = Math.max(0, st.highlightTimer - dt);

      if (st.state === 'working') {
        st.progress += (dt / st.workDuration) * globalSpeed;
        if (!st.needTriggered && st.progress >= 0.42) {
          st.needTriggered = true;
          var np = st.fruit.needPool || ['water', 'towel'];
          st.needType = np[Math.floor(Math.random() * np.length)];
          st.state = 'need';
          st.needTimer = st.needMax;
        }
        if (st.progress >= 1) {
          st.progress = 1;
          st.state = 'done';
          spawnBurst(st.x, st.y, '#FFD63B', 16);
          S.playServe(2);
        }
      } else if (st.state === 'need') {
        st.needTimer -= dt;
        if (st.needType !== 'sleep') {
          st.progress += (dt / st.workDuration) * 0.35 * globalSpeed;
        }
        if (st.needTimer <= 0) {
          st.state = 'working';
          st.needType = null;
          combo = 0;
        } else if (st.progress >= 1) {
          st.progress = 1;
          st.state = 'done';
          st.needType = null;
        }
      }
    }

    if ((career.upgrades.cleaner || 0) > 0) updateCleanerHelper(dt);
    if ((career.upgrades.coach || 0) > 0) updateCoachHelper(dt);

    updateHud();
  }

  function updateBoss(dt) {
    var tx = boss.homeX;
    var ty = boss.homeY;
    var activeTask = boss.task;
    if (activeTask) {
      var st = stations[activeTask.stationIdx];
      if (!st || (activeTask.kind === 'serve' && st.state !== 'need') || (activeTask.kind === 'clean' && st.state !== 'dirty')) {
        startNextBossTask();
        activeTask = boss.task;
      }
      if (activeTask) {
        st = stations[activeTask.stationIdx];
        tx = st.x + (st.x < W / 2 ? 78 : -78);
        ty = st.y + 24;
      }
    }

    var dx = tx - boss.x;
    var dy = ty - boss.y;
    var dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 10) {
      if (Math.abs(dx) > 4) boss.facing = dx > 0 ? 1 : -1;
      var spd = activeTask ? 1120 : 540;
      var stepLen = Math.min(dist, spd * dt);
      boss.x += (dx / dist) * stepLen;
      boss.y += (dy / dist) * stepLen;
      if (activeTask && Math.random() < 0.45) spawnDust(boss.x, boss.y);
    } else if (activeTask) {
      var doneSt = stations[activeTask.stationIdx];
      if (activeTask.kind === 'serve') serveStationNeed(doneSt, false);
      else if (activeTask.kind === 'clean') cleanStationMat(doneSt, false);
      startNextBossTask();
    }
  }

  function updateCleanerHelper(dt) {
    if (helperCleaner.targetStation === -1) {
      for (var i = 0; i < stations.length; i++) {
        if (stations[i].state === 'dirty') { helperCleaner.targetStation = i; break; }
      }
    }
    var tx = helperCleaner.homeX;
    var ty = helperCleaner.homeY;
    if (helperCleaner.targetStation !== -1) {
      var st = stations[helperCleaner.targetStation];
      if (!st || st.state !== 'dirty') helperCleaner.targetStation = -1;
      else { tx = st.x; ty = st.y + 42; }
    }
    var dx = tx - helperCleaner.x;
    var dy = ty - helperCleaner.y;
    var dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 8) {
      var stepLen = Math.min(dist, 420 * dt);
      helperCleaner.x += (dx / dist) * stepLen;
      helperCleaner.y += (dy / dist) * stepLen;
      if (helperCleaner.targetStation !== -1 && Math.random() < 0.3) spawnDust(helperCleaner.x, helperCleaner.y);
    } else if (helperCleaner.targetStation !== -1) {
      cleanStationMat(stations[helperCleaner.targetStation], true);
      helperCleaner.targetStation = -1;
    }
  }

  function updateCoachHelper(dt) {
    if (helperCoach.targetStation === -1) {
      for (var i = 0; i < stations.length; i++) {
        if (stations[i].state === 'need') { helperCoach.targetStation = i; break; }
      }
    }
    var tx = helperCoach.homeX;
    var ty = helperCoach.homeY;
    if (helperCoach.targetStation !== -1) {
      var st = stations[helperCoach.targetStation];
      if (!st || st.state !== 'need') helperCoach.targetStation = -1;
      else { tx = st.x; ty = st.y + 42; }
    }
    var dx = tx - helperCoach.x;
    var dy = ty - helperCoach.y;
    var dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 8) {
      var stepLen = Math.min(dist, 390 * dt);
      helperCoach.x += (dx / dist) * stepLen;
      helperCoach.y += (dy / dist) * stepLen;
      if (helperCoach.targetStation !== -1 && Math.random() < 0.3) spawnDust(helperCoach.x, helperCoach.y);
    } else if (helperCoach.targetStation !== -1) {
      serveStationNeed(stations[helperCoach.targetStation], true);
      helperCoach.targetStation = -1;
    }
  }

  /* ==========================================================================
     2.5D LIVING GYM WORLD CANVAS RENDER PIPELINE
     ========================================================================== */
  function isNightAtmosphere() {
    return dayCfg.day === 3 || speedBoostLeft > 0;
  }

  function drawSkyAndStorefront() {
    var night = isNightAtmosphere();
    var t = T();
    var skyGrad = ctx.createLinearGradient(0, 0, 0, L.sidewalkY);
    if (night) {
      skyGrad.addColorStop(0, '#2C2A54');
      skyGrad.addColorStop(1, '#58447A');
    } else if (dayCfg.day === 4 || dayCfg.day === 7) {
      skyGrad.addColorStop(0, '#9DD9F8');
      skyGrad.addColorStop(1, '#FFF1C9');
    } else {
      skyGrad.addColorStop(0, '#AEE3FA');
      skyGrad.addColorStop(1, '#E8F7FE');
    }
    ctx.fillStyle = skyGrad;
    ctx.fillRect(-offsetX / viewScale - 40, 0, W + (offsetX / viewScale) * 2 + 80, L.sidewalkY + 30);

    if (night) {
      ctx.fillStyle = '#FFF7D6';
      for (var st = 0; st < 10; st++) {
        var sx = (st * 83 + 28) % W;
        var sy = 22 + (st * 29) % Math.max(40, L.sidewalkY - 56);
        var tw = 2 + Math.sin(elapsed * 4 + st) * 1.2;
        ctx.beginPath(); ctx.arc(sx, sy, Math.max(1, tw), 0, Math.PI * 2); ctx.fill();
      }
      if (L.hudBottom >= 175) {
        var moonY = Math.round((L.hudBottom - 68) * 0.5);
        ctx.fillStyle = '#FFE47A';
        ctx.beginPath(); ctx.arc(74, moonY, 22, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#38305E';
        ctx.beginPath(); ctx.arc(83, moonY - 5, 19, 0, Math.PI * 2); ctx.fill();
      }
    } else {
      if (L.hudBottom >= 175) {
        var sunY = Math.round((L.hudBottom - 68) * 0.5);
        ctx.fillStyle = 'rgba(255, 224, 102, 0.35)';
        ctx.beginPath(); ctx.arc(74, sunY, 34, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#FFD63B';
        ctx.beginPath(); ctx.arc(74, sunY, 22, 0, Math.PI * 2); ctx.fill();
      }

      ctx.fillStyle = 'rgba(255, 253, 247, 0.85)';
      for (var cl = 0; cl < 3; cl++) {
        var cx = ((elapsed * (12 + cl * 4) + cl * 270) % (W + 180)) - 90;
        var cy = Math.max(36, L.hudBottom - 44) + (cl % 2) * 18;
        ctx.beginPath();
        ctx.arc(cx, cy, 22, 0, Math.PI * 2);
        ctx.arc(cx + 22, cy - 6, 26, 0, Math.PI * 2);
        ctx.arc(cx + 46, cy, 20, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    /* Floating Daily Star Progress Bar */
    var gbY = L.goalBarY || (L.hudBottom + 14);
    var gbX = 28, gbW = W - 56, gbH = 26;
    ctx.fillStyle = 'rgba(255, 253, 247, 0.94)';
    ctx.strokeStyle = '#3B2A1A';
    ctx.lineWidth = 2.8;
    D.roundRect(ctx, gbX, gbY, gbW, gbH, 13);
    ctx.fill(); ctx.stroke();

    ctx.fillStyle = night ? '#58447A' : '#3B2A1A';
    D.roundRect(ctx, gbX + 3, gbY + 3, 186, gbH - 6, 10);
    ctx.fill();
    ctx.fillStyle = '#FFF7D6';
    ctx.font = lang() === 'en' ? '900 13px -apple-system, BlinkMacSystemFont, sans-serif' : '900 14px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(pick(dayCfg.title), gbX + 96, gbY + gbH / 2 + 1);

    var trX = gbX + 200, trW = gbW - 214, trY = gbY + 4, trH = gbH - 8;
    ctx.fillStyle = '#EAE1CE';
    D.roundRect(ctx, trX, trY, trW, trH, 9);
    ctx.fill();
    var maxGoal = dayCfg.stars[2];
    var gfw = Math.min(trW, Math.max(0, (dayEarned / maxGoal) * trW));
    if (gfw > 2) {
      ctx.fillStyle = '#FFD63B';
      D.roundRect(ctx, trX, trY, gfw, trH, 9);
      ctx.fill();
    }
    for (var s = 0; s < 3; s++) {
      var msx = trX + (dayCfg.stars[s] / maxGoal) * trW;
      var mhit = dayEarned >= dayCfg.stars[s];
      ctx.fillStyle = mhit ? '#E85A4F' : '#FFFDF7';
      ctx.strokeStyle = '#3B2A1A';
      ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.arc(msx, gbY + gbH / 2, 11, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = mhit ? '#FFFDF7' : '#786653';
      ctx.font = '900 11px Menlo, monospace';
      ctx.fillText(String(s + 1), msx, gbY + gbH / 2 + 1);
    }
    ctx.fillStyle = '#3B2A1A';
    ctx.font = '900 13px Menlo, monospace';
    ctx.textAlign = 'left';
    ctx.fillText(t.cur + dayEarned + ' / ' + t.cur + maxGoal, trX + 10, gbY + gbH / 2 + 1);

    /* Sidewalk & Strolling Passersby */
    ctx.fillStyle = night ? '#B3A498' : '#E7DEC8';
    ctx.fillRect(-offsetX / viewScale - 40, L.sidewalkY - 6, W + (offsetX / viewScale) * 2 + 80, 46);
    ctx.strokeStyle = '#3B2A1A';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(-100, L.sidewalkY - 6); ctx.lineTo(W + 100, L.sidewalkY - 6); ctx.stroke();

    for (var p = 0; p < passersby.length; p++) {
      var pb = passersby[p];
      D.drawFruitCharacter(ctx, pb.id, pb.x, L.sidewalkY - 12, 22, {
        time: elapsed + p,
        walking: true
      });
    }

    /* Striped Storefront Awning */
    var awY = L.awningTop;
    var awH = L.wallTop - awY;
    var stripeW = 62.5;
    for (var i = -2; i < 14; i++) {
      var ax = i * stripeW;
      ctx.fillStyle = Math.abs(i) % 2 === 0 ? '#E85A4F' : '#FFFDF7';
      ctx.fillRect(ax, awY, stripeW + 1, awH - 10);
      ctx.beginPath();
      ctx.arc(ax + stripeW / 2, awY + awH - 10, stripeW / 2, 0, Math.PI);
      ctx.fill();
      ctx.strokeStyle = '#3B2A1A';
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.arc(ax + stripeW / 2, awY + awH - 10, stripeW / 2, 0, Math.PI);
      ctx.stroke();
    }
    ctx.strokeStyle = '#3B2A1A';
    ctx.lineWidth = 3.5;
    ctx.beginPath(); ctx.moveTo(-100, awY); ctx.lineTo(W + 100, awY); ctx.stroke();
  }

  function drawBackWallAndFloor() {
    var night = isNightAtmosphere();
    var fullLeft = -offsetX / viewScale - 40;
    var fullW = W + (offsetX / viewScale) * 2 + 80;

    ctx.fillStyle = night ? '#E0CFAF' : '#F6EBD4';
    ctx.fillRect(fullLeft, L.wallTop - 8, fullW, L.floorTop - L.wallTop + 12);

    ctx.fillStyle = '#C99E67';
    ctx.fillRect(fullLeft, L.floorTop - 14, fullW, 14);
    ctx.strokeStyle = '#3B2A1A';
    ctx.lineWidth = 3.5;
    ctx.beginPath(); ctx.moveTo(fullLeft, L.floorTop); ctx.lineTo(fullLeft + fullW, L.floorTop); ctx.stroke();

    /* Wall Mirror */
    ctx.fillStyle = night ? '#BFD9EC' : '#D9F1FC';
    ctx.strokeStyle = '#3B2A1A';
    ctx.lineWidth = 3;
    D.roundRect(ctx, 28, L.wallTop + 16, 134, 88, 12);
    ctx.fill(); ctx.stroke();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(46, L.wallTop + 92); ctx.lineTo(90, L.wallTop + 26);
    ctx.moveTo(76, L.wallTop + 92); ctx.lineTo(116, L.wallTop + 26);
    ctx.stroke();

    /* Swinging Glass Entrance Doorway */
    var dx = L.doorX - 66;
    var dy = L.wallTop + 8;
    var dw = 132;
    var dh = L.floorTop - dy;
    ctx.fillStyle = night ? '#514A7A' : '#BFE6F7';
    ctx.strokeStyle = '#3B2A1A';
    ctx.lineWidth = 3.5;
    D.roundRect(ctx, dx, dy, dw, dh, 10);
    ctx.fill(); ctx.stroke();
    var openOffset = doorSwing * 28;
    ctx.fillStyle = 'rgba(255, 253, 247, 0.55)';
    ctx.strokeStyle = '#3B2A1A';
    ctx.lineWidth = 2.6;
    ctx.fillRect(dx + 6, dy + 6, dw / 2 - 8 - openOffset * 0.6, dh - 10);
    ctx.strokeRect(dx + 6, dy + 6, dw / 2 - 8 - openOffset * 0.6, dh - 10);
    ctx.fillRect(dx + dw / 2 + 2 + openOffset * 0.6, dy + 6, dw / 2 - 8 - openOffset * 0.6, dh - 10);
    ctx.strokeRect(dx + dw / 2 + 2 + openOffset * 0.6, dy + 6, dw / 2 - 8 - openOffset * 0.6, dh - 10);
    ctx.fillStyle = '#6BBF4E';
    D.roundRect(ctx, L.doorX - 36, dy + 10, 72, 24, 8);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#FFFDF7';
    ctx.font = '900 13px Menlo, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('OPEN', L.doorX, dy + 23);

    /* Reception & Energy Bar Counter */
    var cx = L.counterX;
    var cy = L.floorTop - 36;
    ctx.fillStyle = '#3E5245';
    ctx.strokeStyle = '#8C582B';
    ctx.lineWidth = 3.5;
    D.roundRect(ctx, cx + 12, L.wallTop + 10, 202, 46, 8);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#FFF7D6';
    ctx.font = lang() === 'en' ? '900 13px -apple-system, BlinkMacSystemFont, sans-serif' : '900 15px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(T().chalkTitle, cx + 113, L.wallTop + 26);
    ctx.fillStyle = '#FFD63B';
    ctx.font = '800 12px Menlo, monospace';
    ctx.fillText('WATER · TOWEL · SHAKE', cx + 113, L.wallTop + 44);

    ctx.fillStyle = '#D9A76A';
    ctx.strokeStyle = '#3B2A1A';
    ctx.lineWidth = 3.5;
    D.roundRect(ctx, cx, cy, 224, 56, 14);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#FFFDF7';
    D.roundRect(ctx, cx - 6, cy - 8, 236, 18, 9);
    ctx.fill(); ctx.stroke();
    D.drawNeedIcon(ctx, 'water', cx + 32, cy - 20, 14);
    D.drawNeedIcon(ctx, 'towel', cx + 84, cy - 20, 14);
    D.drawNeedIcon(ctx, 'shake', cx + 138, cy - 20, 14);

    ctx.fillStyle = feverCharge >= 100 ? '#E85A4F' : '#FFD63B';
    ctx.strokeStyle = '#3B2A1A';
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.arc(cx + 190, cy - 13, 14, Math.PI, 0);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.fillRect(cx + 173, cy - 13, 34, 6);

    /* Warm Honey-Oak Hardwood Floor */
    ctx.fillStyle = night ? '#D9BC8C' : '#F4DFBA';
    ctx.fillRect(fullLeft, L.floorTop, fullW, H - L.floorTop + 80);

    ctx.strokeStyle = night ? 'rgba(120, 82, 38, 0.25)' : 'rgba(176, 132, 72, 0.24)';
    ctx.lineWidth = 2;
    var plankH = 44;
    for (var py = L.floorTop + plankH; py < H + 40; py += plankH) {
      ctx.beginPath(); ctx.moveTo(fullLeft, py); ctx.lineTo(fullLeft + fullW, py); ctx.stroke();
      var stagger = (Math.floor(py / plankH) % 2) * 85;
      for (var px = stagger; px < W + 40; px += 170) {
        ctx.beginPath(); ctx.moveTo(px, py - plankH); ctx.lineTo(px, py); ctx.stroke();
      }
    }

    if (!night) {
      ctx.save();
      ctx.fillStyle = 'rgba(255, 251, 232, 0.26)';
      ctx.beginPath();
      ctx.moveTo(190, L.floorTop);
      ctx.lineTo(324, L.floorTop);
      ctx.lineTo(440, L.row2Y + 80);
      ctx.lineTo(255, L.row2Y + 80);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    if (dayCfg.day === 4 || dayCfg.day === 7) {
      ctx.save();
      ctx.fillStyle = '#D9433B';
      ctx.strokeStyle = '#FFD63B';
      ctx.lineWidth = 5;
      D.roundRect(ctx, L.doorX - 50, L.floorTop + 4, 100, 148, 10);
      ctx.fill(); ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    ctx.fillStyle = 'rgba(107, 191, 78, 0.22)';
    ctx.strokeStyle = 'rgba(46, 139, 87, 0.45)';
    ctx.lineWidth = 3;
    ctx.setLineDash([10, 6]);
    D.roundRect(ctx, 44, L.floorTop + 16, 424, 102, 22);
    ctx.fill(); ctx.stroke();
    ctx.restore();

    if (night) {
      var bCols = ['#FFD63B', '#E85A4F', '#6BBF4E', '#56D8FF', '#FF9BB2'];
      ctx.strokeStyle = '#3B2A1A'; ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(0, L.wallTop + 4);
      ctx.quadraticCurveTo(W / 2, L.wallTop + 26, W, L.wallTop + 4);
      ctx.stroke();
      for (var bi = 0; bi < 11; bi++) {
        var t = (bi + 0.5) / 11;
        var bx = t * W;
        var by = L.wallTop + 6 + Math.sin(t * Math.PI) * 14;
        var glowA = 0.55 + 0.45 * Math.sin(elapsed * 7 + bi);
        ctx.save();
        ctx.fillStyle = bCols[bi % bCols.length];
        ctx.globalAlpha = glowA * 0.4;
        ctx.beginPath(); ctx.arc(bx, by, 18, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = '#3B2A1A'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(bx, by, 7.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.restore();
      }
    } else if (dayCfg.day === 7) {
      var fCols = ['#56D8FF', '#FFD63B', '#3B2A1A', '#6BBF4E', '#E85A4F'];
      for (var fi = 0; fi < 15; fi++) {
        var fx = 16 + fi * 48;
        ctx.fillStyle = fCols[fi % fCols.length];
        ctx.strokeStyle = '#3B2A1A';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(fx, L.wallTop - 2);
        ctx.lineTo(fx + 36, L.wallTop - 2);
        ctx.lineTo(fx + 18, L.wallTop + 18);
        ctx.closePath();
        ctx.fill(); ctx.stroke();
      }
    }

    if (feverLeft > 0) {
      var fg = ctx.createRadialGradient(W / 2, (L.row1Y + L.row2Y) / 2, 40, W / 2, (L.row1Y + L.row2Y) / 2, 480);
      fg.addColorStop(0, 'rgba(255, 214, 59, 0.30)');
      fg.addColorStop(1, 'rgba(255, 214, 59, 0)');
      ctx.fillStyle = fg;
      ctx.fillRect(0, L.floorTop, W, H - L.floorTop);
    }
  }

  function drawOpenGymStations() {
    var t = T();
    var wantedMap = {};
    for (var q = 0; q < queue.length; q++) {
      if (queue[q]) wantedMap[queue[q].wantStation] = true;
    }
    var dragWant = (drag.active && queue[drag.qIdx]) ? queue[drag.qIdx].wantStation : null;
    var gearLv = career.upgrades.gear || 0;
    var frameCol = gearLv >= 3 ? '#FFD63B' : (gearLv >= 2 ? '#F0CF7A' : (gearLv >= 1 ? '#D6E2EA' : '#EAE1CE'));
    var night = isNightAtmosphere();

    for (var i = 0; i < stations.length; i++) {
      var st = stations[i];
      var cx = st.x;
      var cy = st.y;
      var hasVip = !!(st.fruit && st.fruit.isVip);

      ctx.save();

      if (night && st.unlocked) {
        var sp = ctx.createRadialGradient(cx, cy + 16, 18, cx, cy + 16, 165);
        sp.addColorStop(0, 'rgba(255, 232, 160, 0.34)');
        sp.addColorStop(1, 'rgba(255, 232, 160, 0)');
        ctx.fillStyle = sp;
        ctx.beginPath(); ctx.arc(cx, cy + 16, 165, 0, Math.PI * 2); ctx.fill();
      }

      ctx.fillStyle = hasVip ? 'rgba(255, 214, 59, 0.34)' : (st.unlocked ? 'rgba(59, 42, 26, 0.10)' : 'rgba(59, 42, 26, 0.08)');
      ctx.beginPath();
      ctx.ellipse(cx, cy + 56, 146, 54, 0, 0, Math.PI * 2);
      ctx.fill();

      if (st.unlocked && st.state === 'empty' && (wantedMap[st.id] || dragWant === st.id)) {
        var pulseR = 148 + Math.sin(elapsed * 7) * 5;
        ctx.save();
        ctx.strokeStyle = dragWant === st.id ? '#E85A4F' : '#FFD63B';
        ctx.lineWidth = dragWant === st.id ? 6 : 4.5;
        ctx.setLineDash([14, 9]);
        ctx.beginPath();
        ctx.ellipse(cx, cy + 54, pulseR, 56, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      } else if (st.highlightTimer > 0) {
        ctx.strokeStyle = '#E85A4F';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.ellipse(cx, cy + 54, 150, 56, 0, 0, Math.PI * 2);
        ctx.stroke();
      }

      if (!st.unlocked) {
        ctx.fillStyle = '#FFD63B';
        ctx.strokeStyle = '#3B2A1A';
        ctx.lineWidth = 3.5;
        D.roundRect(ctx, cx - 102, cy - 8, 204, 34, 10);
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#3B2A1A';
        for (var k = -80; k <= 64; k += 44) {
          ctx.beginPath();
          ctx.moveTo(cx + k, cy - 6); ctx.lineTo(cx + k + 18, cy - 6);
          ctx.lineTo(cx + k + 6, cy + 24); ctx.lineTo(cx + k - 12, cy + 24);
          ctx.closePath(); ctx.fill();
        }
        ctx.strokeStyle = '#3B2A1A'; ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(cx - 78, cy + 26); ctx.lineTo(cx - 88, cy + 62);
        ctx.moveTo(cx + 78, cy + 26); ctx.lineTo(cx + 88, cy + 62);
        ctx.stroke();
        ctx.fillStyle = '#E85A4F'; ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(cx + 102, cy + 16); ctx.lineTo(cx + 118, cy + 64); ctx.lineTo(cx + 86, cy + 64);
        ctx.closePath(); ctx.fill(); ctx.stroke();

        ctx.fillStyle = '#FFFDF7';
        D.roundRect(ctx, cx - 116, cy + 64, 232, 34, 14);
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#3B2A1A';
        ctx.font = lang() === 'en' ? '900 14px -apple-system, BlinkMacSystemFont, sans-serif' : '900 16px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(t.unlockBoxing, cx, cy + 82);
        ctx.restore();
        continue;
      }

      ctx.strokeStyle = '#3B2A1A';
      ctx.lineWidth = 3.5;

      if (st.id === 'treadmill') {
        ctx.fillStyle = '#434A47';
        D.roundRect(ctx, cx - 114, cy + 32, 228, 38, 14);
        ctx.fill(); ctx.stroke();
        ctx.strokeStyle = '#A6C4B5'; ctx.lineWidth = 3.2;
        var beltShift = (st.state === 'working' || st.state === 'need') ? ((elapsed * 110) % 30) : 0;
        for (var mx = cx - 96 + beltShift; mx < cx + 100; mx += 30) {
          ctx.beginPath(); ctx.moveTo(mx, cy + 40); ctx.lineTo(mx - 10, cy + 62); ctx.stroke();
        }
        ctx.strokeStyle = '#3B2A1A'; ctx.lineWidth = 5;
        ctx.beginPath(); ctx.moveTo(cx + 82, cy + 32); ctx.lineTo(cx + 106, cy - 64); ctx.stroke();
        ctx.fillStyle = frameCol; ctx.lineWidth = 3.5;
        D.roundRect(ctx, cx + 68, cy - 82, 62, 30, 10);
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = st.state === 'working' ? '#6BBF4E' : '#8A968F';
        ctx.fillRect(cx + 80, cy - 73, 38, 12);
      } else if (st.id === 'dumbbell') {
        ctx.fillStyle = '#E85A4F';
        D.roundRect(ctx, cx - 100, cy + 34, 200, 28, 11);
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = frameCol;
        ctx.fillRect(cx - 82, cy + 62, 16, 16); ctx.strokeRect(cx - 82, cy + 62, 16, 16);
        ctx.fillRect(cx + 66, cy + 62, 16, 16); ctx.strokeRect(cx + 66, cy + 62, 16, 16);
        var lift = st.state === 'working' ? Math.sin(elapsed * 11) * 14 : 0;
        ctx.fillStyle = gearLv >= 2 ? '#FFD63B' : '#58626E';
        D.roundRect(ctx, cx - 114, cy - 12 + lift, 26, 46, 7); ctx.fill(); ctx.stroke();
        D.roundRect(ctx, cx + 88, cy - 12 - lift, 26, 46, 7); ctx.fill(); ctx.stroke();
      } else if (st.id === 'yoga') {
        ctx.fillStyle = gearLv >= 2 ? '#FFE37A' : '#A9E4B8';
        D.roundRect(ctx, cx - 120, cy + 20, 240, 56, 22);
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#FFFDF7';
        ctx.beginPath(); ctx.ellipse(cx - 104, cy + 48, 14, 26, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#D97B48';
        D.roundRect(ctx, cx - 134, cy - 20, 26, 28, 6); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#6BBF4E';
        ctx.beginPath(); ctx.arc(cx - 121, cy - 30, 14, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.arc(cx - 132, cy - 22, 10, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      } else if (st.id === 'boxing') {
        ctx.strokeStyle = '#525C68'; ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.moveTo(cx + 124, cy + 60); ctx.lineTo(cx + 124, cy - 104); ctx.lineTo(cx + 80, cy - 104);
        ctx.stroke();
        var swingWave = st.state === 'working' ? Math.sin(elapsed * 14) : 0;
        ctx.save();
        ctx.translate(cx + 80, cy - 104);
        ctx.rotate(swingWave * 0.26);
        ctx.strokeStyle = '#3B2A1A'; ctx.lineWidth = 3.5;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, 32); ctx.stroke();
        ctx.fillStyle = gearLv >= 2 ? '#FFD63B' : '#9D62EA';
        D.roundRect(ctx, -28, 30, 56, 98, 22);
        ctx.fill(); ctx.stroke();
        ctx.restore();

        if (st.state === 'working' && swingWave > 0.62) {
          ctx.fillStyle = '#FFD63B'; ctx.strokeStyle = '#3B2A1A'; ctx.lineWidth = 2.6;
          D.roundRect(ctx, cx + 10, cy - 68, 62, 28, 10);
          ctx.fill(); ctx.stroke();
          ctx.fillStyle = '#C43D33';
          ctx.font = '900 15px Menlo, monospace';
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText('POW!', cx + 41, cy - 53);
        }
      }

      ctx.fillStyle = hasVip ? '#FFD63B' : 'rgba(255, 253, 247, 0.9)';
      ctx.strokeStyle = '#3B2A1A';
      ctx.lineWidth = 2.4;
      var stLabel = pick(st.def.name);
      var tagTxt = hasVip ? (stLabel + ' · VIP x2') : (gearLv > 0 ? (stLabel + ' Lv.' + gearLv) : stLabel);
      ctx.font = '900 14px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
      var tagW = Math.max(96, Math.ceil(ctx.measureText(tagTxt).width) + 28);
      D.roundRect(ctx, cx - tagW / 2, cy + 80, tagW, 26, 13);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#3B2A1A';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(tagTxt, cx, cy + 94);

      if (st.state === 'working' || st.state === 'need') {
        var isSleep = st.state === 'need' && st.needType === 'sleep';
        var fx = st.state === 'need' ? (cx - 28) : (cx - 6);
        D.drawFruitCharacter(ctx, st.fruit.id, fx, cy - 6, 48, {
          time: elapsed,
          working: !isSleep,
          sleepy: isSleep
        });

        if (isSleep) {
          var zd = (elapsed * 24) % 26;
          ctx.fillStyle = '#3B2A1A';
          ctx.font = '900 20px Menlo, monospace';
          ctx.textAlign = 'center';
          ctx.fillText('Z', fx + 30, cy - 52 - zd);
          ctx.font = '900 14px Menlo, monospace';
          ctx.fillText('z', fx + 44, cy - 36 - zd * 0.7);
        }

        var pbX = cx - 76, pbY = cy + 56, pbW = 152, pbH = 14;
        ctx.fillStyle = '#EAE1CE';
        ctx.strokeStyle = '#3B2A1A';
        ctx.lineWidth = 2.4;
        D.roundRect(ctx, pbX, pbY, pbW, pbH, 7);
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#6BBF4E';
        var pfw = Math.max(4, (pbW - 4) * Math.min(1, st.progress));
        D.roundRect(ctx, pbX + 2, pbY + 2, pfw, pbH - 4, 5);
        ctx.fill();

        if (st.state === 'need') {
          var nbx = cx + 82;
          var nby = cy - 54 + Math.sin(elapsed * 8) * 5;
          var nbr = 36;
          var nr = Math.max(0, st.needTimer / st.needMax);

          ctx.fillStyle = '#FFF7D6';
          ctx.strokeStyle = '#E85A4F';
          ctx.lineWidth = 3.8;
          ctx.beginPath(); ctx.arc(nbx, nby, nbr, 0, Math.PI * 2); ctx.fill(); ctx.stroke();

          ctx.strokeStyle = '#E85A4F'; ctx.lineWidth = 4.5;
          ctx.beginPath();
          ctx.arc(nbx, nby, nbr - 5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * nr);
          ctx.stroke();

          D.drawNeedIcon(ctx, st.needType, nbx, nby, 18);

          var hintTxt = st.needType === 'sleep' ? t.needSleep : (st.needType === 'water' ? t.needWater : (st.needType === 'shake' ? t.needShake : t.needTowel));
          ctx.fillStyle = '#E85A4F'; ctx.strokeStyle = '#3B2A1A'; ctx.lineWidth = 2.2;
          D.roundRect(ctx, nbx - 50, nby + nbr + 2, 100, 24, 10);
          ctx.fill(); ctx.stroke();
          ctx.fillStyle = '#FFFDF7';
          ctx.font = '900 13px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(hintTxt, nbx, nby + nbr + 15);
        }
      } else if (st.state === 'done') {
        D.drawFruitCharacter(ctx, st.fruit.id, cx - 32, cy - 8, 50, {
          time: elapsed,
          buff: true
        });
        var pay = st.payAmount + st.tipEarned;
        var payY = cy - 48 + Math.sin(elapsed * 7) * 5;
        ctx.fillStyle = '#FFD63B'; ctx.strokeStyle = '#3B2A1A'; ctx.lineWidth = 3.5;
        D.roundRect(ctx, cx + 28, payY - 24, 114, 48, 16);
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#3B2A1A';
        ctx.font = '900 22px Menlo, monospace';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('+' + t.cur + pay, cx + 85, payY + 1);
      } else if (st.state === 'dirty') {
        ctx.fillStyle = 'rgba(86, 216, 255, 0.78)';
        ctx.strokeStyle = '#3B2A1A';
        ctx.lineWidth = 2.6;
        ctx.beginPath(); ctx.ellipse(cx - 22, cy + 44, 42, 18, -0.1, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.ellipse(cx + 38, cy + 32, 26, 13, 0.2, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.arc(cx + 6, cy + 12, 11, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        if (career.day === 5) {
          ctx.beginPath(); ctx.ellipse(cx - 60, cy + 20, 24, 12, -0.15, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          ctx.beginPath(); ctx.arc(cx + 64, cy + 48, 12, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        }
        ctx.fillStyle = '#1985A1';
        ctx.font = '900 15px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(career.day === 5 ? t.dirtyDay5 : t.dirtyNormal, cx, cy - 12);
      }

      ctx.restore();
    }
  }

  function drawQueueAndMovingActors() {
    var t = T();
    for (var i = 0; i < queue.length; i++) {
      var g = queue[i];
      if (!g) continue;
      if (drag.active && drag.qIdx === i) continue;

      var angry = (g.patience / g.maxPatience) < 0.32;
      var bob = g.arrived ? Math.sin(elapsed * 4.5 + i) * 3 : 0;
      D.drawFruitCharacter(ctx, g.spec.id, g.x, g.y + bob, 40, {
        time: elapsed + i,
        angry: angry,
        walking: !g.arrived
      });

      if (g.spec.isVip) {
        ctx.fillStyle = '#FFD63B'; ctx.strokeStyle = '#3B2A1A'; ctx.lineWidth = 2.4;
        D.roundRect(ctx, g.x - 26, g.y + 30, 52, 22, 9);
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#3B2A1A';
        ctx.font = '900 13px Menlo, monospace';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('VIP', g.x, g.y + 42);
      }

      var bx = g.x + 48;
      var by = g.y - 34;
      var br = 29;
      var ratio = Math.max(0, g.patience / g.maxPatience);
      ctx.fillStyle = '#FFFDF7'; ctx.strokeStyle = '#3B2A1A'; ctx.lineWidth = 2.8;
      ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = ratio > 0.5 ? '#6BBF4E' : (ratio > 0.28 ? '#FFD63B' : '#E85A4F');
      ctx.lineWidth = 4.5;
      ctx.beginPath(); ctx.arc(bx, by, br - 4.5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ratio); ctx.stroke();
      D.drawNeedIcon(ctx, g.wantStation, bx, by, 16);
    }

    for (var w = 0; w < walkers.length; w++) {
      var wk = walkers[w];
      D.drawFruitCharacter(ctx, wk.spec.id, wk.x, wk.y, 42, { time: elapsed + w, walking: true });
    }

    for (var lv = 0; lv < leavers.length; lv++) {
      var lo = leavers[lv];
      D.drawFruitCharacter(ctx, lo.spec.id, lo.x, lo.y, 44, { time: elapsed + lv, buff: true, walking: true });
    }

    ctx.save();
    ctx.fillStyle = 'rgba(255, 247, 214, 0.9)';
    ctx.strokeStyle = '#3B2A1A'; ctx.lineWidth = 2.6;
    ctx.beginPath(); ctx.ellipse(helperCleaner.homeX, helperCleaner.homeY + 18, 72, 24, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = (career.upgrades.cleaner || 0) > 0 ? '#2E8B57' : '#786653';
    ctx.font = '900 13px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText((career.upgrades.cleaner || 0) > 0 ? t.cleanerOn : t.cleanerOff, helperCleaner.homeX, helperCleaner.homeY + 52);
    ctx.restore();

    ctx.save();
    ctx.fillStyle = 'rgba(232, 246, 230, 0.9)';
    ctx.strokeStyle = '#3B2A1A'; ctx.lineWidth = 2.6;
    ctx.beginPath(); ctx.ellipse(helperCoach.homeX, helperCoach.homeY + 18, 72, 24, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = (career.upgrades.coach || 0) > 0 ? '#2E8B57' : '#786653';
    ctx.font = '900 13px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText((career.upgrades.coach || 0) > 0 ? t.coachOn : t.coachOff, helperCoach.homeX, helperCoach.homeY + 52);
    ctx.restore();

    if (combo >= 2) {
      ctx.save();
      var cs = 1 + Math.sin(elapsed * 9) * 0.04;
      ctx.translate(W / 2, L.staffY + 12);
      ctx.scale(cs, cs);
      ctx.fillStyle = '#FFD63B'; ctx.strokeStyle = '#3B2A1A'; ctx.lineWidth = 3.2;
      D.roundRect(ctx, -84, -27, 168, 54, 18);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#C43D33';
      ctx.font = '900 24px Menlo, monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('COMBO x' + combo, 0, 2);
      ctx.restore();
    }

    if ((career.upgrades.cleaner || 0) > 0) {
      D.drawFruitCharacter(ctx, 'lemon', helperCleaner.x, helperCleaner.y, 30, {
        time: elapsed,
        walking: helperCleaner.targetStation !== -1,
        carry: helperCleaner.targetStation !== -1 ? 'mop' : null
      });
    } else {
      ctx.save(); ctx.globalAlpha = 0.36;
      D.drawFruitCharacter(ctx, 'lemon', helperCleaner.homeX, helperCleaner.homeY, 28, { time: 0 });
      ctx.restore();
    }

    if ((career.upgrades.coach || 0) > 0) {
      D.drawFruitCharacter(ctx, 'watermelon', helperCoach.x, helperCoach.y, 30, {
        time: elapsed,
        walking: helperCoach.targetStation !== -1,
        carry: helperCoach.targetStation !== -1 ? 'water' : null
      });
    } else {
      ctx.save(); ctx.globalAlpha = 0.36;
      D.drawFruitCharacter(ctx, 'watermelon', helperCoach.homeX, helperCoach.homeY, 28, { time: 0 });
      ctx.restore();
    }

    /* Playable Sprinting Manager */
    var bossMoving = !!boss.task || Math.abs(boss.x - boss.homeX) > 12 || Math.abs(boss.y - boss.homeY) > 12;
    D.drawFruitCharacter(ctx, 'watermelon', boss.x, boss.y, 34, {
      time: elapsed,
      walking: bossMoving,
      isBoss: true,
      carry: boss.carry
    });

    if (drag.active && queue[drag.qIdx]) {
      var dg = queue[drag.qIdx];
      var wantSt = null;
      for (var s = 0; s < stations.length; s++) {
        if (stations[s].id === dg.wantStation) { wantSt = stations[s]; break; }
      }
      if (wantSt && wantSt.unlocked && wantSt.state === 'empty') {
        ctx.save();
        ctx.strokeStyle = '#E85A4F';
        ctx.lineWidth = 4;
        ctx.setLineDash([10, 8]);
        ctx.beginPath(); ctx.moveTo(drag.x, drag.y); ctx.lineTo(wantSt.x, wantSt.y); ctx.stroke();
        ctx.restore();
      }
      D.drawFruitCharacter(ctx, dg.spec.id, drag.x, drag.y - 12, 46, { time: elapsed, walking: true });
    }
  }

  function drawVFXAndBanners() {
    var cur = T().cur;
    for (var fc = 0; fc < flyingCoins.length; fc++) {
      var c = flyingCoins[fc];
      if (c.t < 0) continue;
      var u = 1 - c.t;
      var cx = u * u * c.sx + 2 * u * c.t * c.cx + c.t * c.t * c.tx;
      var cy = u * u * c.sy + 2 * u * c.t * c.cy + c.t * c.t * c.ty;
      ctx.save();
      ctx.fillStyle = '#FFD63B'; ctx.strokeStyle = '#3B2A1A'; ctx.lineWidth = 2.8;
      ctx.beginPath(); ctx.arc(cx, cy, 15, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#3B2A1A'; ctx.font = '900 15px Menlo, monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(cur, cx, cy + 1);
      ctx.restore();
    }

    for (var i = 0; i < particles.length; i++) {
      var pt = particles[i];
      ctx.save();
      ctx.globalAlpha = Math.max(0, pt.life / pt.maxLife);
      ctx.fillStyle = pt.color;
      ctx.strokeStyle = '#3B2A1A';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(pt.x, pt.y, pt.r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.restore();
    }

    for (var cf = 0; cf < confetti.length; cf++) {
      var co = confetti[cf];
      ctx.save();
      ctx.translate(co.x, co.y);
      ctx.rotate(co.rot);
      ctx.fillStyle = co.color;
      ctx.fillRect(-co.w / 2, -co.h / 2, co.w, co.h);
      ctx.restore();
    }

    for (var j = 0; j < floatTexts.length; j++) {
      var ft = floatTexts[j];
      ctx.save();
      ctx.globalAlpha = Math.max(0, ft.life / ft.maxLife);
      ctx.font = '900 25px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 5; ctx.strokeStyle = '#FFFDF7';
      ctx.strokeText(ft.text, ft.x, ft.y);
      ctx.fillStyle = ft.color;
      ctx.fillText(ft.text, ft.x, ft.y);
      ctx.restore();
    }

    if (cameraFlash > 0) {
      ctx.save();
      ctx.fillStyle = 'rgba(255, 253, 247, ' + (cameraFlash * 0.45).toFixed(2) + ')';
      ctx.fillRect(-100, 0, W + 200, H);
      ctx.restore();
    }

    if (eventBanner.left > 0) {
      ctx.save();
      ctx.fillStyle = '#E85A4F';
      ctx.strokeStyle = '#3B2A1A';
      ctx.lineWidth = 3.6;
      D.roundRect(ctx, 48, L.awningTop - 2, W - 96, 48, 24);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#FFFDF7';
      ctx.font = lang() === 'en' ? '900 19px -apple-system, BlinkMacSystemFont, sans-serif' : '900 22px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(eventBanner.text, W / 2, L.awningTop + 23);
      ctx.restore();
    }
  }

  function render() {
    if (!ctx || !canvas) return;
    var dpr = Math.min(2, global.devicePixelRatio || 1);
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    var sx = 0, sy = 0;
    if (shakeTime > 0 && shakeMag > 0) {
      sx = (Math.random() - 0.5) * shakeMag * 2;
      sy = (Math.random() - 0.5) * shakeMag * 2;
    }
    ctx.translate(offsetX + sx, sy);
    ctx.scale(viewScale, viewScale);

    drawSkyAndStorefront();
    drawBackWallAndFloor();
    drawOpenGymStations();
    drawQueueAndMovingActors();
    drawVFXAndBanners();

    ctx.restore();
  }

  function loop(ts) {
    if (pageHidden) return;
    if (!lastTs) lastTs = ts;
    var dt = Math.min(0.06, (ts - lastTs) / 1000);
    lastTs = ts;
    step(dt);
    render();
    rafId = global.requestAnimationFrame(loop);
  }

  /* ---------- Dual Input: 1-Tap & Drag-and-Drop ---------- */
  function toLogicalPos(ev) {
    var rect = canvas.getBoundingClientRect();
    var cx = ev.clientX;
    var cy = ev.clientY;
    if (ev.changedTouches && ev.changedTouches.length) {
      cx = ev.changedTouches[0].clientX;
      cy = ev.changedTouches[0].clientY;
    } else if (ev.touches && ev.touches.length) {
      cx = ev.touches[0].clientX;
      cy = ev.touches[0].clientY;
    }
    return {
      x: (cx - rect.left - offsetX) / viewScale,
      y: (cy - rect.top) / viewScale
    };
  }

  function findStationNear(px, py) {
    for (var i = 0; i < stations.length; i++) {
      var st = stations[i];
      if (Math.abs(px - st.x) <= 150 && Math.abs(py - st.y) <= 112) return i;
    }
    return -1;
  }

  function onPointerDown(ev) {
    if (!running || openModalId) return;
    if (ev.cancelable) ev.preventDefault();
    var p = toLogicalPos(ev);

    if (Math.abs(p.x - (L.counterX + 190)) < 46 && Math.abs(p.y - (L.floorTop - 64)) < 46) {
      if (feverCharge >= 100 && feverLeft <= 0) {
        triggerFever();
        return;
      }
    }

    for (var q = 0; q < queue.length; q++) {
      var g = queue[q];
      if (!g) continue;
      if (Math.abs(p.x - (g.x + 16)) < 68 && Math.abs(p.y - (g.y - 6)) < 66) {
        drag.active = true;
        drag.qIdx = q;
        drag.startX = p.x;
        drag.startY = p.y;
        drag.x = p.x;
        drag.y = p.y;
        drag.moved = false;
        S.playGrab();
        return;
      }
    }

    var stIdx = findStationNear(p.x, p.y);
    if (stIdx !== -1) {
      var st = stations[stIdx];
      if (!st.unlocked) {
        renderShopModal();
        openModal('modalShop');
        return;
      }
      if (st.state === 'need') {
        queueBossTask(stIdx, 'serve');
      } else if (st.state === 'done') {
        collectStationCoins(st);
      } else if (st.state === 'dirty') {
        queueBossTask(stIdx, 'clean');
      } else if (st.state === 'empty') {
        var pickQ = -1;
        if (selectedQueueIdx !== -1 && queue[selectedQueueIdx] && queue[selectedQueueIdx].wantStation === st.id) {
          pickQ = selectedQueueIdx;
        } else {
          for (var k = 0; k < queue.length; k++) {
            if (queue[k] && queue[k].wantStation === st.id) { pickQ = k; break; }
          }
        }
        if (pickQ !== -1) seatFruitFromQueue(pickQ, stIdx);
        else dom.statusTip.textContent = T().tipEmpty(pick(st.def.name));
      }
      return;
    }

    if (Math.abs(p.y - L.staffY) < 64) {
      if ((Math.abs(p.x - helperCleaner.homeX) < 86 && !(career.upgrades.cleaner > 0)) ||
          (Math.abs(p.x - helperCoach.homeX) < 86 && !(career.upgrades.coach > 0))) {
        renderShopModal();
        openModal('modalShop');
      }
    }
  }

  function onPointerMove(ev) {
    if (!drag.active) return;
    if (ev.cancelable) ev.preventDefault();
    var p = toLogicalPos(ev);
    drag.x = p.x;
    drag.y = p.y;
    if (Math.abs(p.x - drag.startX) > 14 || Math.abs(p.y - drag.startY) > 14) {
      drag.moved = true;
    }
  }

  function onPointerUp(ev) {
    if (!drag.active) return;
    var qIdx = drag.qIdx;
    var wasMoved = drag.moved;
    var p = toLogicalPos(ev);
    drag.active = false;
    drag.qIdx = -1;

    var g = queue[qIdx];
    if (!g) return;

    var targetIdx = -1;
    if (wasMoved) {
      var dropIdx = findStationNear(p.x, p.y);
      if (dropIdx !== -1 && stations[dropIdx].unlocked && stations[dropIdx].state === 'empty') {
        targetIdx = dropIdx;
      }
    }
    if (targetIdx === -1) {
      for (var s = 0; s < stations.length; s++) {
        if (stations[s].id === g.wantStation) { targetIdx = s; break; }
      }
    }

    if (targetIdx !== -1 && stations[targetIdx].unlocked && stations[targetIdx].state === 'empty') {
      seatFruitFromQueue(qIdx, targetIdx);
    } else {
      selectedQueueIdx = qIdx;
      if (targetIdx !== -1) {
        stations[targetIdx].highlightTimer = 0.7;
        var stName = pick(stations[targetIdx].def.name);
        dom.statusTip.textContent = stations[targetIdx].state === 'dirty'
          ? T().tipDirty(stName)
          : T().tipBusyAlt(stName);
      }
      S.playBuzz();
    }
  }

  /* ---------- Modals ---------- */
  function openModal(id) {
    var el = $(id);
    if (!el) return;
    document.body.classList.add('modal-open');
    el.classList.remove('hidden');
    el.setAttribute('aria-hidden', 'false');
    openModalId = id;
  }

  function closeModal(id) {
    var targetId = id || openModalId;
    if (!targetId) return;
    var el = $(targetId);
    if (el) {
      el.classList.add('hidden');
      el.setAttribute('aria-hidden', 'true');
    }
    document.body.classList.remove('modal-open');
    openModalId = null;
    if (targetId !== 'modalSummary' && !running && dom.startOverlay && dom.startOverlay.classList.contains('hidden')) {
      refreshStartCard();
    }
  }

  function bindModalGuard(backdropEl) {
    if (!backdropEl) return;
    backdropEl.addEventListener('click', function (ev) {
      if (ev.target === backdropEl && backdropEl.id !== 'modalSummary') closeModal(backdropEl.id);
    });
    backdropEl.addEventListener('touchmove', function (ev) {
      var scroller = backdropEl.querySelector('.modal-body');
      if (!scroller || !scroller.contains(ev.target)) ev.preventDefault();
    }, { passive: false });
    backdropEl.addEventListener('wheel', function (ev) {
      var scroller = backdropEl.querySelector('.modal-body');
      if (!scroller || !scroller.contains(ev.target)) ev.preventDefault();
    }, { passive: false });
  }

  /* ---------- Shop / Album / Local Revenue Board / Poster Modals ---------- */
  function renderShopModal() {
    var t = T();
    dom.shopSub.textContent = t.shopSub(career.coins);
    dom.shopList.innerHTML = '';

    for (var i = 0; i < D.UPGRADES.length; i++) {
      var u = D.UPGRADES[i];
      var lv = career.upgrades[u.id] || 0;
      var maxed = lv >= u.maxLv;
      var cost = maxed ? 0 : u.costs[lv];

      var row = document.createElement('div');
      row.className = 'shop-item';

      var info = document.createElement('div');
      info.className = 'shop-info';
      var nm = document.createElement('div');
      nm.className = 'shop-name';
      nm.textContent = pick(u.name);
      var lvSpan = document.createElement('span');
      lvSpan.className = 'shop-lv';
      lvSpan.textContent = maxed ? t.shopMaxed : ('Lv.' + lv + '/' + u.maxLv);
      nm.appendChild(lvSpan);

      var ds = document.createElement('div');
      ds.className = 'shop-desc';
      ds.textContent = pick(u.desc);
      info.appendChild(nm);
      info.appendChild(ds);

      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'shop-buy-btn';
      btn.textContent = maxed ? t.shopMaxed : (t.cur + cost);
      btn.disabled = maxed || career.coins < cost;
      btn.setAttribute('data-upgrade', u.id);

      row.appendChild(info);
      row.appendChild(btn);
      dom.shopList.appendChild(row);
    }
  }

  function renderAlbumModal() {
    var t = T();
    dom.albumSub.textContent = t.albumSub(countAlbum(), D.FRUITS.length);
    dom.albumGrid.innerHTML = '';

    for (var i = 0; i < D.FRUITS.length; i++) {
      var fr = D.FRUITS[i];
      var cnt = career.album[fr.id] || 0;
      var unlocked = cnt > 0;

      var wrap = document.createElement('div');
      wrap.className = 'album-card';
      var inner = document.createElement('div');
      inner.className = 'album-inner' + (unlocked ? '' : ' locked');

      var cv = document.createElement('canvas');
      cv.className = 'album-canvas';
      cv.width = 156;
      cv.height = 156;
      var mctx = cv.getContext('2d');
      if (unlocked) {
        D.drawFruitCharacter(mctx, fr.id, 78, 82, 42, { buff: true, time: 0.3 });
      } else {
        mctx.fillStyle = '#D9CEBA';
        mctx.beginPath(); mctx.arc(78, 78, 44, 0, Math.PI * 2); mctx.fill();
        mctx.fillStyle = '#786653';
        mctx.font = '900 44px Menlo, monospace';
        mctx.textAlign = 'center'; mctx.textBaseline = 'middle';
        mctx.fillText('?', 78, 80);
      }

      var nm = document.createElement('div');
      nm.className = 'album-name';
      nm.textContent = unlocked ? pick(fr.buffName) : t.albumLocked(pick(fr.name));

      var tg = document.createElement('div');
      tg.className = 'album-tag';
      tg.textContent = pick(fr.bio);

      inner.appendChild(cv);
      inner.appendChild(nm);
      inner.appendChild(tg);
      if (unlocked) {
        var cEl = document.createElement('div');
        cEl.className = 'album-count';
        cEl.textContent = t.albumCount(cnt);
        inner.appendChild(cEl);
      }
      wrap.appendChild(inner);
      dom.albumGrid.appendChild(wrap);
    }
  }

  function renderRankModal(sortMode) {
    rankSort = sortMode === 'recent' ? 'recent' : 'top';
    var t = T();
    var tabs = dom.rankTabs.querySelectorAll('.rank-tab');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].classList.toggle('active', tabs[i].getAttribute('data-sort') === rankSort);
    }

    dom.rankSub.textContent = t.rankSub;
    dom.myRankBanner.textContent = t.rankBanner(career.bestDayRev, career.day, career.totalServed);

    var entries = Array.isArray(career.dayHistory) ? career.dayHistory.slice() : [];
    if (!entries.length) {
      dom.rankList.innerHTML = '';
      var empty = document.createElement('div');
      empty.className = 'rank-empty';
      empty.textContent = t.rankEmpty;
      dom.rankList.appendChild(empty);
      return;
    }

    if (rankSort === 'top') {
      entries.sort(function (a, b) { return b.earned - a.earned || b.day - a.day; });
    } else {
      entries.sort(function (a, b) { return b.day - a.day || (b.ts || 0) - (a.ts || 0); });
    }

    dom.rankList.innerHTML = '';
    var limit = Math.min(20, entries.length);
    for (var k = 0; k < limit; k++) {
      var r = entries[k];
      var item = document.createElement('div');
      item.className = 'rank-row';

      var left = document.createElement('div');
      left.className = 'rank-left';

      var num = document.createElement('span');
      var rankNo = rankSort === 'top' ? (k + 1) : r.day;
      num.className = 'rank-num' + (rankSort === 'top' && rankNo <= 3 ? (' top-' + rankNo) : '');
      num.textContent = rankSort === 'top' ? String(rankNo) : ('D' + r.day);

      var meta = document.createElement('div');
      meta.className = 'rank-meta';

      var nick = document.createElement('span');
      nick.className = 'rank-nick';
      nick.textContent = t.rankRowTitle(r.day, D.pickText(r.title, lang()));

      var detail = document.createElement('span');
      detail.className = 'rank-detail';
      detail.textContent = t.rankRowDetail(r.served || 0, r.maxCombo || 0, r.stars || 1);

      meta.appendChild(nick);
      meta.appendChild(detail);
      left.appendChild(num);
      left.appendChild(meta);

      var sc = document.createElement('span');
      sc.className = 'rank-score';
      sc.textContent = t.cur + (r.earned || 0);

      item.appendChild(left);
      item.appendChild(sc);
      dom.rankList.appendChild(item);
    }
  }

  function openPosterModal() {
    var rep = lastDayReport || {
      day: career.day,
      dayTitleObj: dayCfg.title,
      earned: Math.max(dayEarned, career.bestDayRev),
      served: Math.max(dayServed, career.totalServed),
      maxCombo: maxCombo,
      stars: 3,
      bestDayRev: Math.max(dayEarned, career.bestDayRev),
      unlocked: countAlbum()
    };
    P.renderPoster(dom.posterCanvas, {
      lang: lang(),
      day: rep.day,
      dayTitle: D.pickText(rep.dayTitleObj, lang()),
      earned: rep.earned,
      served: rep.served,
      maxCombo: rep.maxCombo,
      stars: rep.stars,
      bestDayRev: rep.bestDayRev,
      unlocked: rep.unlocked
    });
    openModal('modalPoster');
  }

  /* ---------- Event Wiring ---------- */
  function bindEvents() {
    dom.btnStartDay.addEventListener('click', startDay);
    dom.btnFever.addEventListener('click', triggerFever);

    dom.btnLang.addEventListener('click', function () {
      setLang(career.lang === 'zh' ? 'en' : 'zh');
    });

    dom.btnOpenShop.addEventListener('click', function () {
      renderShopModal();
      openModal('modalShop');
    });

    dom.btnSumShop.addEventListener('click', function () {
      closeModal('modalSummary');
      renderShopModal();
      openModal('modalShop');
    });

    dom.btnNextDay.addEventListener('click', function () {
      closeModal('modalSummary');
      refreshStartCard();
    });

    dom.btnSumPoster.addEventListener('click', function () {
      closeModal('modalSummary');
      openPosterModal();
    });

    dom.shopList.addEventListener('click', function (ev) {
      var btn = ev.target.closest ? ev.target.closest('.shop-buy-btn') : ev.target;
      if (!btn || btn.disabled) return;
      var uid = btn.getAttribute('data-upgrade');
      var spec = null;
      for (var i = 0; i < D.UPGRADES.length; i++) {
        if (D.UPGRADES[i].id === uid) { spec = D.UPGRADES[i]; break; }
      }
      if (!spec) return;
      var lv = career.upgrades[uid] || 0;
      if (lv >= spec.maxLv) return;
      var cost = spec.costs[lv];
      if (career.coins < cost) return;

      career.coins -= cost;
      career.upgrades[uid] = lv + 1;
      if (uid === 'boxing') {
        for (var s = 0; s < stations.length; s++) {
          if (stations[s].id === 'boxing') stations[s].unlocked = true;
        }
      }
      S.playUpgrade();
      persistCareer();
      updateHud();
      renderShopModal();
      showToast(T().toastUpgraded(pick(spec.name)));
    });

    dom.btnSound.addEventListener('click', function () {
      var next = !S.isMuted();
      S.setMuted(next);
      dom.soundIcon.src = next ? './icons/sound-off.svg' : './icons/sound-on.svg';
    });

    dom.btnAlbum.addEventListener('click', function () {
      renderAlbumModal();
      openModal('modalAlbum');
    });

    dom.btnRank.addEventListener('click', function () {
      renderRankModal(rankSort);
      openModal('modalRank');
    });

    dom.rankTabs.addEventListener('click', function (ev) {
      var btn = ev.target.closest ? ev.target.closest('.rank-tab') : ev.target;
      if (!btn || !btn.getAttribute('data-sort')) return;
      renderRankModal(btn.getAttribute('data-sort'));
    });

    dom.btnSavePoster.addEventListener('click', function () {
      var dataUrl = dom.posterCanvas.toDataURL('image/png');
      var dayNum = (lastDayReport && lastDayReport.day) || career.day;
      var ok = ST.downloadDataUrl(dataUrl, 'fruit-gym-day-' + dayNum + '.png');
      showToast(ok ? T().posterDownloaded : T().posterFallback);
    });

    var closes = document.querySelectorAll('[data-close]');
    for (var i = 0; i < closes.length; i++) {
      closes[i].addEventListener('click', function () {
        closeModal(this.getAttribute('data-close'));
      });
    }
    bindModalGuard(dom.modalSummary);
    bindModalGuard(dom.modalShop);
    bindModalGuard(dom.modalAlbum);
    bindModalGuard(dom.modalRank);
    bindModalGuard(dom.modalPoster);

    canvas.addEventListener('touchstart', onPointerDown, { passive: false });
    canvas.addEventListener('touchmove', onPointerMove, { passive: false });
    canvas.addEventListener('touchend', onPointerUp, { passive: false });
    canvas.addEventListener('mousedown', onPointerDown);
    global.addEventListener('mousemove', onPointerMove);
    global.addEventListener('mouseup', onPointerUp);

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        pageHidden = true;
        if (rafId) global.cancelAnimationFrame(rafId);
      } else {
        pageHidden = false;
        lastTs = 0;
        rafId = global.requestAnimationFrame(loop);
      }
    });
  }

  /* ---- OpenGame Playtest & Trailer Hook ---- */
  global.__omGame = {
    getState: function () {
      return {
        phase: running ? 'playing' : 'ready',
        running: running,
        tick: tick,
        lang: career.lang,
        day: career.day,
        coins: career.coins,
        dayEarned: dayEarned,
        selfId: 'player-1',
        players: { 'player-1': { connected: true, x: boss.x, z: boss.y } }
      };
    },
    getStats: function () {
      return {
        tick: tick,
        day: career.day,
        coins: career.coins,
        bestDayRev: career.bestDayRev,
        totalServed: career.totalServed
      };
    },
    start: function () {
      if (!running) startDay();
    },
    setLang: setLang
  };

  function init() {
    canvas = $('gymCanvas');
    ctx = canvas.getContext('2d');

    dom.gameRoot = $('gameRoot');
    dom.floatHud = $('floatHud');
    dom.floatDock = $('floatDock');
    dom.dayBadge = $('dayBadge');
    dom.timerBadge = $('timerBadge');
    dom.coinPill = $('coinPill');
    dom.coinDisplay = $('coinDisplay');
    dom.btnLang = $('btnLang');
    dom.btnSound = $('btnSound');
    dom.soundIcon = $('soundIcon');
    dom.btnAlbum = $('btnAlbum');
    dom.albumCount = $('albumCount');
    dom.btnRank = $('btnRank');
    dom.startOverlay = $('startOverlay');
    dom.startKicker = $('startKicker');
    dom.startTitle = $('startTitle');
    dom.startDesc = $('startDesc');
    dom.startTips = $('startTips');
    dom.btnStartDay = $('btnStartDay');
    dom.statusTip = $('statusTip');
    dom.btnOpenShop = $('btnOpenShop');
    dom.shopBtnLabel = $('shopBtnLabel');
    dom.shopDot = $('shopDot');
    dom.btnFever = $('btnFever');
    dom.feverLabel = $('feverLabel');
    dom.toast = $('toast');
    dom.modalSummary = $('modalSummary');
    dom.sumTitle = $('sumTitle');
    dom.sumStars = $('sumStars');
    dom.sumServedLbl = $('sumServedLbl');
    dom.sumServed = $('sumServed');
    dom.sumComboLbl = $('sumComboLbl');
    dom.sumCombo = $('sumCombo');
    dom.sumTipsLbl = $('sumTipsLbl');
    dom.sumTips = $('sumTips');
    dom.sumEarnedLbl = $('sumEarnedLbl');
    dom.sumEarned = $('sumEarned');
    dom.btnSumShop = $('btnSumShop');
    dom.btnNextDay = $('btnNextDay');
    dom.btnSumPoster = $('btnSumPoster');
    dom.modalShop = $('modalShop');
    dom.shopTitle = $('shopTitle');
    dom.shopSub = $('shopSub');
    dom.shopList = $('shopList');
    dom.modalAlbum = $('modalAlbum');
    dom.albumTitle = $('albumTitle');
    dom.albumSub = $('albumSub');
    dom.albumGrid = $('albumGrid');
    dom.modalRank = $('modalRank');
    dom.rankTitle = $('rankTitle');
    dom.rankSub = $('rankSub');
    dom.rankTabs = $('rankTabs');
    dom.rankTabTop = $('rankTabTop');
    dom.rankTabRecent = $('rankTabRecent');
    dom.myRankBanner = $('myRankBanner');
    dom.rankList = $('rankList');
    dom.modalPoster = $('modalPoster');
    dom.posterTitle = $('posterTitle');
    dom.posterSub = $('posterSub');
    dom.posterCanvas = $('posterCanvas');
    dom.btnSavePoster = $('btnSavePoster');
    dom.posterHint = $('posterHint');

    var saved = ST.loadState();
    if (saved && typeof saved === 'object') {
      if (saved.lang === 'zh' || saved.lang === 'en') career.lang = saved.lang;
      if (typeof saved.day === 'number' && saved.day >= 1) career.day = Math.floor(saved.day);
      if (typeof saved.coins === 'number' && isFinite(saved.coins)) career.coins = Math.max(0, Math.round(saved.coins));
      if (typeof saved.bestDayRev === 'number') career.bestDayRev = saved.bestDayRev;
      if (typeof saved.totalServed === 'number') career.totalServed = saved.totalServed;
      if (saved.upgrades && typeof saved.upgrades === 'object') {
        for (var k in career.upgrades) {
          if (typeof saved.upgrades[k] === 'number') career.upgrades[k] = saved.upgrades[k];
        }
      }
      if (saved.album && typeof saved.album === 'object') career.album = saved.album;
      if (Array.isArray(saved.dayHistory)) career.dayHistory = saved.dayHistory;
    }

    seedPassersby();
    initStations();
    bindEvents();
    applyLanguage();

    resizeCanvas();
    global.addEventListener('load', resizeCanvas);
    global.addEventListener('resize', resizeCanvas);

    rafId = global.requestAnimationFrame(loop);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
