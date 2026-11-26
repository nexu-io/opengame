(function (global) {
  'use strict';

  var Data = global.SlackData;
  var Storage = global.SlackStorage;
  var Art = global.SlackArt;

  var $ = function (id) { return document.getElementById(id); };

  /* Logical physics arena (rendered at 2x onto 720x860 canvas) */
  var W = 360;
  var H = 430;
  var DANGER_Y = 76;
  var SPAWN_Y = 34;
  var GRAVITY = 1080;
  var DAMPING = 0.994;

  var UI = {
    zh: {
      pageTitle: '打工人摸鱼进化链',
      rankBtn: '摸鱼榜',
      dexBtn: '图鉴',
      bossBtn: '老板来了',
      langToggle: 'EN',
      scoreLabel: '当前摸鱼值',
      salaryPrefix: '带薪赚回：',
      bestLabel: '最高分',
      todayBestLabel: '今日最高',
      lunchTimerLabel: '午休倒计时',
      nextLabel: '下一招',
      comboPrefix: '连摸 x',
      dangerBanner: '摸鱼要露馅啦！快去茶水间或一键已读！',
      shakeLabel: '去茶水间',
      shakeLeft: function (n) { return '剩余 ' + n + ' 次'; },
      shakeRecharge: '连摸5次充能',
      clearLabel: '一键已读',
      clearLeft: function (n) { return '剩余 ' + n + ' 次'; },
      clearRecharge: '合周报+1次',
      restartLabel: '换工位',
      restartSub: '重开',
      evoLabel: '进化链',
      excelFile: 'Q4_核心业务增长颗粒度拆解_v8_真最终版.xlsx',
      excelSaved: '已自动同步',
      excelFx: '=SUM(抓手闭环:心智穿透)*1.38',
      excelCols: ['A 核心工作项', 'B Q4 目标', 'C 状态'],
      excelRows: [
        ['底层逻辑复盘与方法论沉淀', '+142.8%', '已对齐', true],
        ['重点场域抓手拉齐与赋能', '+86.4%', '推进中', true],
        ['高频链路精细化颗粒度验收', '99.2%', '待评审', false],
        ['跨部门协同增效与周报归档', '18 项', '进行中', true],
        ['核心用户留存曲线健康度复核', '+31.5%', '已闭环', true],
        ['工位颈椎微循环与饮水指标', '达标', '优先执行', true],
        ['下周期 OKR 拆解与资源评估', 'Draft v4', '排期中', false]
      ],
      excelNoteTitle: '会议纪要速记：',
      excelNoteBody: '整体大盘趋势向好，后续继续聚焦核心场景，打通端到端体验闭环，确保关键节点准点交付。',
      excelStatus: function (n) { return '本局已成功隐身 ' + n + ' 次 · 物理与计时已暂停'; },
      excelResume: '老板走了，继续摸鱼',
      bossExitToast: '警报解除！继续带薪摸鱼～',
      rankKicker: '本机战绩榜单',
      rankTitle: '工位摸鱼英雄榜',
      rankSummary: function (modeLbl, pb, games, kings) {
        return '「' + modeLbl + '」最高 ' + pb + ' 分 · 累计 ' + games + ' 局 · 合出 ' + kings + ' 个躺平大王';
      },
      rankEmpty: '该模式还没有完成记录，打完一局即可登上本机摸鱼榜第 1 名！',
      rankRunSub: function (stageName, combo, dateLabel) {
        return '最高解锁：' + stageName + ' · ' + combo + ' 连摸 · ' + dateLabel;
      },
      dexTitle: '打工人摸鱼进化图鉴',
      dexProgress: function (u, t) { return '已解锁 ' + u + ' / ' + t; },
      dexStatGames: '累计摸鱼局数',
      dexStatKings: '累计躺平大王',
      dexStatDodges: '躲过老板次数',
      dexLockedName: '未解锁段位',
      dexLockedQuote: '继续合成进化解锁台词',
      resultTitleKing: '进化出带薪躺平大王！',
      resultTitleDefault: '工位摸鱼鉴定书',
      resultTopPrefix: '最高解锁：',
      resultSalaryPrefix: '已稳稳赚回：',
      resultKpiBest: '历史最高',
      resultKpiCombo: '最高连摸',
      resultKpiComboVal: function (n) { return n + ' 连摸'; },
      resultKpiDodge: '躲过老板',
      resultKpiDodgeVal: function (n) { return n + ' 次'; },
      resultKpiKing: '躺平大王',
      resultKpiKingVal: function (n) { return n + ' 个'; },
      resultTipPrefix: '工位评语：',
      btnPlayAgain: '再来一局',
      btnOpenPoster: '查看 3:4 战绩卡',
      posterKicker: '3:4 复古工牌战绩卡',
      posterTitle: '摸鱼战绩卡',
      btnDownloadPoster: '下载 PNG 战绩卡',
      posterHint: '也可右键或长按上方卡片保存图片',
      posterDownloaded: '战绩卡已开始下载！',
      posterFallback: '请右键或长按上方战绩卡保存图片',
      reasonLunch: '午休 60 秒结束！快收好手机！',
      reasonOverflow: '工位摸鱼堆过警戒线啦！',
      toastShakeCharged: '连摸充能成功！「去茶水间」+1 次',
      toastKingUnlocked: '恭喜进化出【带薪躺平大王】！',
      toastClearBonus: '合出假装写周报！奖励「一键已读」+1 次',
      floatDoubleKing: function (pts) { return '双躺王加薪 +' + pts; },
      quoteDoubleKing: '双带薪躺平大王共振！今日直接提前下班！',
      toastShakeEmpty: '去茶水间次数用完啦，连摸 5 次可再充能 1 次！',
      toastDeskEmpty: '工位里还是空的，先投几个摸鱼动作吧～',
      quoteShook: '去茶水间晃了一圈！工位松动，快趁机合成！',
      toastClearEmpty: '一键已读已用完，合成「假装写周报」可再获 1 次！',
      toastClearNone: '当前没有「早起喝水 / 工位发呆」小杂事可清，先留着救命！',
      quoteCleared: function (n) { return '一键已读清空 ' + n + ' 条工位杂事，空间瞬间通畅！'; },
      toastSoundOn: '工位摸鱼音效已开启',
      toastSoundOff: '已静音，低调摸鱼模式',
      toastRestarted: '已换新工位，重新开摸！'
    },
    en: {
      pageTitle: 'Slacking Evolution',
      rankBtn: 'Rank',
      dexBtn: 'Dex',
      bossBtn: 'Boss!',
      langToggle: '中',
      scoreLabel: 'SLACK SCORE',
      salaryPrefix: 'Earned: ',
      bestLabel: 'BEST',
      todayBestLabel: 'TODAY',
      lunchTimerLabel: 'TIME LEFT',
      nextLabel: 'NEXT',
      comboPrefix: 'COMBO x',
      dangerBanner: 'Stack too high! Use Pantry Shake or Mark Read!',
      shakeLabel: 'Pantry',
      shakeLeft: function (n) { return n + ' left'; },
      shakeRecharge: '5 combos +1',
      clearLabel: 'Mark Read',
      clearLeft: function (n) { return n + ' left'; },
      clearRecharge: 'Lv.8 +1',
      restartLabel: 'New Desk',
      restartSub: 'Restart',
      evoLabel: 'Chain',
      excelFile: 'Q4_Core_Growth_Granularity_v8_FINAL.xlsx',
      excelSaved: 'Auto-Saved',
      excelFx: '=SUM(Synergy:Alignment)*1.38',
      excelCols: ['A Key Workstream', 'B Q4 Target', 'C Status'],
      excelRows: [
        ['First-principles playbook & methodology', '+142.8%', 'Aligned', true],
        ['Core funnel empowerment & leverage', '+86.4%', 'Active', true],
        ['High-frequency loop granularity audit', '99.2%', 'Review', false],
        ['Cross-team synergy & weekly rollup', '18 items', 'Active', true],
        ['Retention curve health verification', '+31.5%', 'Closed', true],
        ['Desk posture & hydration KPI check', 'On track', 'Priority', true],
        ['Next-cycle OKR breakdown & sizing', 'Draft v4', 'Queued', false]
      ],
      excelNoteTitle: 'Meeting Notes:',
      excelNoteBody: 'Macro trajectory remains healthy. Continuing to focus on core end-to-end loops to ensure crisp milestone delivery.',
      excelStatus: function (n) { return 'Stealth active (' + n + ' dodges) · Game paused'; },
      excelResume: 'Coast Clear — Resume',
      bossExitToast: 'Coast clear! Back to paid slacking~',
      rankKicker: 'Local High Scores',
      rankTitle: 'Desk Slacking Board',
      rankSummary: function (modeLbl, pb, games, kings) {
        return modeLbl + ' Best: ' + pb + ' · ' + games + ' runs · ' + kings + ' Chill Kings';
      },
      rankEmpty: 'No local runs in this mode yet—finish a round to claim #1 on this device!',
      rankRunSub: function (stageName, combo, dateLabel) {
        return 'Top: ' + stageName + ' · x' + combo + ' combo · ' + dateLabel;
      },
      dexTitle: '11-Stage Evolution Dex',
      dexProgress: function (u, t) { return 'Unlocked ' + u + ' / ' + t; },
      dexStatGames: 'Total Runs',
      dexStatKings: 'Chill Kings',
      dexStatDodges: 'Boss Dodges',
      dexLockedName: 'Locked Stage',
      dexLockedQuote: 'Keep merging to unlock this habit',
      resultTitleKing: 'Paid Chill King Evolved!',
      resultTitleDefault: 'Desk Slacking Report',
      resultTopPrefix: 'Top Evolution: ',
      resultSalaryPrefix: 'Earned Back: ',
      resultKpiBest: 'Best',
      resultKpiCombo: 'Max Combo',
      resultKpiComboVal: function (n) { return 'x' + n; },
      resultKpiDodge: 'Boss Dodges',
      resultKpiDodgeVal: function (n) { return n + 'x'; },
      resultKpiKing: 'Chill Kings',
      resultKpiKingVal: function (n) { return String(n); },
      resultTipPrefix: 'Desk Review: ',
      btnPlayAgain: 'Play Again',
      btnOpenPoster: '3:4 Badge Card',
      posterKicker: '3:4 Retro Desk Badge',
      posterTitle: 'Slacking Badge Card',
      btnDownloadPoster: 'Download PNG Card',
      posterHint: 'Or right-click / long-press the card above to save',
      posterDownloaded: 'Downloading badge card PNG!',
      posterFallback: 'Right-click or long-press the card above to save',
      reasonLunch: '60s lunch break is up!',
      reasonOverflow: 'Your desk stack crossed the warning line!',
      toastShakeCharged: 'Combo charged! Pantry Shake +1',
      toastKingUnlocked: 'Evolved the Paid Chill King!',
      toastClearBonus: 'Fake OKR Report merged! Mark Read +1',
      floatDoubleKing: function (pts) { return 'DOUBLE KING +' + pts; },
      quoteDoubleKing: 'Twin Paid Chill Kings collided! Clocking out early today!',
      toastShakeEmpty: 'No Pantry Shakes left—chain 5 combos to recharge +1!',
      toastDeskEmpty: 'Desk is empty—drop a few icons first!',
      quoteShook: 'Pantry break shake! Everything loosened up—time to merge!',
      toastClearEmpty: 'No Mark Read left—merge a Fake OKR Report for +1!',
      toastClearNone: 'No Water Break or Daydream orbs to clear right now!',
      quoteCleared: function (n) { return 'Marked ' + n + ' tiny distractions as read—instant desk space!'; },
      toastSoundOn: 'Arcade sound effects ON',
      toastSoundOff: 'Muted — stealth desk mode',
      toastRestarted: 'Fresh desk ready!'
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

  var saveProfile = {
    lang: detectInitialLang(),
    soundEnabled: true,
    bestByMode: { daily_office: 0, lunch60: 0, same_desk: 0 },
    runsByMode: { daily_office: [], lunch60: [], same_desk: [] },
    unlockedLevels: [0, 1, 2],
    totalKings: 0,
    totalGames: 0,
    totalBossDodges: 0,
    dailyDateKey: ''
  };

  var game = {
    mode: 'daily_office',
    rankMode: 'daily_office',
    rng: Math.random,
    score: 0,
    maxLevel: 0,
    kingCount: 0,
    bossDodges: 0,
    combo: 0,
    maxCombo: 1,
    lastMergeTime: 0,
    comboChargeCount: 0,
    shakesLeft: 2,
    clearsLeft: 1,
    aimX: W / 2,
    currentLevel: 0,
    nextLevel: 1,
    canDrop: true,
    dropCooldownUntil: 0,
    bodies: [],
    particles: [],
    floatTexts: [],
    nextId: 1,
    dangerElapsed: 0,
    over: false,
    pausedByBoss: false,
    timeLeft: 0,
    timerInterval: null,
    pointerDown: false,
    lastFrameMs: 0,
    lastFinishReasonKey: 'reasonOverflow',
    lastQuoteMode: 'modeDesc',
    lastQuoteStage: -1,
    lastQuoteCleared: 0,
    tick: 0
  };

  function L() {
    return UI[saveProfile.lang] || UI.en;
  }

  /* ---- Web Audio Pentatonic Synth ---- */
  var audioCtx = null;
  var PENTATONIC = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1174.66, 1318.51];

  function getAudio() {
    if (!saveProfile.soundEnabled) return null;
    if (!audioCtx) {
      var Ctx = global.AudioContext || global.webkitAudioContext;
      if (Ctx) audioCtx = new Ctx();
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      try { audioCtx.resume(); } catch (e) {}
    }
    return audioCtx;
  }

  function playTone(freq, dur, type, vol, delay) {
    var ctx = getAudio();
    if (!ctx) return;
    var t = ctx.currentTime + (delay || 0);
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(vol || 0.075, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur);
  }

  function playDropSound() {
    playTone(290, 0.055, 'triangle', 0.055, 0);
  }

  function playMergeSound(newLevel, combo) {
    var idx = Math.min(PENTATONIC.length - 1, Math.max(0, combo - 1));
    var f = PENTATONIC[idx];
    playTone(f, 0.14, 'sine', 0.095, 0);
    playTone(f * 1.25, 0.12, 'triangle', 0.055, 0.04);
    if (newLevel >= 8) playTone(185, 0.16, 'triangle', 0.11, 0);
    if (newLevel >= 10) {
      playTone(523.25, 0.2, 'sine', 0.1, 0.05);
      playTone(659.25, 0.2, 'sine', 0.1, 0.14);
      playTone(783.99, 0.22, 'sine', 0.1, 0.23);
      playTone(1046.5, 0.36, 'sine', 0.12, 0.32);
    }
  }

  function playShakeSound() {
    playTone(170, 0.08, 'sawtooth', 0.045, 0);
    playTone(230, 0.08, 'sawtooth', 0.045, 0.09);
    playTone(190, 0.09, 'sawtooth', 0.045, 0.18);
  }

  /* ---- Toast ---- */
  var toastTimer = null;
  function showToast(msg) {
    if (!msg) return;
    var el = $('toastBanner');
    el.textContent = msg;
    el.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2300);
  }

  /* ---- Modal Scroll-Bleed Guard ---- */
  var savedScrollY = 0;
  var activeModalId = null;
  var touchStartY = 0;

  function findScrollBody(target, modalEl) {
    var cur = target;
    while (cur && cur !== modalEl) {
      if (cur.classList && (cur.classList.contains('modal-scroll-body') || cur.classList.contains('excel-grid-wrap'))) {
        return cur;
      }
      cur = cur.parentNode;
    }
    return null;
  }

  function bindScrollLock() {
    document.addEventListener('touchstart', function (e) {
      if (!activeModalId) return;
      if (e.touches && e.touches.length) touchStartY = e.touches[0].clientY;
    }, { passive: true });

    document.addEventListener('touchmove', function (e) {
      if (!activeModalId) return;
      var modalEl = $(activeModalId);
      var scroller = findScrollBody(e.target, modalEl);
      if (!scroller || scroller.scrollHeight <= scroller.clientHeight + 1) {
        e.preventDefault();
        return;
      }
      var curY = (e.touches && e.touches.length) ? e.touches[0].clientY : touchStartY;
      var dy = curY - touchStartY;
      var atTop = scroller.scrollTop <= 0 && dy > 0;
      var atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1 && dy < 0;
      if (atTop || atBottom) e.preventDefault();
    }, { passive: false });

    document.addEventListener('wheel', function (e) {
      if (!activeModalId) return;
      var modalEl = $(activeModalId);
      var scroller = findScrollBody(e.target, modalEl);
      if (!scroller || scroller.scrollHeight <= scroller.clientHeight + 1) {
        e.preventDefault();
        return;
      }
      var atTop = scroller.scrollTop <= 0 && e.deltaY < 0;
      var atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1 && e.deltaY > 0;
      if (atTop || atBottom) e.preventDefault();
    }, { passive: false });
  }

  function isRunPaused() {
    return game.pausedByBoss || Boolean(activeModalId);
  }

  function openModal(id) {
    game.pointerDown = false;
    if (activeModalId && activeModalId !== id) {
      $(activeModalId).classList.add('hidden');
    } else if (!activeModalId) {
      savedScrollY = global.pageYOffset || document.documentElement.scrollTop || 0;
      document.body.style.top = (-savedScrollY) + 'px';
      document.body.classList.add('modal-open');
    }
    activeModalId = id;
    var el = $(id);
    el.classList.remove('hidden');
    var sb = el.querySelector('.modal-scroll-body') || el.querySelector('.excel-grid-wrap');
    if (sb) sb.scrollTop = 0;
  }

  function closeModal(id) {
    var targetId = id || activeModalId;
    if (!targetId) return;
    $(targetId).classList.add('hidden');
    if (activeModalId === targetId) {
      activeModalId = null;
      document.body.classList.remove('modal-open');
      document.body.style.top = '';
      global.scrollTo(0, savedScrollY);
    }
  }

  /* ---- Boss Coming! Fake Spreadsheet Shield ---- */
  function renderBossCamoSheet() {
    var t = L();
    $('excelFilename').textContent = t.excelFile;
    $('excelSavedTag').textContent = t.excelSaved;
    $('excelFx').textContent = t.excelFx;
    $('excelColA').textContent = t.excelCols[0];
    $('excelColB').textContent = t.excelCols[1];
    $('excelColC').textContent = t.excelCols[2];
    $('excelNoteTitle').textContent = t.excelNoteTitle;
    $('excelNoteBody').textContent = t.excelNoteBody;
    $('bossCamoCountText').textContent = t.excelStatus(game.bossDodges);
    $('btnExitBossCamo').textContent = t.excelResume;

    var tbody = $('excelTableBody');
    tbody.innerHTML = '';
    for (var i = 0; i < t.excelRows.length; i++) {
      var row = t.excelRows[i];
      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td>' + (i + 1) + '</td>' +
        '<td>' + escapeHtml(row[0]) + '</td>' +
        '<td>' + escapeHtml(row[1]) + '</td>' +
        '<td class="' + (row[3] ? 'cell-ok' : 'cell-warn') + '">' + escapeHtml(row[2]) + '</td>';
      tbody.appendChild(tr);
    }
  }

  function enterBossCamo() {
    if (game.pausedByBoss) return;
    game.pausedByBoss = true;
    game.bossDodges += 1;
    saveProfile.totalBossDodges += 1;
    persistProfile();
    renderBossCamoSheet();
    openModal('bossCamoOverlay');
  }

  function exitBossCamo() {
    if (!game.pausedByBoss) return;
    game.pausedByBoss = false;
    game.lastFrameMs = performance.now();
    closeModal('bossCamoOverlay');
    showToast(L().bossExitToast);
  }

  /* ---- Persistence ---- */
  function persistProfile() {
    Storage.saveState({
      lang: saveProfile.lang,
      soundEnabled: saveProfile.soundEnabled,
      bestByMode: saveProfile.bestByMode,
      runsByMode: saveProfile.runsByMode,
      unlockedLevels: saveProfile.unlockedLevels,
      totalKings: saveProfile.totalKings,
      totalGames: saveProfile.totalGames,
      totalBossDodges: saveProfile.totalBossDodges,
      dailyDateKey: saveProfile.dailyDateKey,
      updatedAt: Date.now()
    });
  }

  function hydrateProfile() {
    var saved = Storage.loadSavedState();
    var todayKey = Data.getLocalDateKey();
    if (saved && typeof saved === 'object') {
      if (saved.lang === 'zh' || saved.lang === 'en') saveProfile.lang = saved.lang;
      if (typeof saved.soundEnabled === 'boolean') saveProfile.soundEnabled = saved.soundEnabled;
      if (saved.bestByMode && typeof saved.bestByMode === 'object') {
        saveProfile.bestByMode.daily_office = Number(saved.bestByMode.daily_office) || 0;
        saveProfile.bestByMode.lunch60 = Number(saved.bestByMode.lunch60) || 0;
        saveProfile.bestByMode.same_desk = (saved.dailyDateKey === todayKey) ? (Number(saved.bestByMode.same_desk) || 0) : 0;
      }
      if (saved.runsByMode && typeof saved.runsByMode === 'object') {
        saveProfile.runsByMode.daily_office = Array.isArray(saved.runsByMode.daily_office) ? saved.runsByMode.daily_office.slice(0, 10) : [];
        saveProfile.runsByMode.lunch60 = Array.isArray(saved.runsByMode.lunch60) ? saved.runsByMode.lunch60.slice(0, 10) : [];
        saveProfile.runsByMode.same_desk = (saved.dailyDateKey === todayKey && Array.isArray(saved.runsByMode.same_desk))
          ? saved.runsByMode.same_desk.slice(0, 10) : [];
      }
      if (Array.isArray(saved.unlockedLevels)) {
        saveProfile.unlockedLevels = saved.unlockedLevels;
      }
      saveProfile.totalKings = Number(saved.totalKings) || 0;
      saveProfile.totalGames = Number(saved.totalGames) || 0;
      saveProfile.totalBossDodges = Number(saved.totalBossDodges) || 0;
    }
    saveProfile.dailyDateKey = todayKey;
    applyLanguage();
  }

  function unlockStageLevel(level) {
    if (saveProfile.unlockedLevels.indexOf(level) < 0) {
      saveProfile.unlockedLevels.push(level);
      saveProfile.unlockedLevels.sort(function (a, b) { return a - b; });
      updateDexBadge();
      persistProfile();
    }
  }

  /* ---- Language Switching ---- */
  function getModeObj(modeId) {
    for (var i = 0; i < Data.MODES.length; i++) {
      if (Data.MODES[i].id === modeId) return Data.MODES[i];
    }
    return Data.MODES[0];
  }

  function refreshQuoteText() {
    var t = L();
    var lang = saveProfile.lang;
    var text = '';
    if (game.lastQuoteMode === 'stage' && game.lastQuoteStage >= 0) {
      var st = Data.STAGES[game.lastQuoteStage] || Data.STAGES[0];
      text = Data.pickText(st.name, lang) + (lang === 'zh' ? '：' : ': ') + Data.pickText(st.quote, lang);
    } else if (game.lastQuoteMode === 'doubleKing') {
      text = t.quoteDoubleKing;
    } else if (game.lastQuoteMode === 'shook') {
      text = t.quoteShook;
    } else if (game.lastQuoteMode === 'cleared') {
      text = t.quoteCleared(game.lastQuoteCleared);
    } else {
      text = Data.pickText(getModeObj(game.mode).desc, lang);
    }
    setQuote(text, game.combo >= 2 ? game.combo : 0);
  }

  function applyLanguage() {
    var t = L();
    var lang = saveProfile.lang;
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    document.title = t.pageTitle;

    $('rankBtnText').textContent = t.rankBtn;
    $('bossBtnText').textContent = t.bossBtn;
    $('btnLang').textContent = t.langToggle;
    $('hudScoreLabel').textContent = t.scoreLabel;
    $('nextLbl').textContent = t.nextLabel;
    $('dangerBanner').textContent = t.dangerBanner;
    $('shakeLabel').textContent = t.shakeLabel;
    $('clearLabel').textContent = t.clearLabel;
    $('restartLabel').textContent = t.restartLabel;
    $('restartSubLabel').textContent = t.restartSub;
    $('evoLabel').textContent = t.evoLabel;

    $('rankModeKicker').textContent = t.rankKicker;
    $('rankModalTitle').textContent = t.rankTitle;
    $('dexModalTitle').textContent = t.dexTitle;
    $('btnPlayAgain').textContent = t.btnPlayAgain;
    $('btnOpenPoster').textContent = t.btnOpenPoster;
    $('posterKicker').textContent = t.posterKicker;
    $('posterModalTitle').textContent = t.posterTitle;
    $('btnDownloadPoster').textContent = t.btnDownloadPoster;
    $('posterHint').textContent = t.posterHint;

    var modeBtns = document.querySelectorAll('.mode-tab');
    for (var i = 0; i < modeBtns.length; i++) {
      var m = getModeObj(modeBtns[i].getAttribute('data-mode'));
      modeBtns[i].textContent = Data.pickText(m.label, lang);
    }

    var rankTabs = document.querySelectorAll('#rankModeTabs .subtab-btn');
    for (var r = 0; r < rankTabs.length; r++) {
      var rm = getModeObj(rankTabs[r].getAttribute('data-rank-mode'));
      rankTabs[r].textContent = Data.pickText(rm.label, lang);
    }

    updateSoundUi();
    updateDexBadge();
    updateHud();
    refreshQuoteText();
    renderBossCamoSheet();

    if (activeModalId === 'rankModal') renderRankModal(game.rankMode);
    if (activeModalId === 'dexModal') renderDexModal();
    if (activeModalId === 'resultModal') renderResultModal();
    if (activeModalId === 'posterModal') renderPosterModalCanvas();
  }

  function setLang(nextLang) {
    saveProfile.lang = nextLang === 'en' ? 'en' : 'zh';
    persistProfile();
    applyLanguage();
  }

  /* ---- HUD Updates ---- */
  function updateSoundUi() {
    $('soundIcon').src = saveProfile.soundEnabled ? './icons/sound-on.svg' : './icons/sound-off.svg';
  }

  function updateDexBadge() {
    $('dexBadgeText').textContent = L().dexBtn + ' ' + saveProfile.unlockedLevels.length + '/' + Data.STAGES.length;
    renderEvoStrip();
  }

  function updateHud() {
    var t = L();
    var lang = saveProfile.lang;
    $('hudScore').textContent = String(game.score);
    $('hudSalaryText').textContent = t.salaryPrefix + Data.getSalaryReward(game.score, lang);

    var midValEl = $('hudMidVal');
    if (game.mode === 'lunch60') {
      $('hudMidLabel').textContent = t.lunchTimerLabel;
      midValEl.textContent = game.timeLeft + 's';
      if (game.timeLeft <= 10) midValEl.classList.add('hud-val-urgent');
      else midValEl.classList.remove('hud-val-urgent');
    } else {
      $('hudMidLabel').textContent = game.mode === 'same_desk' ? t.todayBestLabel : t.bestLabel;
      midValEl.textContent = String(Math.max(game.score, saveProfile.bestByMode[game.mode] || 0));
      midValEl.classList.remove('hud-val-urgent');
    }

    $('shakeCountText').textContent = game.shakesLeft > 0 ? t.shakeLeft(game.shakesLeft) : t.shakeRecharge;
    $('btnShake').classList.toggle('is-empty', game.shakesLeft <= 0);

    $('clearCountText').textContent = game.clearsLeft > 0 ? t.clearLeft(game.clearsLeft) : t.clearRecharge;
    $('btnClearSmall').classList.toggle('is-empty', game.clearsLeft <= 0);
  }

  function updateNextPreview() {
    var c = $('nextCanvas');
    var ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    Art.drawStage(ctx, game.nextLevel, 38, 38, 28, 0, 1);
  }

  function setQuote(text, comboCount) {
    $('quoteText').textContent = text;
    var strip = $('quoteStrip');
    var pill = $('comboPill');
    if (comboCount && comboCount >= 2) {
      pill.textContent = L().comboPrefix + comboCount;
      pill.classList.remove('hidden');
      strip.classList.add('fever-on');
    } else {
      pill.classList.add('hidden');
      strip.classList.remove('fever-on');
    }
  }

  function renderEvoStrip() {
    var wrap = $('evoDots');
    var lang = saveProfile.lang;
    wrap.innerHTML = '';
    for (var i = 0; i < Data.STAGES.length; i++) {
      var st = Data.STAGES[i];
      var unlocked = saveProfile.unlockedLevels.indexOf(i) >= 0;
      var dot = document.createElement('span');
      dot.className = 'evo-dot ' + (unlocked ? 'unlocked' : 'locked');
      dot.style.backgroundColor = unlocked ? st.color : '#E8DFCE';
      dot.textContent = unlocked ? Data.pickText(st.shortName, lang) : '?';
      wrap.appendChild(dot);
    }
  }

  /* ---- Physics & Core Gameplay ---- */
  function createBody(level, x, y, vx, vy) {
    var st = Data.STAGES[level] || Data.STAGES[0];
    return {
      id: game.nextId++,
      level: level,
      x: x,
      y: y,
      vx: vx || 0,
      vy: vy || 0,
      r: st.radius,
      angle: 0,
      va: 0,
      scale: 0.72,
      bornAt: performance.now(),
      merging: false
    };
  }

  function spawnParticles(x, y, color, count) {
    for (var i = 0; i < count; i++) {
      var a = (Math.PI * 2 * i) / count + Math.random() * 0.4;
      var spd = 70 + Math.random() * 140;
      game.particles.push({
        x: x,
        y: y,
        vx: Math.cos(a) * spd,
        vy: Math.sin(a) * spd - 35,
        r: 3 + Math.random() * 4,
        color: color,
        life: 0.55
      });
    }
  }

  function spawnFloatText(x, y, text, color) {
    game.floatTexts.push({
      x: x,
      y: y,
      text: text,
      color: color || '#E85A4F',
      life: 0.85
    });
  }

  function clampAimX(rawX, level) {
    var r = (Data.STAGES[level] || Data.STAGES[0]).radius;
    var minX = r + 6;
    var maxX = W - r - 6;
    return Math.max(minX, Math.min(maxX, rawX));
  }

  function syncDailySeedDate() {
    var todayKey = Data.getLocalDateKey();
    if (saveProfile.dailyDateKey !== todayKey) {
      saveProfile.dailyDateKey = todayKey;
      saveProfile.bestByMode.same_desk = 0;
      saveProfile.runsByMode.same_desk = [];
      persistProfile();
    }
    return todayKey;
  }

  function startNewGame(modeId) {
    if (modeId) game.mode = modeId;
    if (game.timerInterval) {
      clearInterval(game.timerInterval);
      game.timerInterval = null;
    }

    var modeBtns = document.querySelectorAll('.mode-tab');
    for (var i = 0; i < modeBtns.length; i++) {
      modeBtns[i].classList.toggle('active', modeBtns[i].getAttribute('data-mode') === game.mode);
    }

    if (game.mode === 'same_desk') {
      var seedStr = syncDailySeedDate();
      game.rng = Data.createSeededRandom(parseInt(seedStr, 10) * 19 + 42);
    } else {
      game.rng = Math.random;
    }

    game.score = 0;
    game.maxLevel = 0;
    game.kingCount = 0;
    game.bossDodges = 0;
    game.combo = 0;
    game.maxCombo = 1;
    game.lastMergeTime = 0;
    game.comboChargeCount = 0;
    game.shakesLeft = 2;
    game.clearsLeft = 1;
    game.bodies = [];
    game.particles = [];
    game.floatTexts = [];
    game.dangerElapsed = 0;
    game.over = false;
    game.pausedByBoss = false;
    game.canDrop = true;
    game.dropCooldownUntil = 0;
    game.currentLevel = Data.pickNextLevel(game.rng, 0);
    game.nextLevel = Data.pickNextLevel(game.rng, 0);
    game.aimX = W / 2;
    game.lastQuoteMode = 'modeDesc';
    game.lastQuoteStage = -1;

    $('dangerBanner').classList.add('hidden');
    closeModal('resultModal');
    closeModal('posterModal');

    var modeObj = getModeObj(game.mode);
    refreshQuoteText();

    if (game.mode === 'lunch60') {
      game.timeLeft = modeObj.timeLimit;
      game.timerInterval = setInterval(function () {
        if (game.over || isRunPaused()) return;
        game.timeLeft -= 1;
        updateHud();
        if (game.timeLeft <= 0) {
          clearInterval(game.timerInterval);
          game.timerInterval = null;
          finishGame('reasonLunch');
        }
      }, 1000);
    } else {
      game.timeLeft = 0;
    }

    updateNextPreview();
    updateHud();
  }

  function dropCurrentStage() {
    if (game.over || isRunPaused() || !game.canDrop) return;
    var now = performance.now();
    if (now < game.dropCooldownUntil) return;

    var x = clampAimX(game.aimX, game.currentLevel);
    var body = createBody(game.currentLevel, x, SPAWN_Y, (Math.random() - 0.5) * 8, 25);
    game.bodies.push(body);
    unlockStageLevel(game.currentLevel);
    if (game.currentLevel > game.maxLevel) game.maxLevel = game.currentLevel;

    playDropSound();

    game.canDrop = false;
    game.dropCooldownUntil = now + 380;
    game.currentLevel = game.nextLevel;
    game.nextLevel = Data.pickNextLevel(game.rng, game.maxLevel);
    game.aimX = clampAimX(game.aimX, game.currentLevel);
    updateNextPreview();
  }

  function handleMerge(a, b) {
    if (a.merging || b.merging) return;
    a.merging = true;
    b.merging = true;

    var mx = (a.x + b.x) * 0.5;
    var my = (a.y + b.y) * 0.5;
    var now = performance.now();
    var t = L();

    if (now - game.lastMergeTime <= 1450) {
      game.combo += 1;
    } else {
      game.combo = 1;
    }
    game.lastMergeTime = now;
    if (game.combo > game.maxCombo) game.maxCombo = game.combo;

    if (game.combo >= 2) {
      game.comboChargeCount += 1;
      if (game.comboChargeCount >= 5 && game.shakesLeft < 3) {
        game.comboChargeCount = 0;
        game.shakesLeft += 1;
        showToast(t.toastShakeCharged);
      }
    }

    var newLevel = a.level + 1;
    var comboBonus = game.combo >= 2 ? Math.round((game.combo - 1) * 4) : 0;

    if (newLevel >= Data.STAGES.length) {
      var ultraPts = 520 + comboBonus;
      game.score += ultraPts;
      game.kingCount += 1;
      saveProfile.totalKings += 1;
      spawnParticles(mx, my, '#FFD63B', 22);
      spawnParticles(mx, my, '#E85A4F', 14);
      spawnFloatText(mx, my - 10, t.floatDoubleKing(ultraPts), '#E85A4F');
      playMergeSound(10, game.combo + 2);
      Storage.vibrateMilestone(true);
      game.lastQuoteMode = 'doubleKing';
      refreshQuoteText();
    } else {
      var st = Data.STAGES[newLevel];
      var merged = createBody(newLevel, clampAimX(mx, newLevel), Math.min(H - st.radius - 2, my), (a.vx + b.vx) * 0.2, -55);
      merged.scale = 1.24;
      game.bodies.push(merged);

      var pts = st.score + comboBonus;
      game.score += pts;
      if (newLevel > game.maxLevel) game.maxLevel = newLevel;
      unlockStageLevel(newLevel);

      if (newLevel === 10) {
        game.kingCount += 1;
        saveProfile.totalKings += 1;
        Storage.vibrateMilestone(true);
        showToast(t.toastKingUnlocked);
      } else if (newLevel === 7 && game.clearsLeft < 2) {
        game.clearsLeft += 1;
        showToast(t.toastClearBonus);
      } else if (newLevel >= 8) {
        Storage.vibrateMilestone(false);
      }

      spawnParticles(mx, my, st.color, newLevel >= 8 ? 16 : 9);
      spawnFloatText(mx, my - 8, '+' + pts + (game.combo >= 2 ? ' x' + game.combo : ''), newLevel >= 8 ? '#E85A4F' : '#2E8B57');
      playMergeSound(newLevel, game.combo);
      game.lastQuoteMode = 'stage';
      game.lastQuoteStage = newLevel;
      refreshQuoteText();
    }

    if (game.score > (saveProfile.bestByMode[game.mode] || 0)) {
      saveProfile.bestByMode[game.mode] = game.score;
    }
    updateHud();
  }

  function triggerDeskShake() {
    if (game.over || isRunPaused()) return;
    var t = L();
    if (game.shakesLeft <= 0) {
      showToast(t.toastShakeEmpty);
      return;
    }
    if (game.bodies.length === 0) {
      showToast(t.toastDeskEmpty);
      return;
    }
    game.shakesLeft -= 1;
    playShakeSound();
    var frame = $('arenaFrame');
    frame.classList.remove('is-shaking');
    void frame.offsetWidth;
    frame.classList.add('is-shaking');

    for (var i = 0; i < game.bodies.length; i++) {
      var b = game.bodies[i];
      b.vx += (Math.random() - 0.5) * 280;
      b.vy -= (115 + Math.random() * 115);
      b.va += (Math.random() - 0.5) * 8;
    }
    game.dangerElapsed = 0;
    $('dangerBanner').classList.add('hidden');
    game.lastQuoteMode = 'shook';
    game.combo = 0;
    refreshQuoteText();
    updateHud();
  }

  function triggerReadAllClear() {
    if (game.over || isRunPaused()) return;
    var t = L();
    if (game.clearsLeft <= 0) {
      showToast(t.toastClearEmpty);
      return;
    }
    var removed = 0;
    var kept = [];
    for (var i = 0; i < game.bodies.length; i++) {
      var b = game.bodies[i];
      if (b.level <= 1) {
        removed += 1;
        spawnParticles(b.x, b.y, Data.STAGES[b.level].color, 7);
      } else {
        kept.push(b);
      }
    }
    if (removed === 0) {
      showToast(t.toastClearNone);
      return;
    }
    game.bodies = kept;
    game.clearsLeft -= 1;
    playTone(660, 0.14, 'triangle', 0.08, 0);
    playTone(880, 0.18, 'sine', 0.08, 0.07);
    game.lastQuoteMode = 'cleared';
    game.lastQuoteCleared = removed;
    game.combo = 0;
    refreshQuoteText();
    updateHud();
  }

  function stepPhysics(dt) {
    var bodies = game.bodies;
    var subSteps = 3;
    var sdt = dt / subSteps;

    for (var step = 0; step < subSteps; step++) {
      for (var i = 0; i < bodies.length; i++) {
        var b = bodies[i];
        if (b.merging) continue;
        b.vy += GRAVITY * sdt;
        b.vx *= DAMPING;
        b.vy *= DAMPING;
        b.x += b.vx * sdt;
        b.y += b.vy * sdt;
        b.angle += b.va * sdt;
        b.va *= 0.96;

        if (b.x - b.r < 0) {
          b.x = b.r;
          b.vx = Math.abs(b.vx) * 0.25;
        } else if (b.x + b.r > W) {
          b.x = W - b.r;
          b.vx = -Math.abs(b.vx) * 0.25;
        }
        if (b.y + b.r > H) {
          b.y = H - b.r;
          if (Math.abs(b.vy) < 28) b.vy = 0;
          else b.vy = -Math.abs(b.vy) * 0.18;
          b.vx *= 0.92;
          b.va = b.vx / Math.max(16, b.r);
        }
      }

      for (var p = 0; p < bodies.length; p++) {
        var a = bodies[p];
        if (a.merging) continue;
        for (var q = p + 1; q < bodies.length; q++) {
          var c = bodies[q];
          if (c.merging) continue;
          var dx = c.x - a.x;
          var dy = c.y - a.y;
          var distSq = dx * dx + dy * dy;
          var minDist = a.r + c.r;
          if (distSq < minDist * minDist) {
            if (a.level === c.level) {
              handleMerge(a, c);
              continue;
            }
            var dist = Math.sqrt(distSq) || 0.001;
            var nx = dx / dist;
            var ny = dy / dist;
            var overlap = (minDist - dist) * 0.52;

            var mA = a.r * a.r;
            var mC = c.r * c.r;
            var ratioA = mC / (mA + mC);
            var ratioC = mA / (mA + mC);

            a.x -= nx * overlap * ratioA * 2;
            a.y -= ny * overlap * ratioA * 2;
            c.x += nx * overlap * ratioC * 2;
            c.y += ny * overlap * ratioC * 2;

            var rvx = c.vx - a.vx;
            var rvy = c.vy - a.vy;
            var velAlongNormal = rvx * nx + rvy * ny;
            if (velAlongNormal < 0) {
              var imp = -(1.14 * velAlongNormal) / (1 / mA + 1 / mC);
              a.vx -= (imp / mA) * nx;
              a.vy -= (imp / mA) * ny;
              c.vx += (imp / mC) * nx;
              c.vy += (imp / mC) * ny;
              a.va -= nx * 0.45;
              c.va += nx * 0.45;
            }
          }
        }
      }
    }

    var nextBodies = [];
    for (var k = 0; k < bodies.length; k++) {
      var item = bodies[k];
      if (!item.merging) {
        item.scale += (1 - item.scale) * Math.min(1, dt * 12);
        nextBodies.push(item);
      }
    }
    game.bodies = nextBodies;

    var now = performance.now();
    if (!game.canDrop && now >= game.dropCooldownUntil) {
      game.canDrop = true;
    }

    var overLine = false;
    for (var m = 0; m < game.bodies.length; m++) {
      var mb = game.bodies[m];
      if (now - mb.bornAt > 950 && (mb.y - mb.r) < DANGER_Y) {
        overLine = true;
        break;
      }
    }
    if (overLine) {
      game.dangerElapsed += dt;
      if (game.dangerElapsed >= 0.45) {
        $('dangerBanner').classList.remove('hidden');
      }
      if (game.dangerElapsed >= 2.6) {
        finishGame('reasonOverflow');
      }
    } else {
      game.dangerElapsed = 0;
      $('dangerBanner').classList.add('hidden');
    }

    for (var pi = game.particles.length - 1; pi >= 0; pi--) {
      var pt = game.particles[pi];
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.vy += 320 * dt;
      pt.life -= dt;
      if (pt.life <= 0) game.particles.splice(pi, 1);
    }
    for (var fi = game.floatTexts.length - 1; fi >= 0; fi--) {
      var ft = game.floatTexts[fi];
      ft.y -= 36 * dt;
      ft.life -= dt;
      if (ft.life <= 0) game.floatTexts.splice(fi, 1);
    }
  }

  /* ---- Main Canvas Render ---- */
  function drawArena() {
    var canvas = $('gameCanvas');
    var ctx = canvas.getContext('2d');
    ctx.save();
    ctx.scale(2, 2);

    ctx.fillStyle = '#FFFDF7';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#F2EBD9';
    ctx.lineWidth = 1;
    for (var gx = 24; gx < W; gx += 24) {
      ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke();
    }
    for (var gy = 24; gy < H; gy += 24) {
      ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke();
    }

    ctx.fillStyle = 'rgba(243, 236, 224, 0.56)';
    ctx.fillRect(0, 0, W, DANGER_Y);

    ctx.save();
    ctx.setLineDash([7, 5]);
    ctx.strokeStyle = game.dangerElapsed > 0.35 ? '#E85A4F' : '#C7B99E';
    ctx.lineWidth = game.dangerElapsed > 0.35 ? 2.5 : 1.6;
    ctx.beginPath();
    ctx.moveTo(0, DANGER_Y);
    ctx.lineTo(W, DANGER_Y);
    ctx.stroke();
    ctx.restore();

    if (!game.over && game.canDrop) {
      var ax = clampAimX(game.aimX, game.currentLevel);
      ctx.save();
      ctx.setLineDash([4, 5]);
      ctx.strokeStyle = 'rgba(59, 42, 26, 0.25)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(ax, SPAWN_Y);
      ctx.lineTo(ax, H - 8);
      ctx.stroke();
      ctx.restore();

      var curSt = Data.STAGES[game.currentLevel] || Data.STAGES[0];
      Art.drawStage(ctx, game.currentLevel, ax, SPAWN_Y, curSt.radius, 0, 1);
    }

    for (var i = 0; i < game.bodies.length; i++) {
      var b = game.bodies[i];
      Art.drawStage(ctx, b.level, b.x, b.y, b.r, b.angle, b.scale);
    }

    for (var p = 0; p < game.particles.length; p++) {
      var pt = game.particles[p];
      ctx.globalAlpha = Math.max(0, pt.life / 0.55);
      ctx.fillStyle = pt.color;
      ctx.strokeStyle = '#3B2A1A';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    ctx.textAlign = 'center';
    ctx.font = '900 14px -apple-system, "PingFang SC", sans-serif';
    for (var f = 0; f < game.floatTexts.length; f++) {
      var ft = game.floatTexts[f];
      ctx.globalAlpha = Math.max(0, ft.life / 0.85);
      ctx.fillStyle = ft.color;
      ctx.fillText(ft.text, ft.x, ft.y);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function mainLoop(ts) {
    if (!game.lastFrameMs) game.lastFrameMs = ts;
    var dt = Math.min(0.032, (ts - game.lastFrameMs) / 1000);
    game.lastFrameMs = ts;

    if (!game.over && !isRunPaused()) {
      stepPhysics(dt);
      game.tick += 1;
    }
    drawArena();
    requestAnimationFrame(mainLoop);
  }

  /* ---- Result Summary & Local High-Score Recording ---- */
  function formatRunTime(ts) {
    var d = new Date(ts || Date.now());
    var m = String(d.getMonth() + 1);
    var day = String(d.getDate());
    var hh = String(d.getHours());
    var mm = String(d.getMinutes());
    if (hh.length < 2) hh = '0' + hh;
    if (mm.length < 2) mm = '0' + mm;
    return m + '/' + day + ' ' + hh + ':' + mm;
  }

  function recordLocalRun() {
    if (game.score <= 0) return;
    var list = saveProfile.runsByMode[game.mode] || [];
    list.push({
      score: game.score,
      maxLevel: game.maxLevel,
      maxCombo: game.maxCombo,
      kingCount: game.kingCount,
      ts: Date.now()
    });
    list.sort(function (a, b) { return b.score - a.score || b.ts - a.ts; });
    saveProfile.runsByMode[game.mode] = list.slice(0, 10);
  }

  function renderResultModal() {
    var t = L();
    var lang = saveProfile.lang;
    var modeObj = getModeObj(game.mode);
    var titleInfo = Data.getTitleByResult(game.score, game.maxLevel, game.kingCount, lang);
    var topStage = Data.STAGES[game.maxLevel] || Data.STAGES[0];
    var salaryReward = Data.getSalaryReward(game.score, lang);
    var reasonText = t[game.lastFinishReasonKey] || t.reasonOverflow;

    $('resultKicker').textContent = Data.pickText(modeObj.label, lang) + ' · ' + reasonText;
    $('resultTitle').textContent = game.kingCount > 0 ? t.resultTitleKing : t.resultTitleDefault;
    $('resultBadge').textContent = titleInfo.badge;
    $('resultBadge').style.color = titleInfo.color;
    $('resultBadge').style.borderColor = titleInfo.color;
    $('resultScoreNum').textContent = String(game.score);
    $('resultSubText').textContent = t.resultTopPrefix + Data.pickText(topStage.name, lang);
    $('resultSalaryPill').textContent = t.resultSalaryPrefix + salaryReward;

    var resCanvas = $('resultItemCanvas');
    var rctx = resCanvas.getContext('2d');
    rctx.clearRect(0, 0, 160, 160);
    Art.drawStage(rctx, game.maxLevel, 80, 80, 62, -0.06, 1);

    var thirdVal = game.bossDodges > 0 ? t.resultKpiDodgeVal(game.bossDodges) : t.resultKpiKingVal(game.kingCount);
    var thirdLbl = game.bossDodges > 0 ? t.resultKpiDodge : t.resultKpiKing;

    $('resultKpis').innerHTML =
      '<div class="result-kpi"><span>' + escapeHtml(t.resultKpiBest) + '</span><strong>' + (saveProfile.bestByMode[game.mode] || 0) + '</strong></div>' +
      '<div class="result-kpi"><span>' + escapeHtml(t.resultKpiCombo) + '</span><strong>' + escapeHtml(t.resultKpiComboVal(game.maxCombo)) + '</strong></div>' +
      '<div class="result-kpi"><span>' + escapeHtml(thirdLbl) + '</span><strong>' + escapeHtml(thirdVal) + '</strong></div>';

    $('resultTipBox').textContent = t.resultTipPrefix + titleInfo.tip;
  }

  function finishGame(reasonKey) {
    if (game.over) return;
    game.over = true;
    game.lastFinishReasonKey = reasonKey || 'reasonOverflow';
    if (game.timerInterval) {
      clearInterval(game.timerInterval);
      game.timerInterval = null;
    }

    saveProfile.totalGames += 1;
    if (game.score > (saveProfile.bestByMode[game.mode] || 0)) {
      saveProfile.bestByMode[game.mode] = game.score;
    }
    recordLocalRun();
    persistProfile();

    renderResultModal();
    openModal('resultModal');
  }

  function renderPosterModalCanvas() {
    var lang = saveProfile.lang;
    var modeObj = getModeObj(game.mode);
    return Art.renderResultPoster($('posterCanvas'), {
      lang: lang,
      score: game.score,
      bestScore: saveProfile.bestByMode[game.mode] || game.score,
      maxLevel: game.maxLevel,
      maxCombo: game.maxCombo,
      kingCount: game.kingCount,
      bossDodges: game.bossDodges,
      modeLabel: Data.pickText(modeObj.label, lang)
    });
  }

  /* ---- Local Records Leaderboard Modal ---- */
  function renderRankModal(modeId) {
    if (modeId) game.rankMode = modeId;
    if (game.rankMode === 'same_desk') syncDailySeedDate();
    var t = L();
    var lang = saveProfile.lang;
    var modeObj = getModeObj(game.rankMode);

    var tabs = document.querySelectorAll('#rankModeTabs .subtab-btn');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].classList.toggle('active', tabs[i].getAttribute('data-rank-mode') === game.rankMode);
    }

    var pb = saveProfile.bestByMode[game.rankMode] || 0;
    $('myRankCard').textContent = t.rankSummary(
      Data.pickText(modeObj.label, lang),
      pb,
      saveProfile.totalGames,
      saveProfile.totalKings
    );

    var runs = saveProfile.runsByMode[game.rankMode] || [];
    if (!runs.length) {
      $('rankList').innerHTML = '<div class="rank-empty">' + escapeHtml(t.rankEmpty) + '</div>';
      return;
    }

    var html = '';
    for (var j = 0; j < runs.length; j++) {
      var row = runs[j];
      var rankNo = j + 1;
      var topCls = rankNo <= 3 ? (' top-' + rankNo) : '';
      var stage = Data.STAGES[row.maxLevel] || Data.STAGES[0];
      var titleInfo = Data.getTitleByResult(row.score, row.maxLevel, row.kingCount || 0, lang);
      html +=
        '<div class="rank-item">' +
          '<div class="rank-item-left">' +
            '<span class="rank-no' + topCls + '">' + rankNo + '</span>' +
            '<div class="rank-meta">' +
              '<span class="rank-name">' + escapeHtml(titleInfo.badge) + '</span>' +
              '<span class="rank-sub">' + escapeHtml(t.rankRunSub(Data.pickText(stage.name, lang), row.maxCombo || 1, formatRunTime(row.ts))) + '</span>' +
            '</div>' +
          '</div>' +
          '<strong class="rank-score">' + (Number(row.score) || 0) + '</strong>' +
        '</div>';
    }
    $('rankList').innerHTML = html;
  }

  function openRankModal(modeId) {
    renderRankModal(modeId || game.mode);
    openModal('rankModal');
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ---- 11-Stage Evolution Dex Modal ---- */
  function renderDexModal() {
    var t = L();
    var lang = saveProfile.lang;
    $('dexProgressKicker').textContent = t.dexProgress(saveProfile.unlockedLevels.length, Data.STAGES.length);
    $('dexStatsBar').innerHTML =
      '<div class="dex-stat-pill"><span>' + escapeHtml(t.dexStatGames) + '</span><strong>' + saveProfile.totalGames + '</strong></div>' +
      '<div class="dex-stat-pill"><span>' + escapeHtml(t.dexStatKings) + '</span><strong>' + saveProfile.totalKings + '</strong></div>' +
      '<div class="dex-stat-pill"><span>' + escapeHtml(t.dexStatDodges) + '</span><strong>' + saveProfile.totalBossDodges + '</strong></div>';

    var grid = $('dexGrid');
    grid.innerHTML = '';

    for (var i = 0; i < Data.STAGES.length; i++) {
      var st = Data.STAGES[i];
      var unlocked = saveProfile.unlockedLevels.indexOf(i) >= 0;
      var card = document.createElement('div');
      card.className = 'dex-card' + (unlocked ? '' : ' locked');

      var cv = document.createElement('canvas');
      cv.width = 120;
      cv.height = 120;
      var cctx = cv.getContext('2d');
      if (unlocked) {
        Art.drawStage(cctx, i, 60, 60, 44, 0, 1);
      } else {
        cctx.fillStyle = '#D9CEBA';
        cctx.strokeStyle = '#3B2A1A';
        cctx.lineWidth = 4;
        cctx.beginPath(); cctx.arc(60, 60, 40, 0, Math.PI * 2); cctx.fill(); cctx.stroke();
        cctx.fillStyle = '#786653';
        cctx.textAlign = 'center';
        cctx.font = '900 36px "Menlo", sans-serif';
        cctx.fillText('?', 60, 73);
      }
      card.appendChild(cv);

      var lvEl = document.createElement('span');
      lvEl.className = 'dex-lv';
      lvEl.textContent = 'LV.' + (i + 1) + ' · ' + Data.pickText(st.tag, lang);
      card.appendChild(lvEl);

      var nameEl = document.createElement('strong');
      nameEl.className = 'dex-name';
      nameEl.textContent = unlocked ? Data.pickText(st.name, lang) : t.dexLockedName;
      card.appendChild(nameEl);

      var quoteEl = document.createElement('span');
      quoteEl.className = 'dex-quote';
      quoteEl.textContent = unlocked ? Data.pickText(st.quote, lang) : t.dexLockedQuote;
      card.appendChild(quoteEl);

      grid.appendChild(card);
    }
  }

  function openDexModal() {
    renderDexModal();
    openModal('dexModal');
  }

  /* ---- Pointer / Touch / Keyboard Input ---- */
  function getCanvasLogicalX(clientX) {
    var rect = $('gameCanvas').getBoundingClientRect();
    if (!rect.width) return W / 2;
    return ((clientX - rect.left) / rect.width) * W;
  }

  function bindArenaInput() {
    var canvas = $('gameCanvas');

    function onStart(clientX) {
      if (game.over || isRunPaused()) return;
      game.pointerDown = true;
      game.aimX = clampAimX(getCanvasLogicalX(clientX), game.currentLevel);
    }

    function onMove(clientX) {
      if (!game.pointerDown || game.over || isRunPaused()) return;
      game.aimX = clampAimX(getCanvasLogicalX(clientX), game.currentLevel);
    }

    function onEnd() {
      if (!game.pointerDown) return;
      game.pointerDown = false;
      dropCurrentStage();
    }

    canvas.addEventListener('touchstart', function (e) {
      if (e.touches && e.touches.length) {
        e.preventDefault();
        onStart(e.touches[0].clientX);
      }
    }, { passive: false });

    canvas.addEventListener('touchmove', function (e) {
      if (e.touches && e.touches.length) {
        e.preventDefault();
        onMove(e.touches[0].clientX);
      }
    }, { passive: false });

    canvas.addEventListener('touchend', function (e) {
      e.preventDefault();
      onEnd();
    }, { passive: false });

    canvas.addEventListener('mousedown', function (e) {
      onStart(e.clientX);
    });
    global.addEventListener('mousemove', function (e) {
      onMove(e.clientX);
    });
    global.addEventListener('mouseup', function () {
      onEnd();
    });

    global.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (game.pausedByBoss) exitBossCamo();
        else if (activeModalId) closeModal(activeModalId);
        return;
      }
      if (game.over || isRunPaused()) return;
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
        game.aimX = clampAimX(game.aimX - 24, game.currentLevel);
      } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
        game.aimX = clampAimX(game.aimX + 24, game.currentLevel);
      } else if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowDown') {
        e.preventDefault();
        dropCurrentStage();
      } else if (e.key === 'b' || e.key === 'B') {
        enterBossCamo();
      }
    });
  }

  function bindControls() {
    $('btnOpenRank').addEventListener('click', function () { openRankModal(game.mode); });
    $('btnOpenDex').addEventListener('click', function () { openDexModal(); });
    $('btnBossCamo').addEventListener('click', enterBossCamo);
    $('btnExitBossCamo').addEventListener('click', exitBossCamo);

    $('btnLang').addEventListener('click', function () {
      setLang(saveProfile.lang === 'zh' ? 'en' : 'zh');
    });

    $('btnSound').addEventListener('click', function () {
      saveProfile.soundEnabled = !saveProfile.soundEnabled;
      updateSoundUi();
      persistProfile();
      showToast(saveProfile.soundEnabled ? L().toastSoundOn : L().toastSoundOff);
    });

    var modeBtns = document.querySelectorAll('.mode-tab');
    for (var i = 0; i < modeBtns.length; i++) {
      modeBtns[i].addEventListener('click', function () {
        var m = this.getAttribute('data-mode');
        if (m && m !== game.mode) startNewGame(m);
      });
    }

    $('btnShake').addEventListener('click', triggerDeskShake);
    $('btnClearSmall').addEventListener('click', triggerReadAllClear);
    $('btnRestart').addEventListener('click', function () {
      startNewGame(game.mode);
      showToast(L().toastRestarted);
    });

    var rankTabs = document.querySelectorAll('#rankModeTabs .subtab-btn');
    for (var r = 0; r < rankTabs.length; r++) {
      rankTabs[r].addEventListener('click', function () {
        renderRankModal(this.getAttribute('data-rank-mode'));
      });
    }

    var closeBtns = document.querySelectorAll('[data-close-modal]');
    for (var c = 0; c < closeBtns.length; c++) {
      closeBtns[c].addEventListener('click', function () {
        closeModal(this.getAttribute('data-close-modal'));
      });
    }

    var backdrops = document.querySelectorAll('.modal-backdrop');
    for (var b = 0; b < backdrops.length; b++) {
      backdrops[b].addEventListener('click', function (e) {
        if (e.target === this) closeModal(this.id);
      });
    }

    $('btnPlayAgain').addEventListener('click', function () {
      startNewGame(game.mode);
    });

    $('btnOpenPoster').addEventListener('click', function () {
      renderPosterModalCanvas();
      openModal('posterModal');
    });

    $('btnDownloadPoster').addEventListener('click', function () {
      var dataUrl = renderPosterModalCanvas();
      var ok = Storage.downloadDataUrl(dataUrl, 'slacking-evolution-' + game.score + '.png');
      showToast(ok ? L().posterDownloaded : L().posterFallback);
    });
  }

  /* ---- OpenGame Playtest & Trailer Hook ---- */
  global.__omGame = {
    getState: function () {
      return {
        phase: game.over ? 'over' : 'playing',
        running: !game.over && !isRunPaused(),
        tick: game.tick,
        mode: game.mode,
        lang: saveProfile.lang,
        score: game.score,
        maxLevel: game.maxLevel,
        bodies: game.bodies.length,
        selfId: 'player-1',
        players: { 'player-1': { connected: true, x: game.aimX, z: 0 } }
      };
    },
    getStats: function () {
      return {
        tick: game.tick,
        score: game.score,
        best: saveProfile.bestByMode[game.mode] || 0,
        unlocked: saveProfile.unlockedLevels.length
      };
    },
    start: function () {
      if (game.over) startNewGame(game.mode);
    },
    setLang: setLang
  };

  function init() {
    bindScrollLock();
    bindArenaInput();
    bindControls();
    hydrateProfile();
    startNewGame('daily_office');
    requestAnimationFrame(mainLoop);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
