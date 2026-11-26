/* ==========================================================================
   slack-art.js — Hand-Drawn 11-Stage Icons & Bilingual 3:4 Badge Card Canvas
   ========================================================================== */
(function (global) {
  'use strict';

  var INK = '#3B2A1A';

  function roundRectPath(ctx, x, y, w, h, r) {
    var rad = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.lineTo(x + w - rad, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
    ctx.lineTo(x + w, y + h - rad);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
    ctx.lineTo(x + rad, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
    ctx.lineTo(x, y + rad);
    ctx.quadraticCurveTo(x, y, x + rad, y);
    ctx.closePath();
  }

  /* Hand-drawn 11-stage office slacking orbs with espresso ink outlines */
  function drawStage(ctx, level, x, y, r, angle, scale) {
    var stages = global.SlackData.STAGES;
    var st = stages[level] || stages[0];
    var sc = scale || 1;
    var lw = Math.max(2, Math.min(3.5, r * 0.092));

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle || 0);
    ctx.scale(sc, sc);

    /* Main orb */
    ctx.beginPath();
    ctx.arc(0, 0, r - lw * 0.5, 0, Math.PI * 2);
    ctx.fillStyle = st.color;
    ctx.fill();

    /* Clipped interior details */
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, r - lw, 0, Math.PI * 2);
    ctx.clip();

    if (level === 0) {
      ctx.fillStyle = '#5EB6DE';
      ctx.beginPath();
      ctx.moveTo(-r, r * 0.25);
      ctx.quadraticCurveTo(-r * 0.35, r * 0.08, 0, r * 0.25);
      ctx.quadraticCurveTo(r * 0.35, r * 0.42, r, r * 0.22);
      ctx.lineTo(r, r);
      ctx.lineTo(-r, r);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#E3F6FE';
      ctx.beginPath();
      ctx.arc(-r * 0.34, -r * 0.38, r * 0.16, 0, Math.PI * 2);
      ctx.fill();
    } else if (level === 1) {
      ctx.fillStyle = '#EFEAFF';
      ctx.beginPath();
      ctx.arc(-r * 0.3, -r * 0.52, r * 0.36, 0, Math.PI * 2);
      ctx.arc(r * 0.2, -r * 0.56, r * 0.32, 0, Math.PI * 2);
      ctx.fill();
    } else if (level === 2) {
      ctx.fillStyle = '#FFFDF7';
      ctx.strokeStyle = INK;
      ctx.lineWidth = Math.max(1.5, lw * 0.7);
      roundRectPath(ctx, -r * 0.56, -r * 0.68, r * 1.12, r * 0.42, r * 0.14);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = INK;
      ctx.textAlign = 'center';
      ctx.font = '900 ' + Math.max(8, Math.round(r * 0.28)) + 'px "Menlo", monospace';
      ctx.fillText('TAB', 0, -r * 0.38);
    } else if (level === 3) {
      ctx.fillStyle = '#FFF7D6';
      ctx.beginPath();
      ctx.ellipse(0, -r * 0.72, r * 0.78, r * 0.28, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = INK;
      ctx.lineWidth = Math.max(1.5, lw * 0.65);
      ctx.beginPath();
      ctx.moveTo(r * 0.46, -r * 0.86);
      ctx.lineTo(r * 0.54, -r * 0.38);
      ctx.stroke();
      ctx.fillStyle = '#E85A4F';
      roundRectPath(ctx, r * 0.36, -r * 0.44, r * 0.34, r * 0.26, 3);
      ctx.fill();
      ctx.stroke();
    } else if (level === 4) {
      ctx.strokeStyle = '#FFFDF7';
      ctx.lineWidth = Math.max(2, r * 0.08);
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(0, -r * 0.26, r * 0.42, Math.PI * 1.22, Math.PI * 1.78); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, -r * 0.26, r * 0.26, Math.PI * 1.24, Math.PI * 1.76); ctx.stroke();
      ctx.fillStyle = '#FFFDF7';
      ctx.beginPath(); ctx.arc(0, -r * 0.34, Math.max(2, r * 0.075), 0, Math.PI * 2); ctx.fill();
    } else if (level === 5) {
      ctx.fillStyle = '#FFFDF7';
      ctx.fillRect(-r, -r * 0.52, r * 2, r * 0.24);
      ctx.strokeStyle = INK;
      ctx.lineWidth = lw * 0.75;
      ctx.beginPath();
      ctx.moveTo(-r, -r * 0.52); ctx.lineTo(r, -r * 0.52);
      ctx.moveTo(-r, -r * 0.28); ctx.lineTo(r, -r * 0.28);
      ctx.stroke();
      ctx.fillStyle = '#6BBF4E';
      ctx.fillRect(-r * 0.16, -r * 0.52, r * 0.32, r * 0.24);
    } else if (level === 6) {
      ctx.fillStyle = '#FFFDF7';
      ctx.beginPath();
      ctx.ellipse(0, -r * 0.72, r * 0.88, r * 0.3, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#E85A4F';
      ctx.strokeStyle = INK;
      ctx.lineWidth = lw * 0.7;
      ctx.save();
      ctx.rotate(0.22);
      ctx.fillRect(-r * 0.08, -r * 1.02, r * 0.16, r * 0.5);
      ctx.strokeRect(-r * 0.08, -r * 1.02, r * 0.16, r * 0.5);
      ctx.restore();
      ctx.fillStyle = '#4B3221';
      var pearls = [[-0.44, 0.56], [-0.18, 0.68], [0.1, 0.64], [0.38, 0.58], [0.02, 0.48]];
      for (var p = 0; p < pearls.length; p++) {
        ctx.beginPath();
        ctx.arc(pearls[p][0] * r, pearls[p][1] * r, Math.max(2.5, r * 0.095), 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (level === 7) {
      ctx.strokeStyle = 'rgba(255,253,247,0.45)';
      ctx.lineWidth = 1.8;
      for (var gx = -r * 0.6; gx <= r * 0.6; gx += r * 0.4) {
        ctx.beginPath(); ctx.moveTo(gx, -r); ctx.lineTo(gx, r); ctx.stroke();
      }
      for (var gy = -r * 0.4; gy <= r * 0.6; gy += r * 0.4) {
        ctx.beginPath(); ctx.moveTo(-r, gy); ctx.lineTo(r, gy); ctx.stroke();
      }
      ctx.fillStyle = '#2E8B57';
      ctx.fillRect(-r, -r * 0.96, r * 2, r * 0.42);
      ctx.fillStyle = '#FFFDF7';
      ctx.textAlign = 'center';
      ctx.font = '900 ' + Math.round(r * 0.24) + 'px "Menlo", monospace';
      ctx.fillText('OKR', 0, -r * 0.6);
    } else if (level === 8) {
      ctx.strokeStyle = INK;
      ctx.lineWidth = Math.max(4, r * 0.11);
      ctx.beginPath();
      ctx.arc(0, -r * 0.04, r * 0.78, Math.PI * 1.12, Math.PI * 1.88);
      ctx.stroke();
      ctx.fillStyle = '#E85A4F';
      ctx.strokeStyle = INK;
      ctx.lineWidth = lw * 0.75;
      ctx.beginPath();
      ctx.arc(0, -r * 0.56, r * 0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = '#FFFDF7';
      ctx.lineWidth = Math.max(2, r * 0.05);
      ctx.beginPath();
      ctx.moveTo(-r * 0.1, -r * 0.66);
      ctx.lineTo(r * 0.1, -r * 0.46);
      ctx.stroke();
    } else if (level === 9) {
      ctx.fillStyle = '#FFE4B3';
      ctx.beginPath();
      ctx.arc(0, r * 0.15, r * 0.78, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#3B2A1A';
      roundRectPath(ctx, -r * 0.52, -r * 0.66, r * 1.04, r * 0.34, r * 0.14);
      ctx.fill();
      ctx.fillStyle = '#FFD63B';
      ctx.textAlign = 'center';
      ctx.font = '900 ' + Math.round(r * 0.24) + 'px "Menlo", monospace';
      ctx.fillText('18:00', 0, -r * 0.4);
    } else if (level === 10) {
      ctx.strokeStyle = '#3D7D2B';
      ctx.lineWidth = Math.max(4, r * 0.085);
      var stripes = [-0.54, -0.22, 0.22, 0.54];
      for (var s = 0; s < stripes.length; s++) {
        ctx.beginPath();
        ctx.moveTo(stripes[s] * r, -r);
        ctx.quadraticCurveTo(stripes[s] * r * 1.22, 0, stripes[s] * r, r);
        ctx.stroke();
      }
      ctx.fillStyle = '#FFD63B';
      ctx.strokeStyle = INK;
      ctx.lineWidth = lw * 0.75;
      ctx.beginPath();
      ctx.moveTo(-r * 0.44, -r * 0.46);
      ctx.lineTo(-r * 0.34, -r * 0.8);
      ctx.lineTo(-r * 0.12, -r * 0.62);
      ctx.lineTo(0, -r * 0.86);
      ctx.lineTo(r * 0.12, -r * 0.62);
      ctx.lineTo(r * 0.34, -r * 0.8);
      ctx.lineTo(r * 0.44, -r * 0.46);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#E85A4F';
      ctx.fillRect(-r, -r * 0.46, r * 2, r * 0.2);
      ctx.beginPath();
      ctx.moveTo(-r, -r * 0.46); ctx.lineTo(r, -r * 0.46);
      ctx.moveTo(-r, -r * 0.26); ctx.lineTo(r, -r * 0.26);
      ctx.stroke();
    }
    ctx.restore();

    /* Outer ink border */
    ctx.beginPath();
    ctx.arc(0, 0, r - lw * 0.5, 0, Math.PI * 2);
    ctx.strokeStyle = INK;
    ctx.lineWidth = lw;
    ctx.stroke();

    /* Facial expression */
    var faceY = (level === 2 || level === 5 || level === 7 || level === 9 || level === 10) ? r * 0.12 : r * 0.06;
    var eyeDx = r * 0.28;
    var eyeR = Math.max(1.8, r * 0.09);

    if (level === 10) {
      ctx.fillStyle = '#2B1F14';
      ctx.strokeStyle = INK;
      ctx.lineWidth = Math.max(2, r * 0.045);
      roundRectPath(ctx, -r * 0.56, faceY - r * 0.16, r * 0.48, r * 0.28, r * 0.08);
      ctx.fill(); ctx.stroke();
      roundRectPath(ctx, r * 0.08, faceY - r * 0.16, r * 0.48, r * 0.28, r * 0.08);
      ctx.fill(); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-r * 0.08, faceY - r * 0.04);
      ctx.lineTo(r * 0.08, faceY - r * 0.04);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,253,247,0.7)';
      ctx.lineWidth = Math.max(2, r * 0.04);
      ctx.beginPath();
      ctx.moveTo(-r * 0.42, faceY - r * 0.1); ctx.lineTo(-r * 0.3, faceY + r * 0.05);
      ctx.moveTo(r * 0.22, faceY - r * 0.1); ctx.lineTo(r * 0.34, faceY + r * 0.05);
      ctx.stroke();
    } else if (level === 7) {
      ctx.fillStyle = '#FFFDF7';
      ctx.strokeStyle = INK;
      ctx.lineWidth = Math.max(2, r * 0.055);
      ctx.beginPath(); ctx.arc(-eyeDx, faceY, r * 0.19, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(eyeDx, faceY, r * 0.19, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-eyeDx + r * 0.19, faceY); ctx.lineTo(eyeDx - r * 0.19, faceY); ctx.stroke();
      ctx.fillStyle = INK;
      ctx.beginPath(); ctx.arc(-eyeDx, faceY, eyeR * 0.72, 0, Math.PI * 2); ctx.arc(eyeDx, faceY, eyeR * 0.72, 0, Math.PI * 2); ctx.fill();
    } else if (level === 1) {
      ctx.strokeStyle = INK;
      ctx.lineWidth = Math.max(1.8, r * 0.07);
      ctx.beginPath(); ctx.arc(-eyeDx, faceY, eyeR * 1.25, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(eyeDx, faceY, eyeR * 1.25, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = INK;
      ctx.beginPath(); ctx.arc(-eyeDx, faceY, eyeR * 0.45, 0, Math.PI * 2); ctx.arc(eyeDx, faceY, eyeR * 0.45, 0, Math.PI * 2); ctx.fill();
    } else if (level === 3 || level === 4) {
      ctx.strokeStyle = INK;
      ctx.lineWidth = Math.max(2, r * 0.075);
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(-eyeDx, faceY, eyeR * 1.15, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
      ctx.beginPath(); ctx.arc(eyeDx, faceY, eyeR * 1.15, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
    } else if (level === 8) {
      ctx.strokeStyle = INK;
      ctx.lineWidth = Math.max(2.2, r * 0.07);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-eyeDx - eyeR * 1.2, faceY); ctx.lineTo(-eyeDx + eyeR * 1.2, faceY);
      ctx.moveTo(eyeDx - eyeR * 1.2, faceY); ctx.lineTo(eyeDx + eyeR * 1.2, faceY);
      ctx.stroke();
    } else {
      ctx.fillStyle = INK;
      ctx.beginPath();
      ctx.arc(-eyeDx, faceY, eyeR, 0, Math.PI * 2);
      ctx.arc(eyeDx, faceY, eyeR, 0, Math.PI * 2);
      ctx.fill();
      if (r >= 24) {
        ctx.fillStyle = '#FFFDF7';
        ctx.beginPath();
        ctx.arc(-eyeDx - eyeR * 0.3, faceY - eyeR * 0.3, eyeR * 0.35, 0, Math.PI * 2);
        ctx.arc(eyeDx - eyeR * 0.3, faceY - eyeR * 0.3, eyeR * 0.35, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    /* Rosy cheeks */
    if (r >= 20) {
      ctx.fillStyle = 'rgba(244, 138, 130, 0.72)';
      ctx.beginPath();
      ctx.ellipse(-eyeDx - r * 0.14, faceY + r * 0.15, r * 0.12, r * 0.07, 0, 0, Math.PI * 2);
      ctx.ellipse(eyeDx + r * 0.14, faceY + r * 0.15, r * 0.12, r * 0.07, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    /* Mouth */
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(1.8, r * 0.068);
    ctx.lineCap = 'round';
    ctx.beginPath();
    if (level === 1) {
      ctx.moveTo(-r * 0.1, faceY + r * 0.16);
      ctx.lineTo(r * 0.1, faceY + r * 0.16);
      ctx.stroke();
    } else if (level >= 9) {
      ctx.fillStyle = '#E85A4F';
      ctx.arc(0, faceY + r * 0.15, r * 0.16, 0, Math.PI);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.arc(0, faceY + r * 0.12, r * 0.14, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.stroke();
    }

    /* Sweat drop on stretch / clockout */
    if (level === 5 || level === 9) {
      ctx.fillStyle = '#89D4F5';
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1.6;
      var sx = r * 0.56;
      var sy = faceY - r * 0.1;
      ctx.beginPath();
      ctx.moveTo(sx, sy - r * 0.12);
      ctx.quadraticCurveTo(sx + r * 0.1, sy + r * 0.04, sx, sy + r * 0.08);
      ctx.quadraticCurveTo(sx - r * 0.1, sy + r * 0.04, sx, sy - r * 0.12);
      ctx.fill();
      ctx.stroke();
    }

    ctx.restore();
  }

  function wrapLines(ctx, text, maxW, maxLines) {
    var lines = [];
    var words = text.indexOf(' ') >= 0 ? text.split(' ') : text.split('');
    var sep = text.indexOf(' ') >= 0 ? ' ' : '';
    var cur = '';
    for (var i = 0; i < words.length; i++) {
      var test = cur ? (cur + sep + words[i]) : words[i];
      if (ctx.measureText(test).width > maxW && cur) {
        lines.push(cur);
        cur = words[i];
        if (lines.length >= maxLines - 1) break;
      } else {
        cur = test;
      }
    }
    if (cur && lines.length < maxLines) lines.push(cur);
    return lines;
  }

  /* Render 900x1200 (3:4) Retro Desk Badge Card onto a given canvas */
  function renderResultPoster(targetCanvas, opts) {
    var canvas = targetCanvas || document.createElement('canvas');
    canvas.width = 900;
    canvas.height = 1200;
    var ctx = canvas.getContext('2d');
    var Data = global.SlackData;

    var lang = opts.lang === 'en' ? 'en' : 'zh';
    var en = lang === 'en';
    var score = Number(opts.score) || 0;
    var bestScore = Number(opts.bestScore) || score;
    var maxLevel = Number(opts.maxLevel) || 0;
    var maxCombo = Number(opts.maxCombo) || 1;
    var kingCount = Number(opts.kingCount) || 0;
    var bossDodges = Number(opts.bossDodges) || 0;
    var modeLabel = opts.modeLabel || (en ? 'Classic' : '日常摸鱼');
    var titleInfo = opts.titleInfo || Data.getTitleByResult(score, maxLevel, kingCount, lang);
    var salaryReward = Data.getSalaryReward(score, lang);
    var topStage = Data.STAGES[maxLevel] || Data.STAGES[0];
    var topStageName = Data.pickText(topStage.name, lang);

    /* Dot-grid desk background */
    ctx.fillStyle = '#F3ECE0';
    ctx.fillRect(0, 0, 900, 1200);
    ctx.fillStyle = '#DFD4C0';
    for (var gx = 24; gx < 900; gx += 30) {
      for (var gy = 24; gy < 1200; gy += 30) {
        ctx.beginPath();
        ctx.arc(gx, gy, 2.3, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    /* Main retro badge card */
    var cx = 68;
    var cy = 54;
    var cw = 764;
    var ch = 1084;
    ctx.fillStyle = INK;
    roundRectPath(ctx, cx, cy + 16, cw, ch, 40);
    ctx.fill();
    ctx.fillStyle = '#EAE1CE';
    ctx.strokeStyle = INK;
    ctx.lineWidth = 6;
    roundRectPath(ctx, cx, cy, cw, ch, 40);
    ctx.fill();
    ctx.stroke();

    /* Badge lanyard slot */
    ctx.fillStyle = '#F3ECE0';
    ctx.lineWidth = 4;
    roundRectPath(ctx, 390, cy + 24, 120, 22, 11);
    ctx.fill();
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.fillStyle = '#786653';
    ctx.font = '900 19px "Menlo", "Courier New", monospace';
    ctx.fillText((en ? 'SLACKING EVOLUTION · ' : 'DESK ARCADE · ') + modeLabel.toUpperCase(), 450, cy + 78);

    /* Yellow title capsule */
    ctx.fillStyle = '#FFD63B';
    ctx.lineWidth = 4;
    roundRectPath(ctx, 146, cy + 96, 608, 72, 36);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = INK;
    ctx.font = en ? '900 34px -apple-system, BlinkMacSystemFont, sans-serif' : '900 38px "PingFang SC", sans-serif';
    ctx.fillText(en ? 'Slacking Evolution · Badge' : '打工人摸鱼进化链 · 鉴定卡', 450, cy + 145);

    /* Paper card interior */
    ctx.fillStyle = '#FFFDF7';
    ctx.lineWidth = 5;
    roundRectPath(ctx, cx + 38, cy + 190, cw - 76, 548, 28);
    ctx.fill();
    ctx.stroke();

    /* Center hero orb */
    ctx.fillStyle = '#FFF5CC';
    ctx.beginPath();
    ctx.arc(450, cy + 356, 126, 0, Math.PI * 2);
    ctx.fill();
    drawStage(ctx, maxLevel, 450, cy + 356, 100, -0.05, 1);

    /* Top-right tilted rank stamp */
    ctx.save();
    ctx.translate(cx + cw - 154, cy + 258);
    ctx.rotate(-0.12);
    ctx.fillStyle = 'rgba(255,253,247,0.96)';
    ctx.strokeStyle = titleInfo.color;
    ctx.lineWidth = 4.5;
    roundRectPath(ctx, -110, -32, 220, 64, 12);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = titleInfo.color;
    ctx.font = en ? '900 21px -apple-system, BlinkMacSystemFont, sans-serif' : '900 24px "PingFang SC", sans-serif';
    ctx.fillText(titleInfo.badge, 0, 8);
    ctx.restore();

    /* Best unlocked stage & score */
    ctx.fillStyle = '#786653';
    ctx.font = '800 22px -apple-system, "PingFang SC", sans-serif';
    ctx.fillText((en ? 'Top Evolution: ' : '最高解锁：') + topStageName, 450, cy + 518);

    ctx.fillStyle = '#E85A4F';
    ctx.font = '900 86px "Menlo", "Courier New", monospace';
    ctx.fillText(String(score), 450, cy + 610);

    /* Green earned-back pill */
    ctx.fillStyle = '#E8F6E6';
    ctx.strokeStyle = '#2E8B57';
    ctx.lineWidth = 3.5;
    roundRectPath(ctx, 178, cy + 644, 544, 54, 27);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#2E8B57';
    ctx.font = en ? '900 21px -apple-system, sans-serif' : '900 23px "PingFang SC", sans-serif';
    ctx.fillText((en ? 'Earned Back: ' : '带薪摸鱼已赚回：') + salaryReward, 450, cy + 679);

    /* 3 KPI cards */
    var statY = cy + 760;
    var statW = (cw - 76 - 28) / 3;
    var thirdStat = bossDodges > 0
      ? { lbl: en ? 'Boss Dodges' : '成功躲过老板', val: en ? (bossDodges + 'x') : (bossDodges + ' 次'), bg: '#E8F6E6' }
      : { lbl: en ? 'Chill Kings' : '合出躺平大王', val: String(kingCount), bg: '#E8F6E6' };
    var stats = [
      { lbl: en ? 'Best Score' : '历史最高分', val: String(bestScore), bg: '#FFF7D6' },
      { lbl: en ? 'Max Combo' : '最高连续摸鱼', val: en ? ('x' + maxCombo) : (maxCombo + ' 连摸'), bg: '#FFE5E2' },
      thirdStat
    ];
    for (var i = 0; i < stats.length; i++) {
      var sx = cx + 38 + i * (statW + 14);
      ctx.fillStyle = stats[i].bg;
      ctx.strokeStyle = INK;
      ctx.lineWidth = 3.5;
      roundRectPath(ctx, sx, statY, statW, 110, 18);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#786653';
      ctx.font = '700 18px -apple-system, "PingFang SC", sans-serif';
      ctx.fillText(stats[i].lbl, sx + statW / 2, statY + 36);
      ctx.fillStyle = INK;
      ctx.font = '900 30px "Menlo", "PingFang SC", sans-serif';
      ctx.fillText(stats[i].val, sx + statW / 2, statY + 82);
    }

    /* Review note box */
    var tipY = statY + 130;
    ctx.fillStyle = '#FFFDF7';
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3.5;
    roundRectPath(ctx, cx + 38, tipY, cw - 76, 94, 18);
    ctx.fill();
    ctx.stroke();
    ctx.textAlign = 'left';
    ctx.fillStyle = INK;
    ctx.font = en ? '800 20px -apple-system, sans-serif' : '800 22px "PingFang SC", sans-serif';
    var lines = wrapLines(ctx, titleInfo.tip || '', cw - 120, 2);
    if (lines.length === 1) {
      ctx.fillText(lines[0], cx + 60, tipY + 55);
    } else {
      ctx.fillText(lines[0] || '', cx + 60, tipY + 38);
      ctx.fillText(lines[1] || '', cx + 60, tipY + 72);
    }

    /* Clean game footer */
    ctx.fillStyle = '#786653';
    ctx.font = '800 18px "Menlo", "PingFang SC", monospace';
    ctx.textAlign = 'left';
    ctx.fillText(en ? 'SLACKING EVOLUTION · DESK ARCADE' : '打工人摸鱼进化链 · 复古工位掌机', cx + 44, cy + ch - 35);
    ctx.textAlign = 'right';
    ctx.fillText('11-STAGE MERGE', cx + cw - 44, cy + ch - 35);

    return canvas.toDataURL('image/png');
  }

  global.SlackArt = {
    drawStage: drawStage,
    renderResultPoster: renderResultPoster
  };
})(window);
