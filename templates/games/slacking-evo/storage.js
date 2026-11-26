/* ==========================================================================
   storage.js — Sandbox-Safe Local Persistence, Haptics & Poster Export
   Falls back to in-memory storage inside opaque-origin iframes without throwing.
   ========================================================================== */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'og_slacking_evo_v1';
  var memoryStore = null;

  function loadSavedState() {
    try {
      if (global.localStorage) {
        var raw = global.localStorage.getItem(STORAGE_KEY);
        if (raw) {
          var parsed = JSON.parse(raw);
          memoryStore = parsed;
          return parsed;
        }
      }
    } catch (err) {
      /* Sandboxed iframe without allow-same-origin: use in-memory fallback */
    }
    return memoryStore;
  }

  function saveState(payload) {
    memoryStore = payload;
    try {
      if (global.localStorage) {
        global.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
        return true;
      }
    } catch (err) {
      return false;
    }
    return false;
  }

  function vibrateMilestone(strong) {
    try {
      if (global.navigator && typeof global.navigator.vibrate === 'function') {
        global.navigator.vibrate(strong ? 36 : 18);
      }
    } catch (err) {}
  }

  function downloadDataUrl(dataUrl, filename) {
    try {
      var link = document.createElement('a');
      link.href = dataUrl;
      link.download = filename || 'slacking-evolution-card.png';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      return true;
    } catch (err) {
      return false;
    }
  }

  global.SlackStorage = {
    loadSavedState: loadSavedState,
    saveState: saveState,
    vibrateMilestone: vibrateMilestone,
    downloadDataUrl: downloadDataUrl
  };
})(window);
