// Web tool: paste / open / drop JSON, view it, format or minify it. Runs entirely locally.
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var input = $('input'), multi = $('multi'), sort = $('sort'), indentSel = $('indent'), note = $('note');
  var storage = {
    get: function (k) { try { return JSON.parse(localStorage.getItem('jsonpeek.' + k)); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem('jsonpeek.' + k, JSON.stringify(v)); } catch (e) { /* private mode */ } }
  };
  var viewer = JSONPeek.createViewer($('viewer'), { storage: storage, filename: 'formatted' });
  var text = '';          // the current document text (may be larger than what the textarea holds)
  var inTextarea = true;  // false when a big file was opened and kept out of the textarea
  var TEXTAREA_MAX = 1500000;

  var SAMPLE = '{\n  "id": 1428935717813211136,\n  "jsonParseWouldShow": 1428935717813211100,\n  "user": {"name": "Ada", "email": "ada@example.com", "roles": ["admin", "dev"], "active": true},\n' +
    '  "10": "numeric keys stay in place", "2": "JSON.parse would move these to the top",\n' +
    '  "orders": [\n    {"sku": "A-1", "price": 12.5, "qty": 2, "tags": ["new"]},\n    {"sku": "B-7", "price": 7.25, "qty": 1, "tags": []},\n    {"sku": "C-3", "price": 99.0, "qty": 5, "tags": ["sale", "bulk"]}\n  ],\n' +
    '  "homepage": "https://example.com/docs?q=json",\n  "unicode": "caf\\u00e9 \\u2603",\n  "nothing": null,\n  "ratio": 0.30000000000000004\n}';

  function indent() { var v = indentSel.value; return v === 'tab' ? '\t' : Number(v); }
  function show() {
    if (!text.trim()) { viewer.load('{}'); return; }
    var res = viewer.load(text, { multi: multi.checked });
    if (res.ok && sort.checked) viewer.load(res.doc.stringify(res.doc.root, 2, true), { multi: false });
  }
  function setText(t, fromFile) {
    text = t;
    inTextarea = t.length <= TEXTAREA_MAX;
    input.value = inTextarea ? t : '';
    input.placeholder = inTextarea ? input.placeholder : (fromFile || 'Document') + ' (' + (t.length / 1048576).toFixed(1) + ' MB) is loaded below. Paste here to replace it.';
    show();
  }
  function rewrite(ind) {
    var res = viewer.load(text, { multi: multi.checked });
    if (!res.ok) return;
    var d = res.doc, out;
    if (d.multi && ind === 0) out = d.children(d.root).map(function (c) { return d.stringify(c, 0, sort.checked); }).join('\n');
    else out = d.stringify(d.root, ind, sort.checked);
    if (d.multi && ind !== 0) multi.checked = false;
    setText(out);
  }

  var timer = 0;
  input.addEventListener('input', function () {
    clearTimeout(timer);
    timer = setTimeout(function () { text = input.value; inTextarea = true; show(); }, input.value.length > 200000 ? 400 : 150);
  });
  [multi, sort].forEach(function (c) { c.addEventListener('change', show); });
  $('format').addEventListener('click', function () { rewrite(indent()); });
  $('minify').addEventListener('click', function () { rewrite(0); });
  $('sample').addEventListener('click', function () { multi.checked = false; setText(SAMPLE); });
  $('clear').addEventListener('click', function () { setText(''); input.focus(); });

  function readFile(f) {
    note.textContent = 'Reading ' + f.name + '…';
    var r = new FileReader();
    r.onload = function () {
      if (/\.(jsonl|ndjson)$/i.test(f.name)) multi.checked = true;
      setText(String(r.result), f.name);
      note.textContent = 'Opened ' + f.name + ' locally. Nothing was uploaded.';
    };
    r.onerror = function () { note.textContent = 'Could not read ' + f.name; };
    r.readAsText(f);
  }
  $('file').addEventListener('change', function (e) { if (e.target.files[0]) readFile(e.target.files[0]); e.target.value = ''; });
  document.addEventListener('dragover', function (e) { e.preventDefault(); document.body.classList.add('drag'); });
  document.addEventListener('dragleave', function (e) { if (!e.relatedTarget) document.body.classList.remove('drag'); });
  document.addEventListener('drop', function (e) {
    e.preventDefault(); document.body.classList.remove('drag');
    var f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) readFile(f); else if (e.dataTransfer.getData('text')) setText(e.dataTransfer.getData('text'));
  });

  setText(SAMPLE);
  if (document.body.dataset.query) viewer.search(document.body.dataset.query);
  window.__jsonPeek = viewer;
})();
