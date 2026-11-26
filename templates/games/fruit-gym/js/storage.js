/* ==========================================================================
   storage.js — Sandbox-Safe Local Persistence, Haptics & Poster Export
   Falls back to in-memory storage inside opaque-origin iframes without throwing.
   ========================================================================== */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'og_fruit_gym_state_v1';
  var memoryStore = null;

  function loadState() {
    try {
      if (global.localStorage) {
        var raw = global.localStorage.getItem(STORAGE_KEY);
        if (raw) {
          var parsed = JSON.parse(raw);
          memoryStore = parsed;
          return parsed;
        }
      }
    } catch (e) {
      /* Sandboxed iframe without allow-same-origin */
    }
    return memoryStore;
  }

  function saveState(obj) {
    memoryStore = obj;
    try {
      if (global.localStorage) {
        global.localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
        return true;
      }
    } catch (e) {
      return false;
    }
    return false;
  }

  function vibrateMilestone() {
    try {
      if (global.navigator && typeof global.navigator.vibrate === 'function') {
        global.navigator.vibrate(28);
      }
    } catch (e) {}
  }

  function downloadDataUrl(dataUrl, filename) {
    try {
      var link = document.createElement('a');
      link.href = dataUrl;
      link.download = filename || 'fruit-gym-receipt.png';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      return true;
    } catch (e) {
      return false;
    }
  }

  global.FruitGymStorage = {
    loadState: loadState,
    saveState: saveState,
    vibrateMilestone: vibrateMilestone,
    downloadDataUrl: downloadDataUrl
  };
})(window);
