/* ==========================================================================
   poster.js — Bilingual 3:4 (900x1200) Vintage Fruit Gym Daily Receipt Poster
   ========================================================================== */
(function (global) {
  'use strict';

  function renderPoster(canvas, report) {
    if (!canvas || !canvas.getContext) return;
    var ctx = canvas.getContext('2d');
    var D = global.FruitGymData;
    var W = 900, H = 1200;
    canvas.width = W;
    canvas.height = H;

    var en = report.lang === 'en';
    var cur = en ? '$' : '¥';
    var day = report.day || 1;
    var dayTitle = report.dayTitle || (en ? 'Grand Opening' : '新店开业日');
    var earned = report.earned || 0;
    var served = report.served || 0;
    var maxCombo = report.maxCombo || 0;
    var stars = report.stars || 1;
    var bestDayRev = report.bestDayRev || earned;
    var unlocked = report.unlocked || 0;

    /* Warm dot-grid desk background */
    ctx.fillStyle = '#F3ECE0';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#DFD4C0';
    for (var gx = 20; gx < W; gx += 28) {
      for (var gy = 20; gy < H; gy += 28) {
        ctx.beginPath(); ctx.arc(gx, gy, 2.4, 0, Math.PI * 2); ctx.fill();
      }
    }

    /* Main Vintage Thermal Gym Receipt Card */
    ctx.fillStyle = '#3B2A1A';
    D.roundRect(ctx, 56, 58, 796, 1094, 34);
    ctx.fill();

    ctx.fillStyle = '#FFFDF7';
    ctx.strokeStyle = '#3B2A1A';
    ctx.lineWidth = 6;
    D.roundRect(ctx, 48, 48, 796, 1094, 34);
    ctx.fill();
    ctx.stroke();

    /* Header Banner */
    ctx.fillStyle = '#6BBF4E';
    ctx.strokeStyle = '#3B2A1A';
    ctx.lineWidth = 5;
    D.roundRect(ctx, 88, 86, 716, 118, 24);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#FFFDF7';
    ctx.font = en ? '900 40px -apple-system, BlinkMacSystemFont, sans-serif' : '900 44px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(en ? 'Fruit Gym · Daily Receipt' : '水果健身房 · 今日营业财报', 120, 132);
    ctx.fillStyle = '#E8F6E6';
    ctx.font = '800 22px Menlo, Monaco, monospace';
    ctx.fillText('DAY ' + day + '  ·  ' + dayTitle + '  ·  FRUIT GYM TYCOON', 120, 174);

    /* Warm Wood Stage Showcase with 3 Buff Star Fruit Members */
    ctx.fillStyle = '#F4E6C8';
    ctx.strokeStyle = '#3B2A1A';
    ctx.lineWidth = 5;
    D.roundRect(ctx, 88, 234, 716, 300, 26);
    ctx.fill();
    ctx.stroke();

    D.drawFruitCharacter(ctx, 'lemon', 236, 392, 64, { buff: true, time: 0.2 });
    D.drawFruitCharacter(ctx, 'watermelon', 446, 384, 78, { buff: true, time: 0.4 });
    D.drawFruitCharacter(ctx, 'avocado', 656, 392, 64, { buff: true, time: 0.6 });

    /* Star Rating Badge Top-Left */
    ctx.fillStyle = '#FFD63B';
    ctx.strokeStyle = '#3B2A1A';
    ctx.lineWidth = 4;
    D.roundRect(ctx, 114, 258, 224, 48, 24);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#3B2A1A';
    ctx.font = en ? '900 21px -apple-system, BlinkMacSystemFont, sans-serif' : '900 24px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
    ctx.textAlign = 'center';
    var starText = day >= 7 && stars >= 3
      ? (en ? 'Olympic Gold Gym' : '奥运金印馆')
      : (stars >= 3
        ? (en ? '3-Star Hit Club' : '三星明星馆')
        : (stars === 2 ? (en ? '2-Star Rising Club' : '二星人气馆') : (en ? 'Cozy Starter Gym' : '元气开业馆')));
    ctx.fillText(starText, 226, 283);

    /* Red Seal Stamp Top-Right */
    ctx.save();
    ctx.translate(684, 294);
    ctx.rotate(-0.15);
    ctx.fillStyle = 'rgba(255,253,247,0.95)';
    ctx.strokeStyle = '#E85A4F';
    ctx.lineWidth = 6;
    D.roundRect(ctx, -96, -34, 192, 68, 12);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#E85A4F';
    ctx.font = en ? '900 26px -apple-system, BlinkMacSystemFont, sans-serif' : '900 32px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(day >= 7 ? (en ? 'GOLD MEDAL' : '奥运金冠') : (en ? 'MAX PUMP' : '暴汗暴赚'), 0, 2);
    ctx.restore();

    /* Big Revenue Hero Number */
    ctx.fillStyle = '#786653';
    ctx.font = '800 24px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(en ? 'TODAY’S GYM REVENUE' : '今日净收健身房金币', 446, 588);

    ctx.fillStyle = '#C43D33';
    ctx.font = '900 92px Menlo, Monaco, monospace';
    ctx.fillText(cur + earned, 446, 668);

    /* 3 Stat Cards */
    var cards = [
      { k: en ? 'Fruits Served' : '暴汗学员', v: en ? String(served) : (served + ' 位') },
      { k: en ? 'Best Combo' : '最高连击', v: 'x' + maxCombo },
      { k: en ? 'Best Day' : '历史单日最高', v: cur + bestDayRev }
    ];
    for (var i = 0; i < 3; i++) {
      var cx = 88 + i * 246;
      ctx.fillStyle = '#FAF5E8';
      ctx.strokeStyle = '#3B2A1A';
      ctx.lineWidth = 4;
      D.roundRect(ctx, cx, 744, 224, 128, 20);
      ctx.fill(); ctx.stroke();

      ctx.fillStyle = '#786653';
      ctx.font = '800 22px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
      ctx.fillText(cards[i].k, cx + 112, 784);

      ctx.fillStyle = '#3B2A1A';
      ctx.font = '900 36px Menlo, Monaco, monospace';
      ctx.fillText(cards[i].v, cx + 112, 838);
    }

    /* Warm Playful Quote Banner */
    ctx.fillStyle = '#FFF7D6';
    ctx.strokeStyle = '#3B2A1A';
    ctx.lineWidth = 4;
    D.roundRect(ctx, 88, 902, 716, 86, 18);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#3B2A1A';
    ctx.font = en ? '800 22px -apple-system, BlinkMacSystemFont, sans-serif' : '800 25px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
    ctx.fillText(
      en ? '“Every sweaty fruit walked out glowing and stronger today!”' : '“每一颗暴汗的水果，今天都练出了闪亮好状态！”',
      446,
      946
    );

    /* Clean Game Footer */
    ctx.textAlign = 'left';
    ctx.fillStyle = '#3B2A1A';
    ctx.font = '900 23px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
    ctx.fillText(en ? 'Fruit Gym Tycoon · Retro Arcade' : '水果健身房 · 复古经营日志', 96, 1046);
    ctx.fillStyle = '#786653';
    ctx.font = '700 19px Menlo, Monaco, monospace';
    ctx.fillText(
      en ? ('STAR FRUITS UNLOCKED: ' + unlocked + '/6  ·  7-DAY CAMPAIGN') : ('已解锁明星水果 ' + unlocked + '/6  ·  7 大主题关卡'),
      96,
      1078
    );
  }

  global.FruitGymPoster = {
    renderPoster: renderPoster
  };
})(window);
