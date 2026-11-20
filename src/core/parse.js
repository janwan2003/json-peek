/*
 * JSON Peek: lossless indexed JSON parser.
 *
 * Instead of building JS objects (which is what JSON.parse does, rounding numbers
 * beyond 2^53 and reordering integer-like keys), this parser records every value
 * as a node in flat typed arrays that point back into the source text. Nodes are
 * stored in document (pre-order) order, so a node's subtree is the contiguous
 * range [id, id + size[id]). Strings are decoded lazily, only when shown.
 *
 * Memory: about 39 bytes per node plus the source string itself.
 */
(function (root) {
  'use strict';

  var T_NULL = 0, T_FALSE = 1, T_TRUE = 2, T_NUM = 3, T_STR = 4, T_OBJ = 5, T_ARR = 6;
  var F_VAL_ESC = 1, F_KEY_ESC = 2, F_LOSSY = 4;
  var TYPE_NAMES = ['null', 'boolean', 'boolean', 'number', 'string', 'object', 'array'];

  function ParseError(message, pos, text) {
    var lc = lineCol(text, pos);
    this.name = 'ParseError';
    this.message = message + ' at line ' + lc.line + ', column ' + lc.col;
    this.reason = message;
    this.pos = pos;
    this.line = lc.line;
    this.col = lc.col;
  }
  ParseError.prototype = Object.create(Error.prototype);

  function lineCol(text, pos) {
    var line = 1, last = -1;
    for (var i = 0; i < pos && i < text.length; i++) {
      if (text.charCodeAt(i) === 10) { line++; last = i; }
    }
    return { line: line, col: pos - last };
  }

  function grow(a, n) {
    var b = new a.constructor(n);
    b.set(a);
    return b;
  }

  /*
   * Recognised wrappers. Returns {start, end, kind} of the JSON payload in text.
   * - XSSI guards: )]}' , while(1); , for(;;);
   * - JSONP: callbackName( ... ) with optional trailing semicolon
   */
  function detectWrapper(text) {
    var i = 0, n = text.length;
    if (text.charCodeAt(0) === 0xfeff) i = 1;
    var head = text.slice(i, i + 16);
    var m = /^\)\]\}'[^\n]*\n?/.exec(head) || /^while\s*\(\s*1\s*\)\s*;/.exec(head) || /^for\s*\(\s*;\s*;\s*\)\s*;/.exec(head);
    if (m) return { start: i + m[0].length, end: n, kind: 'xssi', prefix: text.slice(0, i + m[0].length) };
    var j = /^\s*[A-Za-z_$][\w$.]*\s*\(/.exec(text.slice(i, i + 256));
    if (j) {
      var e = n;
      while (e > 0 && /[\s;]/.test(text[e - 1])) e--;
      if (text[e - 1] === ')') return { start: i + j[0].length, end: e - 1, kind: 'jsonp', prefix: text.slice(0, i + j[0].length) };
    }
    return { start: i, end: n, kind: null, prefix: '' };
  }

  /**
   * parse(text, opts) -> Doc
   * opts.multi: if true, accept several whitespace/newline separated top-level
   *             values (JSON Lines / NDJSON) and wrap them in a synthetic array.
   * opts.unwrap: if true (default), strip XSSI guards and JSONP callbacks.
   * Throws ParseError on invalid input.
   */
  function parse(text, opts) {
    opts = opts || {};
    var wrap = opts.unwrap === false ? { start: 0, end: text.length, kind: null, prefix: '' } : detectWrapper(text);
    if (wrap.kind === null && text.charCodeAt(0) === 0xfeff) wrap.start = 1;
    var pos = wrap.start, end = wrap.end;

    var cap = Math.max(64, Math.min(1 << 24, (end - pos) >> 3));
    var type = new Uint8Array(cap), flags = new Uint8Array(cap);
    var start = new Int32Array(cap), stop = new Int32Array(cap);
    var keyStart = new Int32Array(cap), keyEnd = new Int32Array(cap);
    var parent = new Int32Array(cap), size = new Int32Array(cap);
    var count = new Int32Array(cap), index = new Int32Array(cap);
    var depth = new Int32Array(cap);
    var n = 0;
    var maxDepth = 0;

    function ensure() {
      if (n < cap) return;
      cap = cap * 2;
      type = grow(type, cap); flags = grow(flags, cap);
      start = grow(start, cap); stop = grow(stop, cap);
      keyStart = grow(keyStart, cap); keyEnd = grow(keyEnd, cap);
      parent = grow(parent, cap); size = grow(size, cap);
      count = grow(count, cap); index = grow(index, cap);
      depth = grow(depth, cap);
    }

    function fail(msg, at) { throw new ParseError(msg, at, text); }

    function skipWs() {
      while (pos < end) {
        var c = text.charCodeAt(pos);
        if (c === 32 || c === 10 || c === 13 || c === 9) pos++;
        else break;
      }
    }

    // Scans a string starting at the opening quote. Returns true if it had escapes.
    function scanString() {
      var esc = false;
      pos++;
      for (;;) {
        if (pos >= end) fail('Unterminated string', pos);
        var c = text.charCodeAt(pos);
        if (c === 34) { pos++; return esc; }
        if (c === 92) {
          esc = true;
          var d = text.charCodeAt(pos + 1);
          if (d === 117) {
            for (var k = 2; k < 6; k++) {
              var h = text.charCodeAt(pos + k);
              if (!((h >= 48 && h <= 57) || (h >= 65 && h <= 70) || (h >= 97 && h <= 102))) fail('Invalid \\u escape', pos);
            }
            pos += 6;
          } else if (d === 34 || d === 92 || d === 47 || d === 98 || d === 102 || d === 110 || d === 114 || d === 116) {
            pos += 2;
          } else {
            fail('Invalid escape sequence', pos);
          }
        } else if (c < 32) {
          fail('Unescaped control character in string', pos);
        } else {
          pos++;
        }
      }
    }

    // Scans a number; returns F_LOSSY if JS doubles cannot hold it exactly.
    function scanNumber() {
      var s = pos;
      if (text.charCodeAt(pos) === 45) pos++;
      var c = text.charCodeAt(pos);
      if (c === 48) {
        pos++;
      } else if (c >= 49 && c <= 57) {
        while (pos < end && (c = text.charCodeAt(pos)) >= 48 && c <= 57) pos++;
      } else {
        fail('Invalid number', s);
      }
      var hasExp = false;
      if (text.charCodeAt(pos) === 46) {
        pos++;
        c = text.charCodeAt(pos);
        if (!(c >= 48 && c <= 57)) fail('Expected digit after decimal point', pos);
        while (pos < end && (c = text.charCodeAt(pos)) >= 48 && c <= 57) pos++;
      }
      c = text.charCodeAt(pos);
      if (c === 101 || c === 69) {
        hasExp = true;
        pos++;
        c = text.charCodeAt(pos);
        if (c === 43 || c === 45) pos++;
        c = text.charCodeAt(pos);
        if (!(c >= 48 && c <= 57)) fail('Expected digit in exponent', pos);
        while (pos < end && (c = text.charCodeAt(pos)) >= 48 && c <= 57) pos++;
      }
      if (pos - s > 15 || hasExp) return isLossy(text.slice(s, pos)) ? F_LOSSY : 0;
      return 0;
    }

    function expectLiteral(word, t) {
      if (text.substr(pos, word.length) !== word) fail('Unexpected token', pos);
      pos += word.length;
      return t;
    }

    // Explicit stack of open containers, so deep nesting cannot overflow the JS stack.
    var stack = new Int32Array(1024), sp = 0;
    var multi = !!opts.multi;
    var rootId = -1;

    if (multi) {
      ensure();
      type[0] = T_ARR; start[0] = pos; keyStart[0] = -1; keyEnd[0] = -1; parent[0] = -1; depth[0] = 0;
      n = 1; rootId = 0;
      stack[sp++] = 0;
    }

    skipWs();
    if (pos >= end) fail(multi ? 'No JSON values found' : 'Empty input', pos);

    var pendingKeyStart = -1, pendingKeyEnd = -1, pendingKeyEsc = false;

    for (;;) {
      // Expect a value here.
      skipWs();
      if (pos >= end) fail('Unexpected end of input', pos);
      ensure();
      var id = n++;
      var p = sp > 0 ? stack[sp - 1] : -1;
      parent[id] = p;
      keyStart[id] = pendingKeyStart; keyEnd[id] = pendingKeyEnd;
      flags[id] = pendingKeyEsc ? F_KEY_ESC : 0;
      pendingKeyStart = -1; pendingKeyEnd = -1; pendingKeyEsc = false;
      var dp = sp;
      depth[id] = dp;
      if (dp > maxDepth) maxDepth = dp;
      if (p >= 0) { index[id] = count[p]; count[p]++; } else { index[id] = 0; if (rootId < 0) rootId = id; }
      start[id] = pos;
      var c = text.charCodeAt(pos);
      var container = false;
      if (c === 123 || c === 91) {
        type[id] = c === 123 ? T_OBJ : T_ARR;
        count[id] = 0;
        pos++;
        if (sp === stack.length) stack = grow(stack, sp * 2);
        stack[sp++] = id;
        container = true;
      } else if (c === 34) {
        type[id] = T_STR;
        if (scanString()) flags[id] |= F_VAL_ESC;
      } else if (c === 45 || (c >= 48 && c <= 57)) {
        type[id] = T_NUM;
        flags[id] |= scanNumber();
      } else if (c === 116) {
        type[id] = expectLiteral('true', T_TRUE);
      } else if (c === 102) {
        type[id] = expectLiteral('false', T_FALSE);
      } else if (c === 110) {
        type[id] = expectLiteral('null', T_NULL);
      } else {
        fail(c === 125 || c === 93 ? 'Unexpected closing bracket (trailing comma?)' : 'Unexpected character ' + JSON.stringify(text[pos]), pos);
      }
      if (!container) { stop[id] = pos; size[id] = 1; }

      // After a value (or after opening a container): find what comes next.
      for (;;) {
        skipWs();
        if (sp === 0) {
          if (pos < end) {
            fail('Unexpected data after the JSON value (is this JSON Lines? try the JSON Lines mode)', pos);
          }
          return finish();
        }
        var top = stack[sp - 1];
        var isObj = type[top] === T_OBJ;
        if (multi && sp === 1) {
          if (pos >= end) { stop[0] = end; size[0] = n; sp = 0; return finish(); }
          var prev = text.charCodeAt(pos - 1);
          if (!(prev === 32 || prev === 10 || prev === 13 || prev === 9 || prev === 125 || prev === 93 || prev === 34 || text.charCodeAt(pos) === 44)) {
            fail('Expected a line break between JSON Lines values', pos);
          }
          if (text.charCodeAt(pos) === 44) { pos++; skipWs(); } // tolerate commas between lines
          break; // next top-level value
        }
        if (pos >= end) fail('Unexpected end of input: ' + (isObj ? '}' : ']') + ' expected', pos);
        c = text.charCodeAt(pos);
        var closeCh = isObj ? 125 : 93;
        if (c === closeCh) {
          pos++;
          stop[top] = pos;
          size[top] = n - top;
          sp--;
          container = false;
          continue;
        }
        if (container && top === id) {
          // First entry of a freshly opened container: no comma expected.
          container = false;
        } else {
          if (c !== 44) fail('Expected , or ' + (isObj ? '}' : ']'), pos);
          pos++;
          skipWs();
        }
        if (isObj) {
          if (text.charCodeAt(pos) !== 34) fail(text.charCodeAt(pos) === 125 ? 'Trailing comma before }' : 'Expected a double-quoted property name', pos);
          pendingKeyStart = pos;
          pendingKeyEsc = scanString();
          pendingKeyEnd = pos;
          skipWs();
          if (text.charCodeAt(pos) !== 58) fail('Expected : after property name', pos);
          pos++;
        } else if (text.charCodeAt(pos) === 93) {
          fail('Trailing comma before ]', pos);
        }
        break;
      }
    }

    function finish() {
      return new Doc(text, {
        n: n, root: rootId, wrapper: wrap, multi: multi, maxDepth: maxDepth,
        type: type, flags: flags, start: start, stop: stop, keyStart: keyStart, keyEnd: keyEnd,
        parent: parent, size: size, count: count, index: index, depth: depth
      });
    }
  }

  // A number token is lossy if the nearest double prints as a different decimal value.
  function isLossy(tok) {
    var v = Number(tok);
    if (!isFinite(v)) return true;
    var a = normNum(tok), b = normNum(String(v));
    return a.d !== b.d || (a.d !== '' && a.e !== b.e);
  }
  function normNum(s) {
    s = s.replace(/^-/, '');
    var e = 0, k = s.search(/[eE]/);
    if (k >= 0) { e = parseInt(s.slice(k + 1), 10); s = s.slice(0, k); }
    var dot = s.indexOf('.');
    var ip = dot >= 0 ? s.slice(0, dot) : s, fp = dot >= 0 ? s.slice(dot + 1) : '';
    var d = ip + fp; e += ip.length;
    var lead = d.match(/^0*/)[0].length;
    d = d.slice(lead); e -= lead;
    d = d.replace(/0+$/, '');
    return { d: d, e: e };
  }

  function Doc(text, d) {
    this.text = text;
    for (var k in d) this[k] = d[k];
  }

  Doc.prototype.typeName = function (id) { return TYPE_NAMES[this.type[id]]; };
  Doc.prototype.isContainer = function (id) { return this.type[id] >= T_OBJ; };
  Doc.prototype.raw = function (id) { return this.text.slice(this.start[id], this.stop[id]); };
  Doc.prototype.rawKey = function (id) { return this.keyStart[id] < 0 ? null : this.text.slice(this.keyStart[id], this.keyEnd[id]); };

  Doc.prototype.key = function (id) {
    var ks = this.keyStart[id];
    if (ks < 0) return null;
    if (this.flags[id] & F_KEY_ESC) return JSON.parse(this.text.slice(ks, this.keyEnd[id]));
    return this.text.slice(ks + 1, this.keyEnd[id] - 1);
  };

  Doc.prototype.str = function (id) {
    if (this.flags[id] & F_VAL_ESC) return JSON.parse(this.text.slice(this.start[id], this.stop[id]));
    return this.text.slice(this.start[id] + 1, this.stop[id] - 1);
  };

  Doc.prototype.isLossy = function (id) { return (this.flags[id] & F_LOSSY) !== 0; };

  Doc.prototype.children = function (id) {
    var out = [], c = id + 1, e = id + this.size[id];
    while (c < e) { out.push(c); c += this.size[c]; }
    return out;
  };

  Doc.prototype.childByKey = function (id, key) {
    var c = id + 1, e = id + this.size[id];
    while (c < e) { if (this.key(c) === key) return c; c += this.size[c]; }
    return -1;
  };

  Doc.prototype.childAt = function (id, i) {
    if (i < 0) i += this.count[id];
    if (i < 0 || i >= this.count[id]) return -1;
    var c = id + 1;
    while (i-- > 0) c += this.size[c];
    return c;
  };

  Doc.prototype.ancestors = function (id) {
    var out = [];
    for (var p = this.parent[id]; p >= 0; p = this.parent[p]) out.push(p);
    return out;
  };

  var IDENT = /^[A-Za-z_$][\w$]*$/;
  /** style: 'jsonpath' ($.a[0].b), 'js' (a[0].b), 'jq' (.a[0].b) */
  Doc.prototype.path = function (id, style) {
    style = style || 'jsonpath';
    var parts = [];
    for (var c = id; c >= 0 && this.parent[c] >= 0; c = this.parent[c]) {
      var p = this.parent[c];
      if (this.type[p] === T_ARR) parts.push('[' + this.index[c] + ']');
      else {
        var k = this.key(c);
        if (IDENT.test(k)) parts.push('.' + k);
        else parts.push('[' + JSON.stringify(k) + ']');
      }
    }
    parts.reverse();
    var s = parts.join('');
    if (style === 'js') return s.charAt(0) === '.' ? s.slice(1) : s;
    if (style === 'jq') return s === '' ? '.' : (s.charAt(0) === '[' ? '.' + s : s);
    return '$' + s;
  };

  /** Find the deepest node whose key or primitive token contains source offset `off`. */
  Doc.prototype.nodeAtOffset = function (off) {
    var lo = 0, hi = this.n - 1, ks = this.keyStart, st = this.start;
    while (lo < hi) {
      var mid = (lo + hi + 1) >> 1;
      var t = ks[mid] >= 0 ? ks[mid] : st[mid];
      if (t <= off) lo = mid; else hi = mid - 1;
    }
    return lo;
  };

  /**
   * Serialise a subtree. Primitive tokens are copied from the source, so numbers
   * are never rounded. indent: number of spaces, '\t', or 0 for minified.
   */
  Doc.prototype.stringify = function (id, indent, sortKeys) {
    var self = this, text = this.text, out = [];
    var unit = indent === '\t' ? '\t' : (indent > 0 ? new Array(indent + 1).join(' ') : '');
    var nl = unit ? '\n' : '';
    var colon = unit ? ': ' : ':';
    function rec(i, pad) {
      var t = self.type[i];
      if (t < T_OBJ) { out.push(text.slice(self.start[i], self.stop[i])); return; }
      var open = t === T_OBJ ? '{' : '[', close = t === T_OBJ ? '}' : ']';
      if (self.count[i] === 0) { out.push(open + close); return; }
      var kids = self.children(i);
      if (sortKeys && t === T_OBJ) kids.sort(function (a, b) { var x = self.key(a), y = self.key(b); return x < y ? -1 : x > y ? 1 : 0; });
      var inner = pad + unit;
      out.push(open);
      for (var j = 0; j < kids.length; j++) {
        out.push(j ? ',' + nl + inner : nl + inner);
        var k = kids[j];
        if (t === T_OBJ) out.push(text.slice(self.keyStart[k], self.keyEnd[k]) + colon);
        rec(k, inner);
      }
      out.push(nl + pad + close);
    }
    // Iterative fallback is not needed for realistic depths; guard extreme nesting.
    if (this.maxDepth > 5000) throw new Error('Nesting too deep to re-format (' + this.maxDepth + ' levels)');
    rec(id, '');
    return out.join('');
  };

  /** Convert a subtree to plain JS values (numbers may lose precision). */
  Doc.prototype.toValue = function (id) {
    var t = this.type[id];
    switch (t) {
      case T_NULL: return null;
      case T_FALSE: return false;
      case T_TRUE: return true;
      case T_NUM: return Number(this.raw(id));
      case T_STR: return this.str(id);
    }
    var kids = this.children(id), self = this;
    if (t === T_ARR) return kids.map(function (k) { return self.toValue(k); });
    var o = {};
    kids.forEach(function (k) { o[self.key(k)] = self.toValue(k); });
    return o;
  };

  var api = {
    parse: parse, ParseError: ParseError, detectWrapper: detectWrapper, lineCol: lineCol,
    T_NULL: T_NULL, T_FALSE: T_FALSE, T_TRUE: T_TRUE, T_NUM: T_NUM, T_STR: T_STR, T_OBJ: T_OBJ, T_ARR: T_ARR
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.JSONPeek = root.JSONPeek || {}; root.JSONPeek.core = api; }
})(typeof self !== 'undefined' ? self : this);
