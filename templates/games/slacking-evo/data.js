/* ==========================================================================
   data.js — Bilingual (ZH / EN) Stages, Modes, Salary Rewards & Seeded RNG
   ========================================================================== */
(function (global) {
  'use strict';

  var STAGES = [
    {
      level: 0,
      key: 'water',
      name: { zh: '早起喝水', en: 'Water Break' },
      shortName: { zh: '喝', en: 'W' },
      tag: { zh: '续命起手', en: 'Warm-up' },
      radius: 16,
      score: 2,
      color: '#8AD0EE',
      accent: '#E3F6FE',
      quote: {
        zh: '先喝一口温水，假装刚开完一小时早会',
        en: 'Sip warm water first and act like you just survived a 1-hour standup.'
      }
    },
    {
      level: 1,
      key: 'daze',
      name: { zh: '工位发呆', en: 'Desk Daydream' },
      shortName: { zh: '呆', en: 'D' },
      tag: { zh: '灵魂出窍', en: 'AFK Brain' },
      radius: 21,
      score: 4,
      color: '#C7B8EA',
      accent: '#EFEAFF',
      quote: {
        zh: '眼神死盯文档，大脑其实已飞去冰岛看极光',
        en: 'Eyes locked on the doc; mind already watching northern lights in Iceland.'
      }
    },
    {
      level: 2,
      key: 'alttab',
      name: { zh: '疯狂切屏', en: 'Alt+Tab Ninja' },
      shortName: { zh: '切', en: 'T' },
      tag: { zh: '手速惊人', en: 'Fast Hands' },
      radius: 27,
      score: 8,
      color: '#F59A73',
      accent: '#FFE5D8',
      quote: {
        zh: 'Alt+Tab 练到无影手，脚步声一响瞬间切表格！',
        en: 'Lightning-fast Alt+Tab reflexes—one footstep and the spreadsheet appears!'
      }
    },
    {
      level: 3,
      key: 'pantry',
      name: { zh: '茶水间吃瓜', en: 'Pantry Gossip' },
      shortName: { zh: '茶', en: 'P' },
      tag: { zh: '八卦充电', en: 'Tea Time' },
      radius: 33,
      score: 14,
      color: '#FFD63B',
      accent: '#FFF6C2',
      quote: {
        zh: '只是去接杯热水的功夫，顺手听完半栋楼的瓜',
        en: 'Went for a quick tea refill, came back with half the building’s gossip.'
      }
    },
    {
      level: 4,
      key: 'restroom',
      name: { zh: '带薪蹲坑', en: 'Paid Restroom' },
      shortName: { zh: '蹲', en: 'R' },
      tag: { zh: '信号满格', en: 'Full Wi-Fi' },
      radius: 40,
      score: 22,
      color: '#8CD7B2',
      accent: '#E2F8ED',
      quote: {
        zh: '公司最安静的私人冥想室，灵感一下子全来了',
        en: 'The quietest meditation booth in the office—peak inspiration hits here.'
      }
    },
    {
      level: 5,
      key: 'stretch',
      name: { zh: '工位偷拉伸', en: 'Stealth Stretch' },
      shortName: { zh: '伸', en: 'S' },
      tag: { zh: '微运动回血', en: 'Desk Recharge' },
      radius: 47,
      score: 34,
      color: '#9ED65C',
      accent: '#EDF8D5',
      quote: {
        zh: '久坐脖子僵，趁没人在悄悄扩胸扭腰回口血！',
        en: 'Stiff neck alert—sneak in a shoulder stretch while nobody is looking!'
      }
    },
    {
      level: 6,
      key: 'milktea',
      name: { zh: '下午茶拼单', en: 'Boba Group Buy' },
      shortName: { zh: '茶', en: 'B' },
      tag: { zh: '续命奶茶', en: '3 PM Fuel' },
      radius: 55,
      score: 50,
      color: '#E5B480',
      accent: '#FBF0E2',
      quote: {
        zh: '三点几饮茶啦！群里拼单少冰三分糖加波霸！',
        en: '3 PM tea o’clock! Less ice, 30% sugar, extra boba for the whole squad!'
      }
    },
    {
      level: 7,
      key: 'weekly',
      name: { zh: '假装写周报', en: 'Fake OKR Report' },
      shortName: { zh: '报', en: 'O' },
      tag: { zh: '满屏颗粒度', en: 'Buzzwords' },
      radius: 63,
      score: 72,
      color: '#73B9D7',
      accent: '#E0F2FA',
      quote: {
        zh: '把今天干的三件小事，写成八页高大上复盘！',
        en: 'Turning three tiny tasks into an eight-page synergy retrospective!'
      }
    },
    {
      level: 8,
      key: 'mutecall',
      name: { zh: '开会静音挂机', en: 'Muted Call AFK' },
      shortName: { zh: '会', en: 'M' },
      tag: { zh: '嗯嗯好的', en: 'Sounds Good' },
      radius: 72,
      score: 100,
      color: '#B8B0A0',
      accent: '#F0ECE3',
      quote: {
        zh: '开麦三秒「收到没问题」，闭麦继续愉快刷手机',
        en: 'Unmute for 3 seconds: “Got it, aligned!” Mute again and keep chilling.'
      }
    },
    {
      level: 9,
      key: 'clockout',
      name: { zh: '准点拎包跑', en: '6 PM Dash' },
      shortName: { zh: '跑', en: '6' },
      tag: { zh: '18:00残影', en: 'On The Dot' },
      radius: 81,
      score: 140,
      color: '#F2A354',
      accent: '#FFEBD4',
      quote: {
        zh: '17:59 提前预热关机，18:00 走廊只留一阵风！',
        en: 'Shutting down at 17:59—nothing left in the hallway by 18:00 sharp!'
      }
    },
    {
      level: 10,
      key: 'king',
      name: { zh: '带薪躺平大王', en: 'Paid Chill King' },
      shortName: { zh: '王', en: 'K' },
      tag: { zh: '终极摸鱼王', en: 'Ultimate Legend' },
      radius: 92,
      score: 220,
      color: '#6BBF4E',
      accent: '#FFD63B',
      quote: {
        zh: '恭喜合出带薪躺平大王！今日薪水与快乐双丰收！',
        en: 'You evolved the Paid Chill King! Maximum vibes and salary secured!'
      }
    }
  ];

  var MODES = [
    {
      id: 'daily_office',
      label: { zh: '日常摸鱼', en: 'Classic' },
      desc: {
        zh: '佛系工位合成，冲刺带薪躺平大王',
        en: 'Relaxed desk merging—aim for the Paid Chill King!'
      },
      timeLimit: 0
    },
    {
      id: 'lunch60',
      label: { zh: '午休60秒', en: '60s Rush' },
      desc: {
        zh: '趁午休一分钟极限手速冲高分',
        en: '60-second lunch break blitz—merge as fast as you can!'
      },
      timeLimit: 60
    },
    {
      id: 'same_desk',
      label: { zh: '今日同工位', en: 'Daily Seed' },
      desc: {
        zh: '每日固定工位牌序，看看今天能打多高分',
        en: 'Fixed daily drop seed—same sequence all day for fair high-score runs!'
      },
      timeLimit: 0
    }
  ];

  function pickText(field, lang) {
    if (!field) return '';
    if (typeof field === 'string') return field;
    return field[lang] || field.zh || field.en || '';
  }

  function getSalaryReward(score, lang) {
    var en = lang === 'en';
    if (score >= 3200) return en ? 'Weekend Flight Ticket' : '1张周末短途机票';
    if (score >= 2200) return en ? 'Deluxe Seafood Buffet' : '1顿豪华海鲜自助';
    if (score >= 1500) return en ? 'Hotpot Feast for Two' : '1顿双人潮汕火锅';
    if (score >= 950) return en ? '2 Fruit Teas + Cake' : '2杯霸气水果茶+蛋糕';
    if (score >= 520) return en ? 'Iced Latte + Fried Chicken' : '1杯生椰拿铁+炸鸡';
    if (score >= 240) return en ? 'Iced Americano Recharge' : '1杯冰美式续命成功';
    if (score >= 80) return en ? '2 Pantry Candies' : '2颗茶水间小糖果';
    return en ? '1 Cup of Warm Water' : '1杯工位温开水';
  }

  function getTitleByResult(score, maxLevel, kingCount, lang) {
    var en = lang === 'en';
    if (kingCount >= 2 || score >= 3200) {
      return {
        badge: en ? 'Office Legend' : '摸鱼界天花板',
        color: '#E85A4F',
        tip: en
          ? 'The most chill strategist on the floor! Remember to stretch and take a real walk after work.'
          : '全公司最松弛的工位王者！高能摸鱼之余记得下班去活动 20 分钟，快乐更持久！'
      };
    }
    if (kingCount >= 1 || maxLevel >= 10) {
      return {
        badge: en ? 'Paid Chill Master' : '带薪躺平大师',
        color: '#2E8B57',
        tip: en
          ? 'You unlocked the Paid Chill King! Great pacing keeps work sustainable—time for a quick stretch.'
          : '成功进化出带薪躺平大王！张弛有度才是最好的工作续航，记得起来伸个大懒腰！'
      };
    }
    if (maxLevel >= 8 || score >= 1400) {
      return {
        badge: en ? 'Time-Mgmt Pro' : '工位时间管理师',
        color: '#D96B27',
        tip: en
          ? 'Smooth combos from Muted Call to 6 PM Dash—you are one step away from the ultimate Chill King!'
          : '开会静音、准点拎包一套连招行云流水，离终极躺平大王只差临门一脚啦！'
      };
    }
    if (maxLevel >= 5 || score >= 550) {
      return {
        badge: en ? 'Pantry Insider' : '茶水间情报官',
        color: '#3B7EA1',
        tip: en
          ? 'Solid rhythm with stretches and boba breaks! Save a Pantry Shake to spark late-game chain merges.'
          : '喝水、拉伸、拼奶茶节奏拿捏得刚刚好，用好「去茶水间」摇盒还能再冲一波！'
      };
    }
    return {
      badge: en ? 'Diligent Rookie' : '老实打工人',
      color: '#786653',
      tip: en
        ? 'Just warming up at the desk! Stack bigger icons toward one corner to unlock Boba Group Buy fast.'
        : '刚在工位热完身，太老实可不行！试着把大招往角落靠，轻松解锁下午茶拼单！'
    };
  }

  function getLocalDateKey() {
    var now = new Date();
    var y = now.getFullYear();
    var m = String(now.getMonth() + 1);
    var d = String(now.getDate());
    if (m.length < 2) m = '0' + m;
    if (d.length < 2) d = '0' + d;
    return y + m + d;
  }

  function createSeededRandom(seedInt) {
    var a = seedInt >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function pickNextLevel(rngFn, maxReached) {
    var maxSpawn = maxReached >= 5 ? 4 : (maxReached >= 3 ? 3 : 2);
    var weights = [30, 28, 22, 13, 7];
    var total = 0;
    for (var i = 0; i <= maxSpawn; i++) total += weights[i];
    var r = rngFn() * total;
    for (var j = 0; j <= maxSpawn; j++) {
      r -= weights[j];
      if (r <= 0) return j;
    }
    return 0;
  }

  global.SlackData = {
    STAGES: STAGES,
    MODES: MODES,
    pickText: pickText,
    getSalaryReward: getSalaryReward,
    getTitleByResult: getTitleByResult,
    getLocalDateKey: getLocalDateKey,
    createSeededRandom: createSeededRandom,
    pickNextLevel: pickNextLevel
  };
})(window);
