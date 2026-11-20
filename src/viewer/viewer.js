/*
 * JSON Peek viewer: a virtualised, keyboard-driven JSON tree.
 * Only the rows in the viewport exist in the DOM, so documents with millions of
 * values scroll as smoothly as small ones.
 *
 * JSONPeek.createViewer(host, opts) -> viewer
 *   host: element to mount into (a shadow root is attached to it)
 *   opts.storage: { get(key) -> Promise<value>, set(key, value) } for settings (optional)
 *   opts.captureFind: intercept Ctrl/Cmd+F to focus the search box (default true)
 *   opts.title: label shown in the toolbar (default 'JSON Peek')
 * viewer.load(text, { multi }) -> { ok, error, doc }
 */
(function (root) {
  'use strict';
  var NS = root.JSONPeek = root.JSONPeek || {};
  var core = NS.core, Q = NS.query;
  var RH = 20;                 // row height in px (must match CSS)
  var MAXH = 4000000;          // cap on scroll height; larger lists use scaled scrolling
  var AUTO_EXPAND_ALL = 20000; // documents with fewer values open fully expanded
  var STR_MAX = 400;           // characters of a string shown inline
  var T_NUM = 3, T_STR = 4, T_OBJ = 5, T_ARR = 6;

  function esc(s) {
    return s.replace(/[&<>"']/g, function (c) {
      return c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;';
    });
  }
  function fmtBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(1) + ' MB';
  }
  function fmtInt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function plural(n, one, many) { return fmtInt(n) + ' ' + (n === 1 ? one : many); }

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  function copyText(text, rootNode) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).catch(function () { return legacyCopy(text, rootNode); });
    }
    return Promise.resolve(legacyCopy(text, rootNode));
  }
  function legacyCopy(text, rootNode) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
    (rootNode || document.body).appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    ta.remove();
    if (!ok) throw new Error('copy failed');
  }

  var ICONS = {
    theme: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm0 1.5v11a5.5 5.5 0 0 1 0-11Z"/></svg>',
    up: '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path fill="currentColor" d="M8 4 3 9.5l1.1 1.1L8 6.7l3.9 3.9L13 9.5z"/></svg>',
    down: '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path fill="currentColor" d="M8 12 3 6.5l1.1-1.1L8 9.3l3.9-3.9L13 6.5z"/></svg>'
  };

  function createViewer(host, opts) {
    opts = opts || {};
    var storage = opts.storage || null;
    var shadow = host.shadowRoot || host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '';
    var style = el('style');
    style.textContent = NS.css || '';
    shadow.appendChild(style);

    var ui = el('div', 'jp');
    ui.setAttribute('data-theme', 'auto');
    ui.innerHTML =
      '<div class="bar">' +
        '<span class="brand">' + esc(opts.title || 'JSON Peek') + '</span>' +
        '<div class="tabs" role="tablist"><button class="tab on" data-view="tree" role="tab" aria-selected="true">Tree</button><button class="tab" data-view="raw" role="tab" aria-selected="false">Raw</button></div>' +
        '<div class="search"><input type="search" spellcheck="false" autocomplete="off" placeholder="Search keys and values, or $.json.path" aria-label="Search or JSONPath query">' +
          '<span class="count" aria-live="polite"></span>' +
          '<button class="ib prev" title="Previous match (Shift+Enter)" aria-label="Previous match">' + ICONS.up + '</button>' +
          '<button class="ib next" title="Next match (Enter)" aria-label="Next match">' + ICONS.down + '</button>' +
          '<label class="chk" title="Show only matches and their parents"><input type="checkbox" class="filter"> Filter</label>' +
        '</div>' +
        '<div class="grp"><button class="b" data-act="collapse" title="Collapse all">Collapse</button>' +
          '<button class="b lvl" data-lvl="1" title="Expand to level 1">1</button><button class="b lvl" data-lvl="2" title="Expand to level 2">2</button><button class="b lvl" data-lvl="3" title="Expand to level 3">3</button>' +
          '<button class="b" data-act="expand" title="Expand all">Expand</button></div>' +
        '<div class="grp"><button class="b" data-act="copyall" title="Copy the whole document, formatted">Copy</button>' +
          '<button class="b" data-act="save" title="Download as a .json file">Save</button>' +
          '<button class="ib" data-act="theme" title="Theme: auto" aria-label="Toggle theme">' + ICONS.theme + '</button></div>' +
      '</div>' +
      '<div class="main">' +
        '<div class="scroller" tabindex="0" role="tree" aria-label="JSON tree"><div class="layer"></div><div class="spacer"></div></div>' +
        '<pre class="raw" hidden></pre>' +
        '<div class="err" hidden></div>' +
      '</div>' +
      '<div class="status"><span class="path" title="Path of the selected value"></span>' +
        '<span class="sinfo"></span>' +
        '<span class="sbtns"><select class="pstyle" title="Path style" aria-label="Path style"><option value="jsonpath">$.a[0]</option><option value="jq">.a[0] (jq)</option><option value="js">a[0] (JS)</option></select>' +
        '<button class="b" data-act="cpath">Copy path</button><button class="b" data-act="cval">Copy value</button></span>' +
        '<span class="meta"></span></div>' +
      '<div class="toast" hidden></div>';
    shadow.appendChild(ui);

    var $ = function (s) { return ui.querySelector(s); };
    var scroller = $('.scroller'), layer = $('.layer'), spacer = $('.spacer');
    var rawEl = $('.raw'), errEl = $('.err'), input = $('.search input'), countEl = $('.count');
    var filterEl = $('.filter'), pathEl = $('.path'), sinfoEl = $('.sinfo'), metaEl = $('.meta');
    var pstyleEl = $('.pstyle'), toastEl = $('.toast');

    var state = {
      text: '', doc: null, expanded: null, rows: null, nrows: 0, sel: -1, view: 'tree',
      matches: null, matchSet: null, cur: -1, textQuery: '', keep: null, theme: 'auto',
      pathStyle: 'jsonpath', parseMs: 0, error: null
    };

    // ---------- settings ----------
    function loadSettings() {
      if (!storage) return;
      Promise.resolve(storage.get('settings')).then(function (s) {
        if (!s) return;
        if (s.theme) setTheme(s.theme, true);
        if (s.pathStyle) { state.pathStyle = s.pathStyle; pstyleEl.value = s.pathStyle; updateStatus(); }
      }).catch(function () {});
    }
    function saveSettings() {
      if (storage) try { storage.set('settings', { theme: state.theme, pathStyle: state.pathStyle }); } catch (e) { /* ignore */ }
    }
    function setTheme(t, silent) {
      state.theme = t;
      ui.setAttribute('data-theme', t);
      ui.querySelector('[data-act=theme]').title = 'Theme: ' + t;
      if (!silent) saveSettings();
    }

    // ---------- loading ----------
    function load(text, lopts) {
      lopts = lopts || {};
      state.text = text;
      state.error = null;
      var t0 = performance.now();
      try {
        state.doc = lopts.doc && lopts.doc.text === text ? lopts.doc : core.parse(text, { multi: !!lopts.multi });
      } catch (e) {
        state.doc = null;
        state.error = e;
      }
      state.parseMs = lopts.doc && state.doc === lopts.doc && lopts.parseMs != null ? lopts.parseMs : performance.now() - t0;
      rawEl.textContent = '';
      state.rawFilled = false;
      if (!state.doc) {
        showError(state.error, text, lopts);
        return { ok: false, error: state.error };
      }
      errEl.hidden = true;
      ui.classList.remove('invalid');
      var doc = state.doc;
      state.expanded = new Uint8Array(doc.n);
      expandToLevel(doc.n <= AUTO_EXPAND_ALL ? 1e9 : (doc.multi ? 1 : 2), true);
      state.rows = new Int32Array(Math.min(2 * doc.n + 2, 2147483647));
      state.sel = doc.root;
      clearSearch(true);
      setView('tree');
      rebuild();
      var meta = fmtBytes(text.length) + ' · ' + plural(doc.n, 'value', 'values') + ' · parsed in ' + Math.round(state.parseMs) + ' ms';
      if (doc.multi) meta = 'JSON Lines: ' + plural(doc.count[doc.root], 'record', 'records') + ' · ' + meta;
      if (doc.wrapper && doc.wrapper.kind) meta = (doc.wrapper.kind === 'jsonp' ? 'JSONP callback removed' : 'Anti-hijacking prefix removed') + ' · ' + meta;
      metaEl.textContent = meta;
      updateStatus();
      return { ok: true, doc: doc };
    }

    function showError(e, text, lopts) {
      setView('tree');
      scroller.hidden = true;
      errEl.hidden = false;
      var html = '<div class="emsg"><strong>Invalid JSON.</strong> ' + esc(e.message || String(e)) + '</div>';
      if (e.pos != null) {
        var lines = text.split('\n');
        var from = Math.max(0, e.line - 4), to = Math.min(lines.length, e.line + 2);
        var snip = '';
        for (var i = from; i < to; i++) {
          var ln = lines[i].length > 300 ? lines[i].slice(Math.max(0, (i === e.line - 1 ? e.col : 0) - 150), Math.max(0, (i === e.line - 1 ? e.col : 0) - 150) + 300) : lines[i];
          var off = lines[i].length > 300 ? Math.max(0, e.col - 150) : 0;
          snip += '<div class="eline' + (i === e.line - 1 ? ' bad' : '') + '"><span class="eno">' + (i + 1) + '</span>' + esc(ln) + '</div>';
          if (i === e.line - 1) snip += '<div class="eline caret"><span class="eno"></span>' + new Array(Math.max(0, e.col - off)).join(' ') + '^</div>';
        }
        html += '<pre class="esnip">' + snip + '</pre>';
      }
      if (!lopts.multi && /JSON Lines/.test(e.message)) html += '<button class="b" data-act="jsonl">View as JSON Lines</button> ';
      html += '<button class="b" data-act="showraw">Show raw text</button>';
      errEl.innerHTML = html;
      metaEl.textContent = fmtBytes(text.length);
      ui.classList.add('invalid');
      pathEl.textContent = '';
      sinfoEl.textContent = '';
    }

    // ---------- expansion ----------
    function expandToLevel(level, quiet) {
      var d = state.doc, ex = state.expanded, depth = d.depth, type = d.type;
      var base = d.depth[d.root];
      for (var i = 0; i < d.n; i++) ex[i] = (type[i] >= T_OBJ && depth[i] - base < level) ? 1 : 0;
      if (!quiet) { rebuild(); revealSel(); }
    }
    function setSubtree(id, v) {
      var d = state.doc, e = id + d.size[id];
      for (var i = id; i < e; i++) state.expanded[i] = d.type[i] >= T_OBJ ? v : 0;
    }
    function expandAncestors(id) {
      var d = state.doc;
      for (var p = d.parent[id]; p >= 0; p = d.parent[p]) state.expanded[p] = 1;
    }

    // ---------- rows ----------
    function rebuild() {
      var d = state.doc;
      if (!d) return;
      var rows = state.rows, k = 0, ex = state.expanded, size = d.size, type = d.type, count = d.count, keep = state.keep;
      var stack = [], id = d.root, end = d.root + size[d.root];
      while (id < end) {
        while (stack.length && id >= stack[stack.length - 1] + size[stack[stack.length - 1]]) rows[k++] = -(stack.pop() + 1);
        if (keep && !keep[id]) { id += size[id]; continue; }
        rows[k++] = id;
        if (type[id] >= T_OBJ && count[id] > 0 && ex[id]) { stack.push(id); id++; }
        else id += size[id];
      }
      while (stack.length) rows[k++] = -(stack.pop() + 1);
      state.nrows = k;
      layout();
    }

    function metrics() {
      var ch = scroller.clientHeight || 1;
      var total = state.nrows * RH;
      var vh = Math.max(Math.min(total, MAXH), ch);
      return { ch: ch, total: total, vh: vh, k: total > ch && vh > ch ? (total - ch) / (vh - ch) / RH : 0 };
    }
    function layout() {
      var m = metrics();
      layer.style.height = m.ch + 'px';
      spacer.style.height = Math.max(0, m.vh - m.ch) + 'px';
      render();
    }

    var LOWER = null;
    function render() {
      var d = state.doc;
      if (!d) return;
      var m = metrics();
      var ff = scroller.scrollTop * m.k;
      var first = Math.floor(ff), offs = -(ff - first) * RH;
      var nvis = Math.ceil(m.ch / RH) + 1;
      var html = [];
      for (var j = 0; j < nvis && first + j < state.nrows; j++) {
        html.push(rowHtml(first + j, offs + j * RH));
      }
      layer.innerHTML = html.join('');
    }

    function hl(s) {
      var q = state.textQuery;
      if (!q) return esc(s);
      var lower = s.toLowerCase(), out = '', i = 0, j;
      while ((j = lower.indexOf(q, i)) >= 0) {
        out += esc(s.slice(i, j)) + '<mark>' + esc(s.slice(j, j + q.length)) + '</mark>';
        i = j + q.length;
      }
      return out + esc(s.slice(i));
    }

    function isMatch(id) { return state.matchSet ? state.matchSet[id] === 1 : false; }

    function rowHtml(r, top) {
      var d = state.doc, v = state.rows[r];
      var close = v < 0, id = close ? -v - 1 : v;
      var t = d.type[id], p = d.parent[id];
      var last = p < 0 || id + d.size[id] === p + d.size[p];
      var depth = d.depth[id] - d.depth[d.root];
      var cls = 'r';
      if (!close && id === state.sel) cls += ' sel';
      if (!close && isMatch(id)) cls += (state.matches && state.matches[state.cur] === id) ? ' hit cur' : ' hit';
      var h = '<div class="' + cls + '" data-r="' + r + '" role="treeitem" style="top:' + top + 'px;padding-left:' + (depth * 16 + 18) + 'px"';
      if (!close && t >= T_OBJ && d.count[id] > 0) h += ' aria-expanded="' + (state.expanded[id] ? 'true' : 'false') + '"';
      h += '>';
      var comma = last ? '' : '<span class="pu">,</span>';
      if (close) return h + '<span class="pu">' + (t === T_OBJ ? '}' : ']') + '</span>' + comma + '</div>';
      if (t >= T_OBJ && d.count[id] > 0) h += '<span class="tg' + (state.expanded[id] ? ' open' : '') + '" data-tg="1"></span>';
      if (p >= 0) {
        if (d.type[p] === T_OBJ) h += '<span class="k">' + hl(JSON.stringify(d.key(id))) + '</span><span class="pu">: </span>';
        else h += '<span class="ix">' + d.index[id] + '</span><span class="pu">: </span>';
      }
      if (t >= T_OBJ) {
        var o = t === T_OBJ ? '{' : '[', c = t === T_OBJ ? '}' : ']', n = d.count[id];
        if (n === 0) h += '<span class="pu">' + o + c + '</span>' + comma;
        else if (state.expanded[id]) h += '<span class="pu">' + o + '</span>' + '<span class="cnt">' + (t === T_OBJ ? plural(n, 'key', 'keys') : plural(n, 'item', 'items')) + '</span>';
        else h += '<span class="pu fold">' + o + '…' + c + '</span>' + comma + '<span class="cnt">' + (t === T_OBJ ? plural(n, 'key', 'keys') : plural(n, 'item', 'items')) + '</span>';
        return h + '</div>';
      }
      return h + valueHtml(id) + comma + '</div>';
    }

    function valueHtml(id) {
      var d = state.doc, t = d.type[id];
      if (t === T_STR) {
        var s = d.str(id), shown = s.length > STR_MAX ? s.slice(0, STR_MAX) : s;
        var lit = JSON.stringify(shown);
        if (s.length > STR_MAX) lit = lit.slice(0, -1) + '…"';
        var body = hl(lit);
        if (/^https?:\/\/[^\s"<>]+$/i.test(s) && s.length <= 2048) {
          return '<span class="s"><a href="' + esc(s) + '" target="_blank" rel="noopener noreferrer">' + body + '</a></span>' + (s.length > STR_MAX ? '<span class="cnt">' + fmtInt(s.length) + ' chars</span>' : '');
        }
        return '<span class="s">' + body + '</span>' + (s.length > STR_MAX ? '<span class="cnt">' + fmtInt(s.length) + ' chars</span>' : '');
      }
      if (t === T_NUM) {
        var raw = d.raw(id);
        return '<span class="n">' + hl(raw) + '</span>' + (d.isLossy(id) ? '<span class="big" title="JavaScript\'s JSON.parse would change this number to ' + esc(String(Number(raw))) + '. JSON Peek shows it exactly as sent.">exact</span>' : '');
      }
      return '<span class="' + (t === 0 ? 'nl' : 'bo') + '">' + hl(d.raw(id)) + '</span>';
    }

    // ---------- selection & status ----------
    function rowOf(id) {
      var rows = state.rows;
      for (var i = 0; i < state.nrows; i++) if (rows[i] === id) return i;
      return -1;
    }
    function select(id, reveal) {
      state.sel = id;
      if (reveal) revealSel(); else render();
      updateStatus();
    }
    function revealSel() {
      var r = rowOf(state.sel);
      if (r < 0) { render(); return; }
      scrollToRow(r);
    }
    function scrollToRow(r) {
      var m = metrics();
      if (m.k === 0) { render(); return; }
      var ff = scroller.scrollTop * m.k, vis = m.ch / RH;
      if (r < ff) scroller.scrollTop = r / m.k;
      else if (r + 1 > ff + vis) scroller.scrollTop = (r + 1 - vis) / m.k + 0.5;
      render();
    }
    function centerRow(r) {
      var m = metrics();
      if (m.k === 0) { render(); return; }
      scroller.scrollTop = Math.max(0, (r - m.ch / RH / 2)) / m.k;
      render();
    }

    function updateStatus() {
      var d = state.doc;
      if (!d || state.sel < 0) { pathEl.textContent = ''; sinfoEl.textContent = ''; return; }
      var id = state.sel, t = d.type[id];
      pathEl.textContent = d.path(id, state.pathStyle);
      var info;
      if (t === T_OBJ) info = 'object · ' + plural(d.count[id], 'key', 'keys');
      else if (t === T_ARR) info = 'array · ' + plural(d.count[id], 'item', 'items');
      else if (t === T_STR) info = 'string · ' + plural(d.str(id).length, 'char', 'chars');
      else info = d.typeName(id);
      if (t >= T_OBJ) info += ' · ' + fmtBytes(d.stop[id] - d.start[id]);
      sinfoEl.textContent = info;
    }

    function toast(msg) {
      toastEl.textContent = msg;
      toastEl.hidden = false;
      clearTimeout(toast.t);
      toast.t = setTimeout(function () { toastEl.hidden = true; }, 1400);
    }
    function doCopy(text, what) {
      copyText(text, shadow).then(function () { toast('Copied ' + what); }, function () { toast('Copy failed'); });
    }
    function valueText(id) {
      var d = state.doc, t = d.type[id];
      if (t === T_STR) return d.str(id);
      if (t >= T_OBJ) return d.stringify(id, 2);
      return d.raw(id);
    }

    // ---------- search ----------
    function clearSearch(keepInput) {
      state.matches = null; state.matchSet = null; state.cur = -1; state.textQuery = ''; state.keep = null;
      if (!keepInput) input.value = '';
      countEl.textContent = '';
      countEl.classList.remove('bad');
    }

    function runSearch() {
      var d = state.doc;
      if (!d) return;
      var q = input.value.trim();
      var hadKeep = !!state.keep;
      clearSearch(true);
      if (!q) { if (hadKeep) rebuild(); else render(); return; }
      var matches;
      try {
        if (q.charAt(0) === '$') matches = Q.query(d, q, 200000);
        else { state.textQuery = q.toLowerCase(); matches = textSearch(d, state.textQuery, 200000); }
      } catch (e) {
        countEl.textContent = e.name === 'QueryError' ? e.message.replace(/^JSONPath: /, '') : 'error';
        countEl.classList.add('bad');
        if (hadKeep) rebuild(); else render();
        return;
      }
      state.matches = matches;
      state.matchSet = new Uint8Array(d.n);
      for (var i = 0; i < matches.length; i++) state.matchSet[matches[i]] = 1;
      countEl.textContent = matches.length ? '' : 'no matches';
      if (filterEl.checked) applyFilter();
      if (matches.length) gotoMatch(0); else rebuild();
    }

    function textSearch(d, q, limit) {
      if (!LOWER || LOWER.src !== d.text) LOWER = { src: d.text, low: d.text.toLowerCase() };
      var low = LOWER.low, out = [], from = 0, last = -1, ql = q.length;
      if (low.length !== d.text.length) return slowSearch(d, q, limit);
      for (;;) {
        var at = low.indexOf(q, from);
        if (at < 0 || out.length >= limit) break;
        var id = d.nodeAtOffset(at);
        var hit = false;
        if (d.keyStart[id] >= 0 && at >= d.keyStart[id] && at + ql <= d.keyEnd[id]) hit = true;
        else if (d.type[id] < T_OBJ && at >= d.start[id] && at + ql <= d.stop[id]) hit = true;
        if (hit && id !== last) { out.push(id); last = id; }
        from = at + 1;
      }
      return out;
    }
    function slowSearch(d, q, limit) {
      var out = [];
      for (var i = 0; i < d.n && out.length < limit; i++) {
        var k = d.key(i);
        if ((k != null && k.toLowerCase().indexOf(q) >= 0) || (d.type[i] < T_OBJ && (d.type[i] === T_STR ? d.str(i) : d.raw(i)).toLowerCase().indexOf(q) >= 0)) out.push(i);
      }
      return out;
    }

    function applyFilter() {
      var d = state.doc;
      if (!state.matches || !filterEl.checked) { state.keep = null; return; }
      var keep = new Uint8Array(d.n);
      for (var i = 0; i < state.matches.length; i++) {
        var m = state.matches[i];
        keep.fill(1, m, m + d.size[m]);
        for (var p = d.parent[m]; p >= 0 && !keep[p]; p = d.parent[p]) { keep[p] = 1; state.expanded[p] = 1; }
        for (p = d.parent[m]; p >= 0; p = d.parent[p]) state.expanded[p] = 1;
      }
      state.keep = keep;
    }

    function gotoMatch(i) {
      var ms = state.matches;
      if (!ms || !ms.length) return;
      state.cur = (i + ms.length) % ms.length;
      var id = ms[state.cur];
      expandAncestors(id);
      rebuild();
      state.sel = id;
      var r = rowOf(id);
      if (r >= 0) centerRow(r);
      countEl.textContent = (state.cur + 1) + ' / ' + fmtInt(ms.length) + (ms.length >= 200000 ? '+' : '');
      updateStatus();
    }

    // ---------- views ----------
    function setView(v) {
      state.view = v;
      ui.querySelectorAll('.tab').forEach(function (b) {
        var on = b.getAttribute('data-view') === v;
        b.classList.toggle('on', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      var isTree = v === 'tree';
      rawEl.hidden = isTree;
      scroller.hidden = !isTree || !state.doc;
      errEl.hidden = !isTree || !!state.doc;
      if (!isTree && !state.rawFilled) { rawEl.textContent = state.text; state.rawFilled = true; }
      if (isTree) layout();
    }

    // ---------- events ----------
    var raf = 0;
    scroller.addEventListener('scroll', function () {
      if (raf) return;
      raf = requestAnimationFrame(function () { raf = 0; render(); });
    }, { passive: true });

    if (typeof ResizeObserver === 'function') new ResizeObserver(function () { if (state.doc && state.view === 'tree') layout(); }).observe(scroller);

    function rowFromEvent(e) {
      var r = e.target.closest && e.target.closest('.r');
      if (!r) return null;
      var v = state.rows[Number(r.getAttribute('data-r'))];
      return { el: r, id: v < 0 ? -v - 1 : v, close: v < 0 };
    }

    function toggle(id, deep) {
      var d = state.doc;
      if (d.type[id] < T_OBJ || d.count[id] === 0) return;
      var v = state.expanded[id] ? 0 : 1;
      if (deep) setSubtree(id, v); else state.expanded[id] = v;
      rebuild();
    }

    scroller.addEventListener('click', function (e) {
      if (e.target.closest('a')) return;
      var hit = rowFromEvent(e);
      if (!hit) return;
      var sel = (shadow.getSelection ? shadow.getSelection() : window.getSelection());
      if (sel && String(sel).length > 0 && !e.target.closest('[data-tg]')) return;
      state.sel = hit.id;
      var d = state.doc;
      // Clicking a container row (or its closing bracket) folds it; Alt+click folds the whole subtree.
      if (d.type[hit.id] >= T_OBJ && e.detail < 2) toggle(hit.id, e.altKey);
      if (hit.close) { var r = rowOf(hit.id); if (r >= 0) scrollToRow(r); }
      render();
      updateStatus();
      scroller.focus({ preventScroll: true });
    });

    scroller.addEventListener('keydown', function (e) {
      var d = state.doc;
      if (!d || e.target !== scroller) return;
      var r = rowOf(state.sel), id = state.sel, key = e.key;
      var page = Math.max(1, Math.floor(scroller.clientHeight / RH) - 1);
      function moveTo(row) {
        row = Math.max(0, Math.min(state.nrows - 1, row));
        var v = state.rows[row];
        if (v < 0) { v = -v - 1; }
        state.sel = v; scrollToRow(row); updateStatus();
      }
      if (key === 'ArrowDown' || key === 'j') { moveTo(r + 1 + (state.rows[r + 1] < 0 ? 1 : 0)); }
      else if (key === 'ArrowUp' || key === 'k') { moveTo(r - 1 - (r > 0 && state.rows[r - 1] < 0 ? 1 : 0)); }
      else if (key === 'PageDown') moveTo(r + page);
      else if (key === 'PageUp') moveTo(r - page);
      else if (key === 'Home') moveTo(0);
      else if (key === 'End') moveTo(state.nrows - 1);
      else if (key === 'ArrowRight' || key === 'l') {
        if (d.type[id] >= T_OBJ && d.count[id] > 0 && !state.expanded[id]) { toggle(id, e.altKey); revealSel(); }
        else if (d.type[id] >= T_OBJ && d.count[id] > 0) moveTo(r + 1);
      } else if (key === 'ArrowLeft' || key === 'h') {
        if (d.type[id] >= T_OBJ && state.expanded[id] && d.count[id] > 0) { toggle(id, e.altKey); revealSel(); }
        else if (d.parent[id] >= 0) select(d.parent[id], true);
      } else if (key === 'Enter' || key === ' ') { toggle(id, e.altKey); revealSel(); }
      else if ((e.ctrlKey || e.metaKey) && key === 'c') {
        var s = shadow.getSelection ? shadow.getSelection() : window.getSelection();
        if (s && String(s).length) return;
        doCopy(valueText(id), 'value');
      } else if (key === 'n') gotoMatch(state.cur + 1);
      else if (key === 'N') gotoMatch(state.cur - 1);
      else if (key === '/') { input.focus(); input.select(); }
      else if (key === '*') { setSubtree(id, 1); rebuild(); revealSel(); }
      else return;
      e.preventDefault();
    });

    var searchTimer = 0;
    input.addEventListener('input', function () {
      clearTimeout(searchTimer);
      var big = state.text.length > 5e6;
      searchTimer = setTimeout(runSearch, big ? 400 : 120);
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        clearTimeout(searchTimer);
        if (!state.matches || input.value.trim() !== state.lastQ) { state.lastQ = input.value.trim(); runSearch(); }
        else gotoMatch(state.cur + (e.shiftKey ? -1 : 1));
      } else if (e.key === 'Escape') {
        var had = !!state.keep;
        clearSearch();
        if (had) rebuild(); else render();
        scroller.focus({ preventScroll: true });
      }
    });
    $('.next').addEventListener('click', function () { gotoMatch(state.cur + 1); });
    $('.prev').addEventListener('click', function () { gotoMatch(state.cur - 1); });
    filterEl.addEventListener('change', function () {
      if (!state.doc) return;
      if (filterEl.checked) applyFilter(); else state.keep = null;
      rebuild();
      if (state.sel >= 0) revealSel();
    });
    pstyleEl.addEventListener('change', function () { state.pathStyle = pstyleEl.value; saveSettings(); updateStatus(); });

    ui.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      var view = b.getAttribute('data-view');
      if (view) { setView(view); return; }
      var lvl = b.getAttribute('data-lvl');
      if (lvl && state.doc) { expandToLevel(Number(lvl)); return; }
      var act = b.getAttribute('data-act'), d = state.doc;
      switch (act) {
        case 'collapse': if (d) { expandToLevel(1); select(d.root, true); } break;
        case 'expand':
          if (d) expandToLevel(1e9); // cheap even for millions of values: only visible rows are drawn
          break;
        case 'copyall': if (d) doCopy(d.stringify(d.root, 2), 'document'); else doCopy(state.text, 'text'); break;
        case 'save': save(); break;
        case 'theme': setTheme(state.theme === 'auto' ? 'dark' : state.theme === 'dark' ? 'light' : 'auto'); toast('Theme: ' + state.theme); break;
        case 'cpath': if (d && state.sel >= 0) doCopy(d.path(state.sel, state.pathStyle), 'path'); break;
        case 'cval': if (d && state.sel >= 0) doCopy(valueText(state.sel), 'value'); break;
        case 'jsonl': load(state.text, { multi: true }); break;
        case 'showraw': setView('raw'); break;
      }
    });

    function save() {
      var d = state.doc;
      var body = d ? d.stringify(d.root, 2) : state.text;
      var blob = new Blob([body], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = (opts.filename || 'data') + '.json';
      shadow.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    }

    function onDocKey(e) {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key === 'f' && state.view === 'tree' && state.doc) {
        if (shadow.activeElement === input) return; // second Ctrl+F: let the browser's own find bar open
        e.preventDefault();
        input.focus();
        input.select();
      }
    }
    if (opts.captureFind !== false) document.addEventListener('keydown', onDocKey, true);

    loadSettings();

    return {
      load: load,
      get doc() { return state.doc; },
      get state() { return state; },
      expandToLevel: expandToLevel,
      search: function (q) { input.value = q; runSearch(); },
      select: function (id) { expandAncestors(id); rebuild(); select(id, true); },
      setView: setView,
      root: ui,
      destroy: function () { document.removeEventListener('keydown', onDocKey, true); shadow.innerHTML = ''; }
    };
  }

  NS.createViewer = createViewer;
})(typeof self !== 'undefined' ? self : this);
