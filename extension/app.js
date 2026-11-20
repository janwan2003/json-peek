// Standalone viewer page: paste or drop JSON. Everything stays on this device.
(function () {
  'use strict';
  var input = document.getElementById('input'), multi = document.getElementById('multi');
  var storage = typeof chrome !== 'undefined' && chrome.storage ? {
    get: function (k) { return new Promise(function (res) { chrome.storage.local.get(k, function (o) { res(o && o[k]); }); }); },
    set: function (k, v) { var o = {}; o[k] = v; chrome.storage.local.set(o); }
  } : null;
  var viewer = JSONPeek.createViewer(document.getElementById('viewer'), { storage: storage });
  var timer = 0;
  function show() {
    var t = input.value;
    if (!t.trim()) return;
    viewer.load(t, { multi: multi.checked });
  }
  input.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(show, 200); });
  multi.addEventListener('change', show);
  function readFile(f) {
    var r = new FileReader();
    r.onload = function () {
      input.value = r.result.length > 2e6 ? '' : r.result;
      input.placeholder = r.result.length > 2e6 ? f.name + ' (' + (r.result.length / 1048576).toFixed(1) + ' MB) loaded below' : input.placeholder;
      if (/\.(jsonl|ndjson)$/i.test(f.name)) multi.checked = true;
      viewer.load(r.result, { multi: multi.checked });
    };
    r.readAsText(f);
  }
  document.getElementById('file').addEventListener('change', function (e) { if (e.target.files[0]) readFile(e.target.files[0]); });
  document.getElementById('clear').addEventListener('click', function () { input.value = ''; viewer.load('{}'); input.focus(); });
  document.addEventListener('dragover', function (e) { e.preventDefault(); });
  document.addEventListener('drop', function (e) { e.preventDefault(); var f = e.dataTransfer.files[0]; if (f) readFile(f); });
  viewer.load('{"tip": "Paste JSON above or drop a .json / .jsonl file anywhere on this page"}');
})();
