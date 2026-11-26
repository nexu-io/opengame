/* ==========================================================================
   sound.js — Cheerful Retro Diner x Gym Arcade Web Audio Synthesizer
   ========================================================================== */
(function (global) {
  'use strict';

  var ctx = null;
  var muted = false;

  function ac() {
    if (muted) return null;
    if (!ctx) {
      var AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return null;
      try { ctx = new AC(); } catch (e) { return null; }
    }
    if (ctx.state === 'suspended') {
      try { ctx.resume(); } catch (e2) {}
    }
    return ctx;
  }

  function note(freq, endFreq, dur, type, vol, delay) {
    var c = ac();
    if (!c) return;
    var t0 = c.currentTime + (delay || 0);
    var osc = c.createOscillator();
    var gain = c.createGain();
    osc.type = type || 'triangle';
    osc.frequency.setValueAtTime(freq, t0);
    if (endFreq && endFreq !== freq) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(40, endFreq), t0 + dur);
    }
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.linearRampToValueAtTime(vol || 0.14, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain);
    gain.connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  function playDoorBell() {
    note(880, 880, 0.12, 'sine', 0.11, 0);
    note(1174.66, 1174.66, 0.22, 'sine', 0.11, 0.08);
  }

  function playGrab() {
    note(520, 740, 0.08, 'triangle', 0.11, 0);
  }

  function playSeat() {
    note(420, 680, 0.12, 'triangle', 0.14, 0);
  }

  function playServe(combo) {
    var base = 523.25 * Math.pow(1.06, Math.min(8, combo || 0));
    note(base, base * 1.12, 0.11, 'triangle', 0.15, 0);
    note(base * 1.25, base * 1.25, 0.18, 'sine', 0.13, 0.06);
  }

  function playBonk() {
    note(310, 620, 0.09, 'square', 0.07, 0);
    note(784, 987, 0.15, 'triangle', 0.13, 0.06);
  }

  function playCoin() {
    note(987.77, 987.77, 0.08, 'sine', 0.14, 0);
    note(1318.51, 1318.51, 0.18, 'sine', 0.15, 0.06);
    note(1567.98, 1567.98, 0.22, 'sine', 0.12, 0.12);
  }

  function playClean() {
    note(620, 960, 0.09, 'sine', 0.11, 0);
    note(880, 1280, 0.12, 'sine', 0.1, 0.06);
  }

  function playBuzz() {
    note(240, 160, 0.16, 'sawtooth', 0.07, 0);
  }

  function playFever() {
    var seq = [523.25, 659.25, 783.99, 1046.5];
    for (var i = 0; i < seq.length; i++) {
      note(seq[i], seq[i] * 1.02, 0.22, 'triangle', 0.14, i * 0.065);
    }
  }

  function playDayEnd() {
    var seq = [523.25, 659.25, 783.99, 1046.5, 1318.5];
    for (var i = 0; i < seq.length; i++) {
      note(seq[i], seq[i], 0.34, 'triangle', 0.14, i * 0.08);
    }
  }

  function playUpgrade() {
    note(587.33, 587.33, 0.12, 'triangle', 0.14, 0);
    note(880, 1174.66, 0.26, 'triangle', 0.15, 0.08);
  }

  function setMuted(v) { muted = !!v; }
  function isMuted() { return muted; }

  global.FruitGymSound = {
    playDoorBell: playDoorBell,
    playGrab: playGrab,
    playSeat: playSeat,
    playServe: playServe,
    playBonk: playBonk,
    playCoin: playCoin,
    playClean: playClean,
    playBuzz: playBuzz,
    playFever: playFever,
    playDayEnd: playDayEnd,
    playUpgrade: playUpgrade,
    setMuted: setMuted,
    isMuted: isMuted
  };
})(window);
