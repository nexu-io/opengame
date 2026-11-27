import { DESIGN_ANNOTATION_BRIDGE } from './design-annotation-bridge.ts';
import { DESIGN_DECK_BRIDGE } from './design-deck-bridge.ts';

const BRIDGE_TOKEN_RE = /^[a-zA-Z0-9_-]{8,64}$/;

export function isValidPreviewBridgeToken(raw: unknown): raw is string {
  return typeof raw === 'string' && BRIDGE_TOKEN_RE.test(raw);
}

export function buildPreviewBridgeScript(token: string, designAnnotations = false): string {
  const safeToken = JSON.stringify(token);
  return `<script data-om-preview-bridge>
(function(){
  if (window.__omPreviewBridgeInstalled) return;
  window.__omPreviewBridgeInstalled = true;
  var TOKEN = ${safeToken};
${designAnnotations ? DESIGN_ANNOTATION_BRIDGE + DESIGN_DECK_BRIDGE : ''}
  var pick = false;
  var consoleSent = 0;
  var MAX_CONSOLE = 200;

  function safeSerialize(val) {
    if (typeof val === 'string') return val;
    if (val instanceof Error) return val.stack || val.message || String(val);
    if (val === null || val === undefined || typeof val === 'number' || typeof val === 'boolean') return String(val);
    try { return JSON.stringify(val); } catch (e) { return String(val); }
  }

  function postConsole(level, text, url, line) {
    if (consoleSent >= MAX_CONSOLE) return;
    consoleSent++;
    var clean = String(text || '').replace(/\\s+/g, ' ').trim().slice(0, 600);
    if (!clean) return;
    try {
      window.parent.postMessage({
        type: 'om:preview-console',
        token: TOKEN,
        level: level,
        text: clean,
        url: url ? String(url).slice(0, 400) : undefined,
        line: typeof line === 'number' && isFinite(line) ? line : undefined,
        timestamp: Date.now()
      }, '*');
    } catch (e) {}
  }

  ['error', 'warn', 'log'].forEach(function(method) {
    var orig = console[method];
    if (typeof orig !== 'function') return;
    console[method] = function() {
      try {
        var parts = [];
        for (var i = 0; i < arguments.length; i++) parts.push(safeSerialize(arguments[i]));
        var joined = parts.join(' ').trim();
        if (joined) postConsole(method, joined);
      } catch (e) {}
      return orig.apply(this, arguments);
    };
  });

  window.addEventListener('error', function(e) {
    if (e && e.target && e.target !== window) {
      var t = e.target;
      var src = t.src || t.href || '';
      if (src) postConsole('error', 'Failed to load resource: ' + src, src);
      return;
    }
    postConsole('error', (e && (e.message || (e.error && e.error.message))) || 'Uncaught runtime error', e && e.filename, e && e.lineno);
  }, true);

  window.addEventListener('unhandledrejection', function(e) {
    var reason = e && e.reason;
    var msg = reason instanceof Error ? (reason.stack || reason.message) : safeSerialize(reason);
    postConsole('error', 'Unhandled rejection: ' + msg);
  });

  var box = document.createElement('div');
  box.setAttribute('data-om-preview-ui', '1');
  box.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;outline:2px solid Highlight;background:color-mix(in srgb, Highlight 14%, transparent);border-radius:4px;display:none;transition:all 60ms ease;';
  var tagPill = document.createElement('span');
  tagPill.setAttribute('data-om-preview-ui', '1');
  tagPill.style.cssText = 'position:absolute;left:0;bottom:calc(100% + 4px);padding:2px 6px;border-radius:4px;background:Highlight;color:HighlightText;font:600 11px/1.3 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:nowrap;max-width:280px;overflow:hidden;text-overflow:ellipsis;';
  box.appendChild(tagPill);

  function mountBox() {
    if (!box.isConnected && document.body) document.body.appendChild(box);
  }
  function hideBox() {
    box.style.display = 'none';
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountBox);
  else mountBox();

  function cleanClasses(node) {
    var out = [];
    var list = node.classList || [];
    for (var i = 0; i < list.length && out.length < 6; i++) {
      var c = list[i];
      if (c && c.length <= 40 && !/^(hover|active|focus|focus-visible|focus-within|js-|om-)/.test(c)) out.push(c);
    }
    return out;
  }

  function escapeIdent(val) {
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(val);
    return String(val).replace(/[^a-zA-Z0-9_-]/g, function(ch) { return '\\\\' + ch; });
  }

  function selectorFor(node) {
    if (!node || node.nodeType !== 1) return '';
    if (node.id && !/^\\d/.test(node.id)) return '#' + escapeIdent(node.id);
    var parts = [];
    var cur = node;
    for (var depth = 0; cur && cur.nodeType === 1 && cur !== document.body && cur !== document.documentElement && depth < 5; depth++) {
      if (cur.id && !/^\\d/.test(cur.id)) {
        parts.unshift('#' + escapeIdent(cur.id));
        break;
      }
      var tag = cur.tagName.toLowerCase();
      var classes = cleanClasses(cur).slice(0, 2);
      var seg = tag + (classes.length ? '.' + classes.map(escapeIdent).join('.') : '');
      var parent = cur.parentElement;
      if (parent && !classes.length) {
        var sibs = [];
        for (var k = 0; k < parent.children.length; k++) {
          if (parent.children[k].tagName === cur.tagName) sibs.push(parent.children[k]);
        }
        if (sibs.length > 1) seg += ':nth-of-type(' + (sibs.indexOf(cur) + 1) + ')';
      }
      parts.unshift(seg);
      cur = parent;
    }
    return parts.join(' > ') || node.tagName.toLowerCase();
  }

  function deepElementAt(cx, cy) {
    var cur = document.elementFromPoint(cx, cy);
    for (var d = 0; cur && cur.shadowRoot && d < 8; d++) {
      var inner = cur.shadowRoot.elementFromPoint(cx, cy);
      if (!inner || inner === cur) break;
      cur = inner;
    }
    return cur;
  }

  function describe(el) {
    var rect = el.getBoundingClientRect();
    var computed = getComputedStyle(el);
    var styleKeys = ['display', 'position', 'width', 'height', 'color', 'backgroundColor', 'fontSize', 'fontWeight', 'fontFamily', 'padding', 'margin', 'borderRadius', 'gap', 'zIndex'];
    var styles = {};
    for (var i = 0; i < styleKeys.length; i++) {
      var k = styleKeys[i];
      if (computed[k]) styles[k] = String(computed[k]);
    }
    var componentName, sourceFile, sourceLine, sourceColumn;
    try {
      var ownKeys = Object.keys(el);
      for (var j = 0; j < ownKeys.length; j++) {
        var key = ownKeys[j];
        if (key.indexOf('__reactFiber$') === 0 || key.indexOf('__reactInternalInstance$') === 0) {
          var fiber = el[key];
          for (var h = 0; fiber && h < 16; h++) {
            var ft = fiber.type;
            if (ft && (typeof ft === 'function' || typeof ft === 'object')) {
              var n = ft.displayName || ft.name;
              if (n && !componentName) componentName = String(n);
            }
            var dbg = fiber._debugSource;
            if (dbg && dbg.fileName && !sourceFile) {
              sourceFile = String(dbg.fileName);
              if (typeof dbg.lineNumber === 'number') sourceLine = dbg.lineNumber;
              if (typeof dbg.columnNumber === 'number') sourceColumn = dbg.columnNumber;
            }
            if (componentName && sourceFile) break;
            fiber = fiber.return;
          }
          break;
        }
      }
      if (!componentName || !sourceFile) {
        var vc = el.__vueParentComponent;
        if (vc && vc.type) {
          componentName = componentName || vc.type.__name || vc.type.name;
          sourceFile = sourceFile || vc.type.__file;
        }
      }
      if (!componentName || !sourceFile) {
        var attrEl = el;
        for (var a = 0; attrEl && a < 6; a++) {
          componentName = componentName || attrEl.getAttribute('data-component') || undefined;
          sourceFile = sourceFile || attrEl.getAttribute('data-source-file') || undefined;
          if (componentName && sourceFile) break;
          attrEl = attrEl.parentElement;
        }
      }
    } catch (e) {}

    var tagName = el.tagName.toLowerCase();
    var classes = cleanClasses(el);
    var rawText = (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 240);
    var label = (el.getAttribute('aria-label') || '').trim() || (rawText ? rawText.slice(0, 48) : tagName);
    var htmlPreview = (el.outerHTML || '').replace(/\\s+/g, ' ').trim().slice(0, 400);
    return {
      tagName: tagName,
      selector: selectorFor(el),
      id: el.id || undefined,
      classes: classes.length ? classes : undefined,
      label: label,
      text: rawText || undefined,
      htmlPreview: htmlPreview,
      styles: styles,
      rect: { x: Math.round(rect.left), y: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) },
      viewport: { width: innerWidth, height: innerHeight },
      pageUrl: location.href,
      pageTitle: (document.title || '').slice(0, 300),
      componentName: componentName,
      sourceFile: sourceFile,
      sourceLine: sourceLine,
      sourceColumn: sourceColumn
    };
  }

  document.addEventListener('mousemove', function(e) {
    if (!pick) { hideBox(); return; }
    mountBox();
    var el = deepElementAt(e.clientX, e.clientY);
    if (!el || el === box || box.contains(el) || el === document.documentElement || el === document.body) { hideBox(); return; }
    var r = el.getBoundingClientRect();
    box.style.display = 'block';
    box.style.left = r.left + 'px';
    box.style.top = r.top + 'px';
    box.style.width = r.width + 'px';
    box.style.height = r.height + 'px';
    if (r.top < 28) {
      tagPill.style.bottom = 'auto';
      tagPill.style.top = r.bottom + 26 <= innerHeight ? 'calc(100% + 4px)' : '4px';
    } else {
      tagPill.style.top = 'auto';
      tagPill.style.bottom = 'calc(100% + 4px)';
    }
    tagPill.textContent = selectorFor(el);
  }, true);

  document.addEventListener('mouseleave', hideBox, true);

  document.addEventListener('click', function(e) {
    if (!pick) return;
    var el = deepElementAt(e.clientX, e.clientY) || e.target;
    if (!el || el === box || box.contains(el)) return;
    e.preventDefault();
    e.stopPropagation();
    var described = describe(el);
    window.parent.postMessage({
      type: 'om:preview-pick',
      token: TOKEN,
      element: described,
      viewport: described.viewport,
      rect: described.rect${designAnnotations ? ',\n      scroll: designAnnotationScroll(el.parentElement)' : ''}
    }, '*');
  }, true);

  function canvasHasVisiblePixels(canvas) {
    try {
      var probe = document.createElement('canvas');
      probe.width = 16;
      probe.height = 16;
      var pctx = probe.getContext('2d');
      if (!pctx) return true;
      pctx.drawImage(canvas, 0, 0, 16, 16);
      var data = pctx.getImageData(0, 0, 16, 16).data;
      for (var i = 3; i < data.length; i += 4) {
        if (data[i] > 0) return true;
      }
      return false;
    } catch (e) {
      return true;
    }
  }

  function captureLargestCanvas(requestId) {
    requestAnimationFrame(function() {
      try {
        var canvases = Array.from(document.querySelectorAll('canvas'));
        var best = null;
        var bestArea = 0;
        for (var i = 0; i < canvases.length; i++) {
          var c = canvases[i];
          var r = c.getBoundingClientRect();
          var area = (r.width > 0 ? r.width : c.width) * (r.height > 0 ? r.height : c.height);
          if (area > bestArea) { best = c; bestArea = area; }
        }
        if (!best || bestArea <= 0 || !canvasHasVisiblePixels(best)) {
          window.parent.postMessage({ type: 'om:preview-capture-result', token: TOKEN, requestId: requestId, dataUrl: null, width: innerWidth, height: innerHeight }, '*');
          return;
        }
        var dataUrl = best.toDataURL('image/png');
        window.parent.postMessage({ type: 'om:preview-capture-result', token: TOKEN, requestId: requestId, dataUrl: dataUrl, width: best.width || innerWidth, height: best.height || innerHeight }, '*');
      } catch (e) {
        window.parent.postMessage({ type: 'om:preview-capture-result', token: TOKEN, requestId: requestId, dataUrl: null, width: innerWidth, height: innerHeight }, '*');
      }
    });
  }

  window.addEventListener('message', function(e) {
    var m = e.data;
    if (!m || typeof m !== 'object' || m.token !== TOKEN) return;
    if (m.type === 'om:preview-mode' || m.type === 'om:design-mode') {
      pick = Boolean(m.pick);
      if (!pick) hideBox();
      return;
    }
    if (m.type === 'om:preview-capture') {
      captureLargestCanvas(String(m.requestId || ''));
    }
  });
})();
</script>`;
}

export function buildViewportGuardScript(): string {
  return `<script data-om-viewport-guard>
(function(){
  if (window.__omViewportGuardInstalled) return;
  window.__omViewportGuardInstalled = true;
  var origAdd = window.addEventListener.bind(window);
  function readSize() {
    var w = window.innerWidth || (document.documentElement && document.documentElement.clientWidth) || 0;
    var h = window.innerHeight || (document.documentElement && document.documentElement.clientHeight) || 0;
    return [w, h];
  }
  var init = readSize();
  var lastW = init[0];
  var lastH = init[1];
  var needsSync = !(lastW > 0 && lastH > 0);
  var hasResizeListener = false;
  var replaying = false;
  var pendingRaf = 0;
  var replayCount = 0;
  var MAX_REPLAYS = 6;
  var seenListeners = typeof WeakSet === 'function' ? new WeakSet() : null;

  function scheduleReplay() {
    if (replaying || pendingRaf || replayCount >= MAX_REPLAYS) return;
    var sz = readSize();
    if (!(sz[0] > 0 && sz[1] > 0)) return;
    pendingRaf = requestAnimationFrame(function() {
      pendingRaf = 0;
      var now = readSize();
      if (!(now[0] > 0 && now[1] > 0)) return;
      lastW = now[0];
      lastH = now[1];
      replayCount++;
      replaying = true;
      try {
        window.dispatchEvent(new Event('resize'));
      } finally {
        replaying = false;
      }
    });
  }

  function noteViewportChange(fromObserver) {
    var sz = readSize();
    var w = sz[0], h = sz[1];
    if (!(w > 0 && h > 0)) {
      needsSync = true;
      replayCount = 0;
      lastW = w;
      lastH = h;
      return;
    }
    var wasZero = !(lastW > 0 && lastH > 0);
    var changed = w !== lastW || h !== lastH;
    if (!changed) return;
    lastW = w;
    lastH = h;
    if (wasZero) {
      needsSync = true;
      replayCount = 0;
      if (fromObserver) scheduleReplay();
    } else if (!hasResizeListener) {
      needsSync = true;
    } else if (!fromObserver) {
      // A real non-zero resize just delivered to all live listeners; no further boot replay needed.
      needsSync = false;
    }
  }

  origAdd('resize', function() {
    if (!replaying) noteViewportChange(false);
  }, true);

  window.addEventListener = function(type, listener, options) {
    var result = origAdd.apply(window, arguments);
    if (type === 'resize' && listener && !replaying) {
      var sz = readSize();
      if (!hasResizeListener && sz[0] > 0 && sz[1] > 0 && (sz[0] !== lastW || sz[1] !== lastH)) {
        needsSync = true;
        lastW = sz[0];
        lastH = sz[1];
      }
      hasResizeListener = true;
      var trackable = typeof listener === 'function' || typeof listener === 'object';
      var isNew = !seenListeners || !trackable || !seenListeners.has(listener);
      if (seenListeners && trackable) seenListeners.add(listener);
      if (needsSync && isNew && sz[0] > 0 && sz[1] > 0) {
        scheduleReplay();
      }
    }
    return result;
  };

  function observeRoot() {
    if (typeof ResizeObserver !== 'function' || !document.documentElement) return;
    var ro = new ResizeObserver(function() {
      noteViewportChange(true);
    });
    ro.observe(document.documentElement);
  }
  if (document.documentElement) observeRoot();
  else origAdd('DOMContentLoaded', observeRoot);
})();
</script>`;
}

function injectHeadScriptHtml(rawHtml: Buffer | string, script: string): Buffer {
  const buf = Buffer.isBuffer(rawHtml) ? rawHtml : Buffer.from(rawHtml, 'utf8');
  const html = buf.toString('utf8');
  let out: string;
  if (/<head\b[^>]*>/i.test(html)) {
    out = html.replace(/<head\b[^>]*>/i, match => `${match}\n${script}`);
  } else if (/<body\b[^>]*>/i.test(html)) {
    out = html.replace(/<body\b[^>]*>/i, match => `${match}\n${script}`);
  } else if (/<html\b[^>]*>/i.test(html)) {
    out = html.replace(/<html\b[^>]*>/i, match => `${match}\n${script}`);
  } else if (/^\s*<!doctype[^>]*>/i.test(html)) {
    out = html.replace(/^\s*<!doctype[^>]*>/i, match => `${match}\n${script}`);
  } else {
    out = `${script}\n${html}`;
  }
  return Buffer.from(out, 'utf8');
}

export function injectViewportGuardHtml(rawHtml: Buffer | string): Buffer {
  return injectHeadScriptHtml(rawHtml, buildViewportGuardScript());
}

/**
 * Root-level audio guard injected into game preview iframes before any game script runs.
 * Intercepts both Web Audio API (AudioContext / webkitAudioContext destination routing via a
 * private master GainNode) and HTMLMediaElement (<audio>, <video>, new Audio()) so Studio can
 * mute/unmute and scale game volume cleanly even when a game provides no in-game sound toggle.
 */
export function buildAudioGuardScript(): string {
  return `<script data-om-audio-guard="1">
(() => {
  if (window.__OM_AUDIO_GUARD__) return;
  window.__OM_AUDIO_GUARD__ = true;

  var bridgeToken = '';
  try {
    var search = window.location && typeof window.location.search === 'string' ? window.location.search : '';
    if (search && typeof URLSearchParams === 'function') {
      bridgeToken = new URLSearchParams(search).get('omBridge') || '';
    }
  } catch {}

  var masterMuted = false;
  var masterVolume = 1;
  var clamp01 = function(v) {
    var n = Number(v);
    if (!Number.isFinite(n)) return 1;
    return n < 0 ? 0 : n > 1 ? 1 : n;
  };
  var effectiveGain = function() {
    return masterMuted ? 0 : clamp01(masterVolume);
  };

  // --- 1. Web Audio API master gain interception ---
  var masterGains = new Set();
  var destToMaster = new WeakMap();
  var AudioNodeProto = typeof AudioNode !== 'undefined' ? AudioNode.prototype : null;
  var origConnect = AudioNodeProto ? AudioNodeProto.connect : null;

  function registerContext(ctx) {
    if (!ctx || !origConnect) return ctx;
    try {
      var realDest = ctx.destination;
      if (!realDest || destToMaster.has(realDest)) return ctx;
      var gain = ctx.createGain();
      gain.gain.value = effectiveGain();
      origConnect.call(gain, realDest);
      destToMaster.set(realDest, gain);
      masterGains.add({ ctx: ctx, gain: gain });
    } catch {}
    return ctx;
  }

  if (AudioNodeProto && origConnect) {
    AudioNodeProto.connect = function(destination) {
      if (destination && destToMaster.has(destination)) {
        var redirected = destToMaster.get(destination);
        if (this !== redirected) {
          var args = Array.prototype.slice.call(arguments);
          args[0] = redirected;
          return origConnect.apply(this, args);
        }
      }
      return origConnect.apply(this, arguments);
    };
  }

  function wrapAudioCtor(name) {
    var NativeCtor = window[name];
    if (typeof NativeCtor !== 'function') return;
    var Wrapped = function() {
      var instance = new (Function.prototype.bind.apply(NativeCtor, [null].concat(Array.prototype.slice.call(arguments))))();
      return registerContext(instance);
    };
    Wrapped.prototype = NativeCtor.prototype;
    try { Object.setPrototypeOf(Wrapped, NativeCtor); } catch {}
    try { window[name] = Wrapped; } catch {}
  }
  wrapAudioCtor('AudioContext');
  wrapAudioCtor('webkitAudioContext');

  // --- 2. HTMLMediaElement (<audio>, <video>, new Audio()) interception ---
  var mediaRefs = typeof WeakRef === 'function' ? new Set() : null;
  var mediaState = new WeakMap();
  var MediaProto = typeof HTMLMediaElement !== 'undefined' ? HTMLMediaElement.prototype : null;
  var origVolDesc = MediaProto ? Object.getOwnPropertyDescriptor(MediaProto, 'volume') : null;
  var origMutedDesc = MediaProto ? Object.getOwnPropertyDescriptor(MediaProto, 'muted') : null;
  var origPlay = MediaProto ? MediaProto.play : null;

  function ensureMediaTracked(el) {
    if (!el || typeof el !== 'object') return null;
    var st = mediaState.get(el);
    if (!st) {
      var initialVol = 1;
      var initialMuted = false;
      try {
        if (origVolDesc && origVolDesc.get) initialVol = clamp01(origVolDesc.get.call(el));
        if (origMutedDesc && origMutedDesc.get) initialMuted = Boolean(origMutedDesc.get.call(el));
      } catch {}
      st = { volume: initialVol, muted: initialMuted };
      mediaState.set(el, st);
      if (mediaRefs) {
        mediaRefs.add(new WeakRef(el));
      }
    }
    return st;
  }

  function applyMedia(el) {
    var st = ensureMediaTracked(el);
    if (!st) return;
    try {
      if (origMutedDesc && origMutedDesc.set) {
        origMutedDesc.set.call(el, masterMuted || st.muted);
      }
      if (origVolDesc && origVolDesc.set) {
        origVolDesc.set.call(el, masterMuted ? 0 : clamp01(st.volume * masterVolume));
      }
    } catch {}
  }

  if (MediaProto && origVolDesc && origVolDesc.configurable) {
    Object.defineProperty(MediaProto, 'volume', {
      configurable: true,
      enumerable: origVolDesc.enumerable,
      get: function() {
        var st = ensureMediaTracked(this);
        return st ? st.volume : 1;
      },
      set: function(v) {
        var st = ensureMediaTracked(this);
        if (st) st.volume = clamp01(v);
        applyMedia(this);
      }
    });
  }

  if (MediaProto && origMutedDesc && origMutedDesc.configurable) {
    Object.defineProperty(MediaProto, 'muted', {
      configurable: true,
      enumerable: origMutedDesc.enumerable,
      get: function() {
        var st = ensureMediaTracked(this);
        return st ? st.muted : false;
      },
      set: function(v) {
        var st = ensureMediaTracked(this);
        if (st) st.muted = Boolean(v);
        applyMedia(this);
      }
    });
  }

  if (MediaProto && origPlay) {
    MediaProto.play = function() {
      applyMedia(this);
      return origPlay.apply(this, arguments);
    };
  }

  if (typeof window.Audio === 'function') {
    var NativeAudio = window.Audio;
    var WrappedAudio = function(src) {
      var el = arguments.length > 0 ? new NativeAudio(src) : new NativeAudio();
      applyMedia(el);
      return el;
    };
    WrappedAudio.prototype = NativeAudio.prototype;
    try { Object.setPrototypeOf(WrappedAudio, NativeAudio); } catch {}
    try { window.Audio = WrappedAudio; } catch {}
  }

  function scanDomMedia() {
    if (!document || !document.querySelectorAll) return;
    var nodes = document.querySelectorAll('audio, video');
    for (var i = 0; i < nodes.length; i++) applyMedia(nodes[i]);
  }

  function applyAll() {
    var g = effectiveGain();
    masterGains.forEach(function(entry) {
      try {
        if (entry.ctx.state === 'closed') {
          masterGains.delete(entry);
          return;
        }
        if (entry.ctx.state === 'running' && entry.gain.gain.setTargetAtTime) {
          entry.gain.gain.setTargetAtTime(g, entry.ctx.currentTime, 0.015);
        } else {
          entry.gain.gain.value = g;
        }
      } catch {}
    });
    scanDomMedia();
    if (mediaRefs) {
      mediaRefs.forEach(function(ref) {
        var el = ref.deref();
        if (!el) {
          mediaRefs.delete(ref);
          return;
        }
        applyMedia(el);
      });
    }
    if (masterMuted && window.speechSynthesis && typeof window.speechSynthesis.cancel === 'function') {
      try { window.speechSynthesis.cancel(); } catch {}
    }
  }

  window.addEventListener('message', function(event) {
    if (!event || event.source !== window.parent) return;
    var msg = event.data;
    if (!msg || typeof msg !== 'object' || msg.type !== 'om:preview-audio') return;
    if (bridgeToken && msg.token !== bridgeToken) return;
    if (typeof msg.muted === 'boolean') masterMuted = msg.muted;
    if (typeof msg.volume === 'number') masterVolume = clamp01(msg.volume);
    applyAll();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scanDomMedia, { once: true });
  }
  try {
    parent.postMessage(bridgeToken ? { type: 'om:audio-guard-ready', token: bridgeToken } : { type: 'om:audio-guard-ready' }, '*');
  } catch {}
})();
</script>`;
}

export function injectAudioGuardHtml(rawHtml: Buffer | string): Buffer {
  return injectHeadScriptHtml(rawHtml, buildAudioGuardScript());
}

export function injectPreviewBridgeHtml(rawHtml: Buffer | string, token: string, designAnnotations = false): Buffer {
  const buf = Buffer.isBuffer(rawHtml) ? rawHtml : Buffer.from(rawHtml, 'utf8');
  if (!isValidPreviewBridgeToken(token)) return buf;
  return injectHeadScriptHtml(buf, buildPreviewBridgeScript(token, designAnnotations));
}
