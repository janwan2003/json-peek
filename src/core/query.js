/*
 * JSON Peek: a JSONPath subset evaluated directly on the indexed Doc.
 * Supported: $  .key  ['key']  [n]  [-n]  [a:b]  [*]  .*  ..key  ..*  [0,2]  ['a','b']
 *            [?(@.x)]  [?(@.x.y <op> literal)] with ==, !=, <, <=, >, >=
 * Returns matching node ids in document order.
 */
(function (root) {
  'use strict';
  var T_OBJ = 5, T_ARR = 6;

  function QueryError(msg, at) {
    this.name = 'QueryError';
    this.message = 'JSONPath: ' + msg + (at != null ? ' (at character ' + (at + 1) + ')' : '');
  }
  QueryError.prototype = Object.create(Error.prototype);

  function compile(q) {
    var i = 0, steps = [];
    q = q.trim();
    if (q.charAt(0) !== '$') throw new QueryError('must start with $', 0);
    i = 1;
    function ident() {
      var m = /^[^.\[\]\s()=!<>,'"]+/.exec(q.slice(i));
      if (!m) throw new QueryError('expected a name', i);
      i += m[0].length;
      return m[0];
    }
    function quoted() {
      var qc = q.charAt(i), j = i + 1, s = '';
      while (j < q.length && q.charAt(j) !== qc) {
        if (q.charAt(j) === '\\') { s += q.charAt(j + 1); j += 2; } else { s += q.charAt(j++); }
      }
      if (j >= q.length) throw new QueryError('unterminated string', i);
      i = j + 1;
      return s;
    }
    function literal() {
      var rest = q.slice(i), m;
      if (rest.charAt(0) === '"' || rest.charAt(0) === "'") return quoted();
      if ((m = /^-?\d+(\.\d+)?([eE][+-]?\d+)?/.exec(rest))) { i += m[0].length; return Number(m[0]); }
      if ((m = /^(true|false|null)/.exec(rest))) { i += m[0].length; return m[0] === 'true' ? true : m[0] === 'false' ? false : null; }
      throw new QueryError('expected a value', i);
    }
    function ws() { while (q.charAt(i) === ' ') i++; }
    function bracket() {
      i++; ws();
      var c = q.charAt(i), sel;
      if (c === '*') { i++; sel = { k: 'wild' }; }
      else if (c === '?') {
        i++; ws();
        var paren = q.charAt(i) === '(';
        if (paren) i++;
        ws();
        if (q.charAt(i) !== '@') throw new QueryError('filter must start with @', i);
        i++;
        var rel = [];
        while (q.charAt(i) === '.' || q.charAt(i) === '[') {
          if (q.charAt(i) === '.') { i++; rel.push(ident()); }
          else { i++; ws(); rel.push(q.charAt(i) === '"' || q.charAt(i) === "'" ? quoted() : Number(ident())); ws(); if (q.charAt(i) !== ']') throw new QueryError('expected ]', i); i++; }
        }
        ws();
        var m = /^(==|!=|<=|>=|<|>|=)/.exec(q.slice(i)), op = null, val;
        if (m) { op = m[0] === '=' ? '==' : m[0]; i += m[0].length; ws(); val = literal(); ws(); }
        if (paren) { if (q.charAt(i) !== ')') throw new QueryError('expected )', i); i++; ws(); }
        sel = { k: 'filter', rel: rel, op: op, val: val };
      } else {
        var items = [];
        for (;;) {
          ws();
          c = q.charAt(i);
          if (c === '"' || c === "'") items.push({ k: 'name', name: quoted() });
          else {
            var m2 = /^(-?\d*)\s*(?::\s*(-?\d*))?(?:\s*:\s*(-?\d*))?/.exec(q.slice(i));
            if (!m2 || m2[0] === '') throw new QueryError('unexpected ' + JSON.stringify(c || 'end'), i);
            i += m2[0].length;
            if (m2[2] === undefined) items.push({ k: 'index', n: Number(m2[1]) });
            else items.push({ k: 'slice', a: m2[1] === '' ? null : Number(m2[1]), b: m2[2] === '' ? null : Number(m2[2]), s: m2[3] ? Number(m2[3]) : 1 });
          }
          ws();
          if (q.charAt(i) === ',') { i++; continue; }
          break;
        }
        sel = items.length === 1 ? items[0] : { k: 'union', items: items };
      }
      ws();
      if (q.charAt(i) !== ']') throw new QueryError('expected ]', i);
      i++;
      return sel;
    }
    while (i < q.length) {
      var c = q.charAt(i), desc = false;
      if (c === '.') {
        i++;
        if (q.charAt(i) === '.') { desc = true; i++; }
        if (q.charAt(i) === '*') { i++; steps.push({ desc: desc, sel: { k: 'wild' } }); }
        else if (q.charAt(i) === '[') steps.push({ desc: desc, sel: bracket() });
        else steps.push({ desc: desc, sel: { k: 'name', name: ident() } });
      } else if (c === '[') {
        steps.push({ desc: false, sel: bracket() });
      } else if (c === ' ') {
        i++;
      } else {
        throw new QueryError('unexpected ' + JSON.stringify(c), i);
      }
    }
    return steps;
  }

  function query(doc, q, limit) {
    var steps = compile(q);
    limit = limit || 1e6;
    var cur = [doc.root];
    for (var s = 0; s < steps.length; s++) {
      var st = steps[s];
      if (st.desc) cur = descendantsOrSelf(doc, cur);
      var next = [];
      for (var j = 0; j < cur.length && next.length < limit; j++) select(doc, cur[j], st.sel, next);
      cur = st.desc ? sortUnique(next) : next;
    }
    return cur.length > limit ? cur.slice(0, limit) : cur;
  }

  function sortUnique(a) {
    a.sort(function (x, y) { return x - y; });
    var out = [];
    for (var i = 0; i < a.length; i++) if (i === 0 || a[i] !== a[i - 1]) out.push(a[i]);
    return out;
  }

  function descendantsOrSelf(doc, ids) {
    var out = [], lastEnd = -1;
    ids = sortUnique(ids.slice());
    for (var j = 0; j < ids.length; j++) {
      var a = ids[j], e = a + doc.size[a];
      if (a < lastEnd) continue; // already covered by an ancestor
      for (var k = a; k < e; k++) if (doc.type[k] >= T_OBJ) out.push(k);
      lastEnd = e;
    }
    return out;
  }

  function select(doc, id, sel, out) {
    var t = doc.type[id];
    if (t < T_OBJ) return;
    var c, e;
    switch (sel.k) {
      case 'name':
        if (t === T_OBJ) { c = doc.childByKey(id, sel.name); if (c >= 0) out.push(c); }
        else if (/^-?\d+$/.test(sel.name)) { c = doc.childAt(id, Number(sel.name)); if (c >= 0) out.push(c); }
        return;
      case 'wild':
        for (c = id + 1, e = id + doc.size[id]; c < e; c += doc.size[c]) out.push(c);
        return;
      case 'index':
        if (t === T_ARR) { c = doc.childAt(id, sel.n); if (c >= 0) out.push(c); }
        return;
      case 'slice': {
        if (t !== T_ARR) return;
        var len = doc.count[id], step = sel.s || 1;
        if (step <= 0) return;
        var a = sel.a == null ? 0 : sel.a < 0 ? Math.max(0, len + sel.a) : Math.min(sel.a, len);
        var b = sel.b == null ? len : sel.b < 0 ? Math.max(0, len + sel.b) : Math.min(sel.b, len);
        c = doc.childAt(id, a);
        for (var k = a; k < b && c >= 0; k++) {
          if ((k - a) % step === 0) out.push(c);
          c += doc.size[c];
        }
        return;
      }
      case 'union':
        for (var u = 0; u < sel.items.length; u++) select(doc, id, sel.items[u], out);
        return;
      case 'filter':
        for (c = id + 1, e = id + doc.size[id]; c < e; c += doc.size[c]) {
          if (testFilter(doc, c, sel)) out.push(c);
        }
        return;
    }
  }

  function testFilter(doc, id, sel) {
    var n = id;
    for (var r = 0; r < sel.rel.length && n >= 0; r++) {
      var part = sel.rel[r];
      if (doc.type[n] === T_OBJ) n = doc.childByKey(n, String(part));
      else if (doc.type[n] === T_ARR && /^-?\d+$/.test(String(part))) n = doc.childAt(n, Number(part));
      else n = -1;
    }
    if (n < 0) return false;
    if (!sel.op) return true;
    if (doc.type[n] >= T_OBJ) return false;
    var v = doc.toValue(n), w = sel.val;
    switch (sel.op) {
      case '==': return v === w;
      case '!=': return v !== w;
      case '<': return typeof v === typeof w && v < w;
      case '<=': return typeof v === typeof w && v <= w;
      case '>': return typeof v === typeof w && v > w;
      case '>=': return typeof v === typeof w && v >= w;
    }
    return false;
  }

  var api = { query: query, compile: compile, QueryError: QueryError };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.JSONPeek = root.JSONPeek || {}; root.JSONPeek.query = api; }
})(typeof self !== 'undefined' ? self : this);
