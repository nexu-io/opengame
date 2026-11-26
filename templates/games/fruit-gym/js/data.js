/* ==========================================================================
   data.js — Bilingual (ZH / EN) 6 Fruit Members, 4 Stations, 7 Campaign Days,
   Upgrades & Hand-Drawn Canvas Art Renderer
   ========================================================================== */
(function (global) {
  'use strict';

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function pickText(field, lang) {
    if (!field) return '';
    if (typeof field === 'string') return field;
    return field[lang] || field.zh || field.en || '';
  }

  /* 4 Equipment Stations arranged cleanly in 2x2 on the gym floor */
  var STATIONS = [
    { id: 'treadmill', name: { zh: '跑步机', en: 'Treadmill' }, color: '#6BBF4E', tint: '#E8F6E6', x: 202, y: 400, unlockedDefault: true },
    { id: 'dumbbell',  name: { zh: '哑铃区', en: 'Dumbbells' }, color: '#E85A4F', tint: '#FFE5E2', x: 558, y: 400, unlockedDefault: true },
    { id: 'yoga',      name: { zh: '瑜伽垫', en: 'Yoga Mat' },  color: '#FFD63B', tint: '#FFF7D6', x: 202, y: 680, unlockedDefault: true },
    { id: 'boxing',    name: { zh: '拳击袋', en: 'Boxing Bag' }, color: '#9D62EA', tint: '#EFE5FF', x: 558, y: 680, unlockedDefault: false }
  ];

  var STATION_MAP = {};
  for (var s = 0; s < STATIONS.length; s++) {
    STATION_MAP[STATIONS[s].id] = STATIONS[s];
  }

  /* 6 Expressive Hand-Drawn Fruit Members (Normal + Buff Transformed Forms) */
  var FRUITS = [
    {
      id: 'watermelon',
      name: { zh: '红发带小西瓜', en: 'Headband Melon' },
      buffName: { zh: '猛男肌肉西瓜', en: 'Buff Ripped Melon' },
      favStations: ['dumbbell', 'treadmill', 'boxing'],
      basePay: 42,
      workTime: 7.2,
      patience: 21,
      needPool: ['water', 'towel'],
      bio: {
        zh: '铁血撸铁狂魔，红发带一系谁也不爱',
        en: 'Hardcore lifter—once the red headband goes on, nothing stops the grind.'
      }
    },
    {
      id: 'lemon',
      name: { zh: '元气小柠檬', en: 'Zesty Lemon' },
      buffName: { zh: '发光维C柠檬', en: 'Radiant Vitamin-C' },
      favStations: ['yoga', 'treadmill'],
      basePay: 38,
      workTime: 6.2,
      patience: 20,
      needPool: ['water', 'towel'],
      bio: {
        zh: '拉伸小能手，练完酸爽发金光',
        en: 'Flexibility pro who glows pure gold after a crisp yoga stretch.'
      }
    },
    {
      id: 'strawberry',
      name: { zh: '傲娇小草莓', en: 'Sassy Berry' },
      buffName: { zh: '闪耀甜心草莓', en: 'Starlight Berry' },
      favStations: ['treadmill', 'yoga'],
      basePay: 45,
      workTime: 6.8,
      patience: 18,
      needPool: ['shake', 'water'],
      bio: {
        zh: '最爱边跑边喝冰蛋白奶昔，小费大方',
        en: 'Loves iced protein shakes mid-sprint and always leaves generous tips.'
      }
    },
    {
      id: 'avocado',
      name: { zh: '圆滚牛油果', en: 'Sleepy Avocado' },
      buffName: { zh: '八块腹肌牛油果', en: 'Six-Pack Avocado' },
      favStations: ['treadmill', 'yoga', 'dumbbell'],
      basePay: 54,
      workTime: 8.0,
      patience: 22,
      needPool: ['sleep', 'towel'],
      bio: {
        zh: '练到一半最爱偷懒打瞌睡，快拍醒它！',
        en: 'Tends to doze off mid-set—tap to wake it up for bonus combo tips!'
      }
    },
    {
      id: 'banana',
      name: { zh: '佛系大香蕉', en: 'Chill Banana' },
      buffName: { zh: '钢铁肌肉香蕉', en: 'Iron Muscle Banana' },
      favStations: ['boxing', 'dumbbell', 'yoga'],
      basePay: 60,
      workTime: 7.4,
      patience: 21,
      needPool: ['shake', 'towel', 'sleep'],
      bio: {
        zh: '出拳慢半拍但力道贼猛，热爱拳击袋',
        en: 'Laid-back vibe, heavyweight punch—obsessed with the boxing bag.'
      }
    },
    {
      id: 'pineapple',
      name: { zh: '墨镜大菠萝', en: 'VIP Pineapple' },
      buffName: { zh: '钻石VIP大菠萝', en: 'Diamond VIP Pine' },
      favStations: ['boxing', 'dumbbell', 'treadmill'],
      basePay: 110,
      workTime: 6.5,
      patience: 15,
      isVip: true,
      needPool: ['shake', 'towel'],
      bio: {
        zh: '神秘贵宾！耐心短但小费直接翻倍',
        en: 'VIP guest with short patience and massive double-payout tips!'
      }
    }
  ];

  var FRUIT_MAP = {};
  for (var f = 0; f < FRUITS.length; f++) {
    FRUIT_MAP[FRUITS[f].id] = FRUITS[f];
  }

  /* 7 Hand-Crafted Campaign Days (plus endless themed cycle Day 8+) */
  var DAYS = [
    {
      day: 1,
      title: { zh: '新店开业日', en: 'Grand Opening' },
      tagline: {
        zh: '小西瓜、小柠檬、小草莓首批报到，轻松练手！',
        en: 'Melon, Lemon & Berry arrive first—get the floor warmed up!'
      },
      tips: {
        zh: ['1. 点/拖水果入座', '2. 点气泡照料', '3. 收金币擦汗'],
        en: ['1. Seat Fruits', '2. Serve Bubbles', '3. Collect & Mop']
      },
      duration: 72,
      spawnInterval: 5.2,
      pool: ['watermelon', 'lemon', 'strawberry'],
      stars: [110, 175, 240],
      eventAt: 36,
      eventName: { zh: '开业小红花！全员小费 +20%', en: 'Opening Bonus! All Tips +20%' },
      eventKind: 'tipBoost'
    },
    {
      day: 2,
      title: { zh: '午休摸鱼潮', en: 'Lunch Rush' },
      tagline: {
        zh: '新学员「圆滚牛油果」来了！爱打瞌睡，记得点它拍醒！',
        en: 'Sleepy Avocado joins the club—tap its Zz bubble to wake it up!'
      },
      tips: {
        zh: ['新学员: 牛油果', '点 Zz 拍醒摸鱼', '午休双倍客潮'],
        en: ['New: Avocado', 'Tap Zz to Wake', 'Lunch Rush Wave']
      },
      duration: 75,
      spawnInterval: 4.5,
      pool: ['watermelon', 'lemon', 'strawberry', 'avocado', 'avocado'],
      stars: [180, 270, 360],
      eventAt: 35,
      eventName: { zh: '午休高峰潮！水果扎堆来报到', en: 'Lunch Hour Rush! Double Arrivals!' },
      eventKind: 'rush'
    },
    {
      day: 3,
      title: { zh: '暴汗拳击夜', en: 'Neon Boxing Night' },
      tagline: {
        zh: '新学员「佛系大香蕉」登场！推荐去商店解锁拳击袋～',
        en: 'Chill Banana steps in! Unlock the Boxing Bag in the Upgrade Shop.'
      },
      tips: {
        zh: ['新学员: 大香蕉', '推荐解锁拳击袋', '夜跑灯光加速'],
        en: ['New: Banana', 'Unlock Boxing', 'Night Speed +30%']
      },
      duration: 75,
      spawnInterval: 4.2,
      pool: ['watermelon', 'strawberry', 'avocado', 'banana', 'banana'],
      stars: [250, 370, 490],
      eventAt: 38,
      eventName: { zh: '夜跑灯光派对！全馆锻炼加速 +30%', en: 'Night Party Lights! Speed +30%!' },
      eventKind: 'speedBoost'
    },
    {
      day: 4,
      title: { zh: 'VIP 菠萝驾到', en: 'VIP Pineapple Day' },
      tagline: {
        zh: '墨镜大菠萝首次光临！耐心短但给钱超大方！',
        en: 'VIP Pineapple walks the red carpet—short patience, huge payout!'
      },
      tips: {
        zh: ['VIP 墨镜大菠萝', '耐心短小费翻倍', '优先安排上场'],
        en: ['VIP Pineapple', '2x Big Tips', 'Seat First!']
      },
      duration: 75,
      spawnInterval: 3.9,
      pool: ['watermelon', 'lemon', 'strawberry', 'avocado', 'banana', 'pineapple'],
      stars: [340, 490, 650],
      eventAt: 30,
      eventName: { zh: 'VIP 墨镜大菠萝包场驾到！', en: 'VIP Pineapple Grand Entrance!' },
      eventKind: 'vipVisit'
    },
    {
      day: 5,
      title: { zh: '暴汗大爆发', en: 'Sweat Storm' },
      tagline: {
        zh: '今天汗渍加倍但擦汗赏金 +10、小费 +35%！',
        en: 'Extra sweat puddles today—mopping pays +10 bonus and tips +35%!'
      },
      tips: {
        zh: ['暴汗擦拭 +10', '全员小费 +35%', '雇小柠檬超爽'],
        en: ['Mop Bonus +10', 'All Tips +35%', 'Hire Lemon Maid']
      },
      duration: 75,
      spawnInterval: 3.6,
      pool: ['watermelon', 'strawberry', 'avocado', 'banana', 'pineapple'],
      stars: [430, 620, 820],
      eventAt: 34,
      eventName: { zh: '暴汗狂欢！每单结算额外赏金', en: 'Sweat Fiesta! Extra Bonus Tips!' },
      eventKind: 'tipBoost'
    },
    {
      day: 6,
      title: { zh: '明星打卡日', en: 'Spotlight Tour' },
      tagline: {
        zh: '保持 Combo x3+ 触发闪光打卡，全单结账 +25%！',
        en: 'Hold Combo x3+ for flash spotlights and +25% checkout bonus!'
      },
      tips: {
        zh: ['Combo x3 闪光', '结账爆单 +25%', '雇助教保连击'],
        en: ['Combo x3 Flash', 'Payout +25%', 'Hire Coach']
      },
      duration: 75,
      spawnInterval: 3.3,
      pool: ['watermelon', 'lemon', 'strawberry', 'avocado', 'banana', 'pineapple'],
      stars: [520, 760, 1020],
      eventAt: 28,
      eventName: { zh: '打卡高峰潮！双波水果涌入！', en: 'Spotlight Rush! Double Crowd!' },
      eventKind: 'rush'
    },
    {
      day: 7,
      title: { zh: '水果奥运会', en: 'Fruit Olympics' },
      tagline: {
        zh: '6 大明星水果全员集结，冲击传奇奥运明星馆！',
        en: 'All 6 star fruits unite! Chase the Olympic Gold Gym stamp!'
      },
      tips: {
        zh: ['6大水果全员齐聚', 'VIP 双连降临', '冲击奥运金印'],
        en: ['All 6 Stars', 'Double VIPs', 'Olympic Gold']
      },
      duration: 78,
      spawnInterval: 3.0,
      pool: ['watermelon', 'lemon', 'strawberry', 'avocado', 'banana', 'pineapple', 'pineapple'],
      stars: [640, 920, 1240],
      eventAt: 26,
      eventName: { zh: '水果奥运开幕！VIP 双连降临！', en: 'Fruit Olympics! Double VIP Arrival!' },
      eventKind: 'olympicVip'
    }
  ];

  function getDayConfig(dayNum) {
    if (dayNum <= DAYS.length) return DAYS[dayNum - 1];
    var extra = dayNum - DAYS.length;
    var base = DAYS[(dayNum - 1) % DAYS.length];
    return {
      day: dayNum,
      title: { zh: '明星巡演 · 第' + dayNum + '天', en: 'All-Star Day ' + dayNum },
      tagline: {
        zh: '全明星水果齐聚一堂，冲击今日新高营收！',
        en: 'All-star fruit lineup—push your gym to a brand-new revenue record!'
      },
      tips: {
        zh: ['全明星无尽巡演', '连击冲刺新高', '刷新营收榜单'],
        en: ['Endless All-Stars', 'Combo Boost', 'Beat Best Day']
      },
      duration: 78,
      spawnInterval: Math.max(2.4, 3.0 - extra * 0.12),
      pool: ['watermelon', 'lemon', 'strawberry', 'avocado', 'banana', 'pineapple', 'pineapple'],
      stars: [
        Math.round(680 + extra * 140),
        Math.round(980 + extra * 190),
        Math.round(1320 + extra * 250)
      ],
      eventAt: 28,
      eventName: base.eventName,
      eventKind: base.eventKind
    };
  }

  /* 6 Meaningful Gym Upgrades */
  var UPGRADES = [
    {
      id: 'boxing',
      name: { zh: '解锁拳击沙袋区', en: 'Unlock Boxing Bag' },
      desc: {
        zh: '新增第 4 个器械位，迎接大香蕉与 VIP 菠萝',
        en: 'Add the 4th workout station for Banana & VIP Pineapple.'
      },
      maxLv: 1,
      costs: [150]
    },
    {
      id: 'gear',
      name: { zh: '全馆器械升级', en: 'Pro Gym Equipment' },
      desc: {
        zh: '锻炼速度 +22%，每单门票收益 +25%',
        en: 'Workout speed +22% and ticket payout +25% per level.'
      },
      maxLv: 3,
      costs: [120, 260, 440]
    },
    {
      id: 'bar',
      name: { zh: '蛋白奶昔能量吧', en: 'Protein Shake Bar' },
      desc: {
        zh: '照料小费大幅提升，打气钟充能更快',
        en: 'Bigger service tips and faster Fever Bell charge.'
      },
      maxLv: 2,
      costs: [140, 300]
    },
    {
      id: 'cleaner',
      name: { zh: '雇佣小柠檬保洁员', en: 'Hire Lemon Cleaner' },
      desc: {
        zh: '小柠檬满场跑，自动帮你擦干器械汗渍！',
        en: 'Zesty Lemon roams the floor and auto-mops sweat puddles!'
      },
      maxLv: 1,
      costs: [220]
    },
    {
      id: 'coach',
      name: { zh: '雇佣红发带西瓜助教', en: 'Hire Melon Coach' },
      desc: {
        zh: '西瓜助教自动拍醒偷懒水果并帮忙递水！',
        en: 'Melon Coach auto-wakes slackers and delivers supplies!'
      },
      maxLv: 1,
      costs: [280]
    },
    {
      id: 'vipSign',
      name: { zh: '明星霓虹招牌', en: 'VIP Neon Sign' },
      desc: {
        zh: '大幅吸引墨镜 VIP 大菠萝光临爆金币！',
        en: 'Attracts high-paying VIP Pineapples much more often!'
      },
      maxLv: 2,
      costs: [240, 460]
    }
  ];

  /* ---------- Hand-Drawn Canvas Fruit Renderer (Normal + Buff Form) ---------- */
  function drawFruitCharacter(ctx, fruitId, x, y, radius, opts) {
    opts = opts || {};
    var time = opts.time || 0;
    var buff = !!opts.buff;
    var sleepy = !!opts.sleepy;
    var working = !!opts.working;
    var angry = !!opts.angry;
    var walking = !!opts.walking;
    var carry = opts.carry || null;
    var isBoss = !!opts.isBoss;

    ctx.save();
    ctx.translate(x, y);

    if (walking) {
      var hop = Math.abs(Math.sin(time * 14)) * (radius * 0.24);
      var tilt = Math.sin(time * 14) * 0.09;
      ctx.translate(0, -hop);
      ctx.rotate(tilt);
    } else if (working && !sleepy) {
      var squash = Math.sin(time * 13) * 0.08;
      ctx.scale(1 + squash, 1 - squash);
    } else if (buff) {
      var bounce = Math.abs(Math.sin(time * 6)) * 5;
      ctx.translate(0, -bounce);
    }

    if (buff) {
      ctx.save();
      ctx.fillStyle = 'rgba(255, 214, 59, 0.34)';
      ctx.beginPath();
      ctx.arc(0, 0, radius * 1.38, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    ctx.fillStyle = 'rgba(59, 42, 26, 0.16)';
    ctx.beginPath();
    ctx.ellipse(0, radius * 0.96, radius * 0.78, radius * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#3B2A1A';
    ctx.lineWidth = Math.max(3, radius * 0.15);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (buff) {
      ctx.beginPath();
      ctx.moveTo(-radius * 0.85, 2);
      ctx.lineTo(-radius * 1.24, -6);
      ctx.lineTo(-radius * 1.12, -radius * 0.56);
      ctx.moveTo(radius * 0.85, 2);
      ctx.lineTo(radius * 1.24, -6);
      ctx.lineTo(radius * 1.12, -radius * 0.56);
      ctx.stroke();
    } else if (working && !sleepy) {
      var armY = Math.sin(time * 13) * radius * 0.35;
      ctx.beginPath();
      ctx.moveTo(-radius * 0.82, 4);
      ctx.lineTo(-radius * 1.16, -4 + armY);
      ctx.moveTo(radius * 0.82, 4);
      ctx.lineTo(radius * 1.16, -4 - armY);
      ctx.stroke();
    }

    ctx.lineWidth = Math.max(2.6, radius * 0.11);
    ctx.strokeStyle = '#3B2A1A';

    if (fruitId === 'watermelon') {
      ctx.fillStyle = '#6BBF4E';
      ctx.beginPath(); ctx.arc(0, 0, radius, 0, Math.PI * 2); ctx.fill();
      ctx.save();
      ctx.beginPath(); ctx.arc(0, 0, radius * 0.96, 0, Math.PI * 2); ctx.clip();
      ctx.strokeStyle = '#3D7D2B';
      ctx.lineWidth = Math.max(2.2, radius * 0.1);
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(-radius * 1.26, radius * 0.06, radius * 0.68, -0.68, 0.72); ctx.stroke();
      ctx.beginPath(); ctx.arc(radius * 1.26, radius * 0.06, radius * 0.68, Math.PI - 0.72, Math.PI + 0.68); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-radius * 0.18, -radius); ctx.lineTo(-radius * 0.1, -radius * 0.52);
      ctx.moveTo(radius * 0.18, -radius); ctx.lineTo(radius * 0.1, -radius * 0.52);
      ctx.stroke();
      ctx.restore();
      ctx.strokeStyle = '#3B2A1A';
      ctx.lineWidth = Math.max(2.6, radius * 0.11);
      ctx.beginPath(); ctx.arc(0, 0, radius, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#E85A4F'; ctx.strokeStyle = '#3B2A1A'; ctx.lineWidth = Math.max(2.2, radius * 0.09);
      roundRect(ctx, -radius * 0.94, -radius * 0.52, radius * 1.88, radius * 0.34, radius * 0.15);
      ctx.fill(); ctx.stroke();
    } else if (fruitId === 'lemon') {
      ctx.fillStyle = '#FFD63B';
      ctx.beginPath(); ctx.ellipse(0, 0, radius * 1.06, radius * 0.88, -0.1, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#6BBF4E';
      ctx.beginPath(); ctx.ellipse(radius * 0.25, -radius * 0.88, radius * 0.26, radius * 0.14, -0.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    } else if (fruitId === 'strawberry') {
      ctx.fillStyle = '#F25C6E';
      ctx.beginPath();
      ctx.moveTo(0, -radius * 0.9);
      ctx.bezierCurveTo(radius * 1.08, -radius * 0.85, radius * 1.0, radius * 0.35, 0, radius * 0.98);
      ctx.bezierCurveTo(-radius * 1.0, radius * 0.35, -radius * 1.08, -radius * 0.85, 0, -radius * 0.9);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#5BB84B';
      ctx.beginPath();
      ctx.moveTo(-radius * 0.52, -radius * 0.72);
      ctx.lineTo(0, -radius * 1.08);
      ctx.lineTo(radius * 0.52, -radius * 0.72);
      ctx.lineTo(0, -radius * 0.54);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
    } else if (fruitId === 'avocado') {
      ctx.fillStyle = '#538E3E';
      ctx.beginPath();
      ctx.ellipse(0, radius * 0.12, radius * 0.92, radius * 0.88, 0, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#D5E88A';
      ctx.beginPath();
      ctx.ellipse(0, radius * 0.12, radius * 0.72, radius * 0.7, 0, 0, Math.PI * 2);
      ctx.fill();
      if (buff) {
        ctx.strokeStyle = '#3B2A1A'; ctx.lineWidth = Math.max(1.8, radius * 0.06);
        roundRect(ctx, -radius * 0.26, radius * 0.24, radius * 0.52, radius * 0.42, 4);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, radius * 0.24); ctx.lineTo(0, radius * 0.66);
        ctx.moveTo(-radius * 0.26, radius * 0.38); ctx.lineTo(radius * 0.26, radius * 0.38);
        ctx.moveTo(-radius * 0.26, radius * 0.52); ctx.lineTo(radius * 0.26, radius * 0.52);
        ctx.stroke();
      } else {
        ctx.fillStyle = '#8C582B';
        ctx.beginPath(); ctx.arc(0, radius * 0.42, radius * 0.28, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
    } else if (fruitId === 'banana') {
      ctx.fillStyle = '#FFE047';
      ctx.beginPath();
      ctx.ellipse(0, 0, radius * 0.72, radius * 1.02, 0.22, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#6E4A28';
      ctx.beginPath(); ctx.arc(radius * 0.2, -radius * 0.95, radius * 0.14, 0, Math.PI * 2); ctx.fill();
    } else if (fruitId === 'pineapple') {
      ctx.fillStyle = '#43A84C';
      ctx.beginPath();
      ctx.moveTo(-radius * 0.5, -radius * 0.68);
      ctx.lineTo(-radius * 0.34, -radius * 1.24);
      ctx.lineTo(-radius * 0.06, -radius * 0.9);
      ctx.lineTo(0, -radius * 1.32);
      ctx.lineTo(radius * 0.12, -radius * 0.9);
      ctx.lineTo(radius * 0.42, -radius * 1.22);
      ctx.lineTo(radius * 0.5, -radius * 0.68);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#FFB92E';
      ctx.beginPath(); ctx.ellipse(0, radius * 0.06, radius * 0.88, radius * 0.92, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = 'rgba(138, 80, 18, 0.35)'; ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(-radius * 0.5, -radius * 0.3); ctx.lineTo(radius * 0.5, radius * 0.55);
      ctx.moveTo(radius * 0.5, -radius * 0.3); ctx.lineTo(-radius * 0.5, radius * 0.55);
      ctx.stroke();
    }

    var eyeY = fruitId === 'avocado' ? -radius * 0.28 : 0;
    ctx.strokeStyle = '#3B2A1A';
    ctx.fillStyle = '#3B2A1A';

    if (fruitId === 'pineapple') {
      roundRect(ctx, -radius * 0.62, eyeY - radius * 0.16, radius * 0.52, radius * 0.3, 5);
      ctx.fill();
      roundRect(ctx, radius * 0.1, eyeY - radius * 0.16, radius * 0.52, radius * 0.3, 5);
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(-radius * 0.1, eyeY); ctx.lineTo(radius * 0.1, eyeY); ctx.stroke();
    } else if (sleepy) {
      ctx.lineWidth = Math.max(2.2, radius * 0.09);
      ctx.beginPath();
      ctx.moveTo(-radius * 0.42, eyeY); ctx.lineTo(-radius * 0.16, eyeY);
      ctx.moveTo(radius * 0.16, eyeY); ctx.lineTo(radius * 0.42, eyeY);
      ctx.stroke();
    } else if (angry) {
      ctx.beginPath();
      ctx.arc(-radius * 0.28, eyeY + 2, radius * 0.1, 0, Math.PI * 2);
      ctx.arc(radius * 0.28, eyeY + 2, radius * 0.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = Math.max(2.2, radius * 0.09);
      ctx.beginPath();
      ctx.moveTo(-radius * 0.44, eyeY - 6); ctx.lineTo(-radius * 0.14, eyeY - 1);
      ctx.moveTo(radius * 0.44, eyeY - 6); ctx.lineTo(radius * 0.14, eyeY - 1);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(-radius * 0.28, eyeY, radius * 0.1, 0, Math.PI * 2);
      ctx.arc(radius * 0.28, eyeY, radius * 0.1, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = 'rgba(244, 138, 130, 0.65)';
    ctx.beginPath();
    ctx.ellipse(-radius * 0.48, eyeY + radius * 0.18, radius * 0.14, radius * 0.08, 0, 0, Math.PI * 2);
    ctx.ellipse(radius * 0.48, eyeY + radius * 0.18, radius * 0.14, radius * 0.08, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#3B2A1A';
    ctx.lineWidth = Math.max(2.2, radius * 0.085);
    ctx.beginPath();
    if (sleepy) {
      ctx.arc(0, eyeY + radius * 0.22, radius * 0.1, 0, Math.PI * 2);
    } else if (angry) {
      ctx.arc(0, eyeY + radius * 0.34, radius * 0.18, Math.PI + 0.35, -0.35);
    } else if (buff) {
      ctx.arc(0, eyeY + radius * 0.14, radius * 0.24, 0.1, Math.PI - 0.1);
    } else {
      ctx.arc(0, eyeY + radius * 0.16, radius * 0.16, 0.15, Math.PI - 0.15);
    }
    ctx.stroke();

    if (working && !sleepy) {
      var swY = -radius * 0.45 + ((time * 40) % 18);
      ctx.fillStyle = '#6CE2FF';
      ctx.strokeStyle = '#3B2A1A';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(radius * 0.72, swY, radius * 0.14, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
    }

    if (isBoss) {
      ctx.strokeStyle = '#3B2A1A';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(-radius * 0.35, radius * 0.56);
      ctx.quadraticCurveTo(0, radius * 0.86, radius * 0.35, radius * 0.56);
      ctx.stroke();
      ctx.fillStyle = '#FFD63B';
      roundRect(ctx, -radius * 0.16, radius * 0.68, radius * 0.32, radius * 0.22, 4);
      ctx.fill(); ctx.stroke();
    }

    if (carry) {
      ctx.save();
      ctx.translate(radius * 0.96, -radius * 0.12);
      if (carry === 'mop') {
        ctx.strokeStyle = '#8C582B'; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(0, -radius * 0.75); ctx.lineTo(0, radius * 0.55); ctx.stroke();
        ctx.fillStyle = '#56D8FF'; ctx.strokeStyle = '#3B2A1A'; ctx.lineWidth = 2.2;
        roundRect(ctx, -radius * 0.34, radius * 0.36, radius * 0.68, radius * 0.28, 6);
        ctx.fill(); ctx.stroke();
      } else {
        drawNeedIcon(ctx, carry, 0, 0, radius * 0.42);
      }
      ctx.restore();
    }

    ctx.restore();
  }

  function drawNeedIcon(ctx, needType, cx, cy, r) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = '#3B2A1A';
    ctx.lineWidth = 2.6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (needType === 'water') {
      ctx.fillStyle = '#56D8FF';
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.78);
      ctx.bezierCurveTo(r * 0.7, -r * 0.05, r * 0.7, r * 0.78, 0, r * 0.78);
      ctx.bezierCurveTo(-r * 0.7, r * 0.78, -r * 0.7, -r * 0.05, 0, -r * 0.78);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
    } else if (needType === 'towel') {
      ctx.fillStyle = '#FFD63B';
      roundRect(ctx, -r * 0.72, -r * 0.52, r * 1.44, r * 1.04, 6);
      ctx.fill(); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-r * 0.4, -r * 0.12); ctx.lineTo(r * 0.4, -r * 0.12);
      ctx.moveTo(-r * 0.4, r * 0.22); ctx.lineTo(r * 0.4, r * 0.22);
      ctx.stroke();
    } else if (needType === 'shake') {
      ctx.fillStyle = '#FF9BB2';
      roundRect(ctx, -r * 0.46, -r * 0.34, r * 0.92, r * 1.06, 6);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#FFFDF7';
      roundRect(ctx, -r * 0.58, -r * 0.52, r * 1.16, r * 0.26, 5);
      ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(r * 0.15, -r * 0.52); ctx.lineTo(r * 0.34, -r * 0.9); ctx.stroke();
    } else if (needType === 'sleep') {
      ctx.fillStyle = '#3B2A1A';
      ctx.font = '900 ' + Math.round(r * 1.15) + 'px Menlo, Monaco, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Zz', 0, 2);
    } else if (needType === 'treadmill') {
      ctx.fillStyle = '#6BBF4E';
      roundRect(ctx, -r * 0.75, r * 0.15, r * 1.5, r * 0.44, 5);
      ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(r * 0.42, r * 0.15); ctx.lineTo(r * 0.62, -r * 0.65); ctx.lineTo(r * 0.2, -r * 0.65); ctx.stroke();
    } else if (needType === 'dumbbell') {
      ctx.fillStyle = '#E85A4F';
      roundRect(ctx, -r * 0.82, -r * 0.46, r * 0.36, r * 0.92, 4); ctx.fill(); ctx.stroke();
      roundRect(ctx, r * 0.46, -r * 0.46, r * 0.36, r * 0.92, 4); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-r * 0.46, 0); ctx.lineTo(r * 0.46, 0); ctx.stroke();
    } else if (needType === 'yoga') {
      ctx.fillStyle = '#FFD63B';
      roundRect(ctx, -r * 0.82, -r * 0.32, r * 1.64, r * 0.64, 8); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#FFFDF7';
      ctx.beginPath(); ctx.arc(-r * 0.55, 0, r * 0.24, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    } else if (needType === 'boxing') {
      ctx.fillStyle = '#9D62EA';
      roundRect(ctx, -r * 0.42, -r * 0.48, r * 0.84, r * 1.12, 10); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, -r * 0.82); ctx.lineTo(0, -r * 0.48); ctx.stroke();
    }

    ctx.restore();
  }

  global.FruitGymData = {
    STATIONS: STATIONS,
    STATION_MAP: STATION_MAP,
    FRUITS: FRUITS,
    FRUIT_MAP: FRUIT_MAP,
    DAYS: DAYS,
    UPGRADES: UPGRADES,
    pickText: pickText,
    getDayConfig: getDayConfig,
    drawFruitCharacter: drawFruitCharacter,
    drawNeedIcon: drawNeedIcon,
    roundRect: roundRect
  };
})(window);
