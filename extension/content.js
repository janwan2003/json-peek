/*
 * JSON Peek content script. Runs on every page but does nothing unless the page
 * is a raw JSON document (what the browser shows when you open an API URL).
 * It reads the text already on the page; it never makes network requests.
 */
(function () {
  'use strict';
  if (window.__jsonPeekLoaded || window.top !== window) return;
  window.__jsonPeekLoaded = true;

  var ct = (document.contentType || '').toLowerCase();
  var JSON_TYPES = /^(application|text)\/(.+\+)?(x-)?json$|^application\/(x-)?(ndjson|jsonl|json-seq|jsonlines)$|^application\/(.+\+)?json(-patch)?$/;
  var LINES_TYPES = /ndjson|jsonl|json-seq|jsonlines/;
  var MAYBE_TYPES = /^text\/plain$|^(application|text)\/(x-)?javascript$|^application\/octet-stream$/;
  var isJsonType = JSON_TYPES.test(ct) || LINES_TYPES.test(ct);
  var maybe = MAYBE_TYPES.test(ct);
  if (!isJsonType && !maybe) return;

  var hideStyle = null;
  if (isJsonType) {
    // Hide the browser's plain-text rendering until the viewer is ready, to avoid a flash.
    hideStyle = document.createElement('style');
    hideStyle.textContent = 'body > pre, body > div { visibility: hidden !important; }';
    (document.head || document.documentElement).appendChild(hideStyle);
  }
  function unhide() { if (hideStyle) { hideStyle.remove(); hideStyle = null; } }

  function rawText() {
    var body = document.body;
    if (!body) return null;
    var pre = null;
    for (var i = 0; i < body.children.length; i++) {
      var c = body.children[i];
      if (c.tagName === 'PRE' && !pre) pre = c;
      else if (c.tagName === 'DIV' && /json-formatter-container/.test(c.className)) continue; // Chrome's own pretty-print toggle
      else if (c.tagName === 'STYLE' || c.tagName === 'SCRIPT' || c.tagName === 'LINK') continue;
      else return null; // not a plain text document
    }
    return pre ? pre.textContent : null;
  }

  function looksLikeJson(t) {
    var s = t.slice(0, 300).replace(/^﻿/, '').trimStart();
    return /^[\[{]/.test(s) || /^\)\]\}'/.test(s) || /^[A-Za-z_$][\w$.]*\s*\(\s*[\[{]/.test(s);
  }

  function start() {
    var text = rawText();
    if (text == null || (!isJsonType && !looksLikeJson(text))) { unhide(); return; }
    var NS = window.JSONPeek;
    var multi = LINES_TYPES.test(ct) || /\.(jsonl|ndjson)$/i.test(location.pathname);
    // Decide between one JSON value and JSON Lines; for text/plain etc. only take over if it parses.
    var doc = null, t0 = performance.now();
    try { doc = NS.core.parse(text, { multi: multi }); } catch (e) {
      if (!multi) { try { doc = NS.core.parse(text, { multi: true }); if (doc.count[0] < 2) doc = null; } catch (e2) { doc = null; } }
      if (doc) multi = true;
      else if (!isJsonType) { unhide(); return; }
    }
    var parseMs = performance.now() - t0;
    var storage = {
      get: function (k) { return new Promise(function (res) { try { chrome.storage.local.get(k, function (o) { res(o && o[k]); }); } catch (e) { res(null); } }); },
      set: function (k, v) { var o = {}; o[k] = v; try { chrome.storage.local.set(o); } catch (e) { /* ignore */ } }
    };
    document.body.innerHTML = '';
    var html = document.documentElement;
    html.style.height = '100%';
    document.body.style.cssText = 'margin:0;height:100%;';
    var host = document.createElement('div');
    host.id = 'json-peek-root';
    host.style.cssText = 'height:100vh;';
    document.body.appendChild(host);
    unhide();
    var name = (location.pathname.split('/').pop() || location.hostname || 'data').replace(/\.json$/i, '').replace(/[^\w.-]+/g, '_').slice(0, 80) || 'data';
    var viewer = NS.createViewer(host, { storage: storage, filename: name });
    viewer.load(text, { multi: multi, doc: doc, parseMs: parseMs });
    window.__jsonPeek = viewer;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
