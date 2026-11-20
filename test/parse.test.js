'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parse } = require('../src/core/parse.js');
const { query } = require('../src/core/query.js');

const valid = [
  '0', '-0', '1.5e10', '-12.25E-3', 'true', 'false', 'null', '""', '"a\\u00e9\\n\\"b"',
  '[]', '{}', '[1,2,3]', '{"a":1,"b":[true,false,null],"c":{"d":"e"}}',
  ' \n\t{ "x" : [ { } , [ ] , "y" ] } \r\n', '[[[[[[]]]]]]', '{"":0}', '"\\/"',
  JSON.stringify({ deep: { list: Array.from({ length: 50 }, (_, i) => ({ i, s: 'v' + i })) } }),
];
const invalid = [
  '', ' ', '{', '[', '[1,]', '{"a":1,}', '{a:1}', "{'a':1}", '01', '1.', '.5', '1e', '+1', 'tru',
  'nul', '"abc', '"\\x"', '"\\u12G4"', '"a\u0001b"', '[1 2]', '{"a" 1}', '{"a":}', '1 2', 'NaN',
  'Infinity', '[1,,2]', '{,}', '}', ']',
];

test('accepts what JSON.parse accepts and round-trips values', () => {
  for (const s of valid) {
    const doc = parse(s);
    assert.deepStrictEqual(doc.toValue(doc.root), JSON.parse(s), s);
    assert.deepStrictEqual(JSON.parse(doc.stringify(doc.root, 2)), JSON.parse(s), s);
    assert.deepStrictEqual(JSON.parse(doc.stringify(doc.root, 0)), JSON.parse(s), s);
    // Numbers and strings are copied as written, so only canonical spellings match JSON.stringify exactly.
    if (!/^-0$|[eE\\]/.test(s)) assert.strictEqual(doc.stringify(doc.root, 0), JSON.stringify(JSON.parse(s)), s);
  }
});

test('rejects what JSON.parse rejects, with a position', () => {
  for (const s of invalid) {
    assert.throws(() => JSON.parse(s), undefined, 'sanity: ' + s);
    assert.throws(() => parse(s, { unwrap: false }), (e) => e.name === 'ParseError' && e.line >= 1 && e.col >= 1, s);
  }
});

test('error line and column', () => {
  try { parse('{\n  "a": 1,\n  "b": [1, 2,]\n}'); assert.fail(); } catch (e) {
    assert.strictEqual(e.line, 3);
    assert.strictEqual(e.col, 14);
    assert.match(e.message, /Trailing comma/);
  }
});

test('big numbers stay exact and are flagged', () => {
  const s = '{"id":12345678901234567890,"ok":9007199254740991,"f":0.1,"pi":3.14159265358979323846,"e":1e400,"big":1e21}';
  const doc = parse(s);
  const id = doc.childByKey(doc.root, 'id');
  assert.strictEqual(doc.raw(id), '12345678901234567890');
  assert.ok(doc.isLossy(id));
  assert.ok(!doc.isLossy(doc.childByKey(doc.root, 'ok')));
  assert.ok(!doc.isLossy(doc.childByKey(doc.root, 'f')));
  assert.ok(doc.isLossy(doc.childByKey(doc.root, 'pi')));
  assert.ok(doc.isLossy(doc.childByKey(doc.root, 'e')));
  assert.ok(!doc.isLossy(doc.childByKey(doc.root, 'big')));
  assert.strictEqual(doc.stringify(doc.root, 0), s);
});

test('key order is preserved (JSON.parse moves integer keys first)', () => {
  const doc = parse('{"b":1,"2":2,"a":3,"1":4}');
  assert.deepStrictEqual(doc.children(doc.root).map((c) => doc.key(c)), ['b', '2', 'a', '1']);
  assert.strictEqual(doc.stringify(doc.root, 0), '{"b":1,"2":2,"a":3,"1":4}');
});

test('subtree layout, paths, indices', () => {
  const doc = parse('{"data":[{"id":1},{"id":2,"weird key":{"x-y":null}}],"n":0}');
  const data = doc.childByKey(doc.root, 'data');
  assert.strictEqual(doc.count[data], 2);
  const second = doc.childAt(data, 1);
  assert.strictEqual(doc.path(doc.childByKey(second, 'id')), '$.data[1].id');
  const xy = doc.childByKey(doc.childByKey(second, 'weird key'), 'x-y');
  assert.strictEqual(doc.path(xy), '$.data[1]["weird key"]["x-y"]');
  assert.strictEqual(doc.path(xy, 'jq'), '.data[1]["weird key"]["x-y"]');
  assert.strictEqual(doc.path(xy, 'js'), 'data[1]["weird key"]["x-y"]');
  assert.strictEqual(doc.path(doc.root, 'jq'), '.');
  assert.strictEqual(doc.size[doc.root], doc.n);
  assert.strictEqual(doc.childAt(data, -1), second);
});

test('nodeAtOffset maps text offsets to nodes', () => {
  const s = '{"alpha":"needle","beta":[1,"x needle"]}';
  const doc = parse(s);
  const off = s.indexOf('needle');
  assert.strictEqual(doc.path(doc.nodeAtOffset(off)), '$.alpha');
  assert.strictEqual(doc.path(doc.nodeAtOffset(s.lastIndexOf('needle'))), '$.beta[1]');
  assert.strictEqual(doc.path(doc.nodeAtOffset(s.indexOf('beta'))), '$.beta');
});

test('wrappers: XSSI guard, JSONP, BOM', () => {
  let doc = parse(")]}'\n{\"a\":1}");
  assert.strictEqual(doc.wrapper.kind, 'xssi');
  assert.deepStrictEqual(doc.toValue(doc.root), { a: 1 });
  doc = parse('cb_1.x({"a":[1]});\n');
  assert.strictEqual(doc.wrapper.kind, 'jsonp');
  assert.deepStrictEqual(doc.toValue(doc.root), { a: [1] });
  doc = parse('﻿[1]');
  assert.deepStrictEqual(doc.toValue(doc.root), [1]);
});

test('JSON Lines mode', () => {
  const doc = parse('{"a":1}\n{"a":2}\n\n[3]\n"s"\n', { multi: true });
  assert.deepStrictEqual(doc.toValue(doc.root), [{ a: 1 }, { a: 2 }, [3], 's']);
  assert.throws(() => parse('{"a":1}\n{"a":2}'), /JSON Lines/);
});

test('deep nesting does not overflow the stack', () => {
  const d = 100000;
  const doc = parse('['.repeat(d) + ']'.repeat(d));
  assert.strictEqual(doc.n, d);
});

test('query: JSONPath subset', () => {
  const doc = parse(JSON.stringify({ store: { book: [{ t: 'a', p: 8 }, { t: 'b', p: 12 }, { t: 'c', p: 9 }], bike: { p: 20 } } }));
  const paths = (q) => query(doc, q).map((id) => doc.path(id));
  assert.deepStrictEqual(paths('$.store.book[*].t'), ['$.store.book[0].t', '$.store.book[1].t', '$.store.book[2].t']);
  assert.deepStrictEqual(paths('$..p'), ['$.store.book[0].p', '$.store.book[1].p', '$.store.book[2].p', '$.store.bike.p']);
  assert.deepStrictEqual(paths('$.store.book[-1]'), ['$.store.book[2]']);
  assert.deepStrictEqual(paths('$.store.book[0:2].t'), ['$.store.book[0].t', '$.store.book[1].t']);
  assert.deepStrictEqual(paths("$['store']['bike']"), ['$.store.bike']);
  assert.deepStrictEqual(paths('$.store.*'), ['$.store.book', '$.store.bike']);
  assert.deepStrictEqual(paths('$.store.book[?(@.p > 8)].t'), ['$.store.book[1].t', '$.store.book[2].t']);
  assert.deepStrictEqual(paths('$.store.book[?(@.t == "a")]'), ['$.store.book[0]']);
  assert.deepStrictEqual(paths('$.nope.x'), []);
  assert.throws(() => query(doc, '$.store[('), /JSONPath/);
});

test('JSON Lines values must be separated (review finding)', () => {
  for (const s of ['01', 'truefalse', '1-2', 'nulltrue']) assert.throws(() => parse(s, { multi: true }), /line break/, s);
  const doc = parse('{"a":1}{"a":2}\n[1] "x"', { multi: true });
  assert.strictEqual(doc.count[doc.root], 4);
});

test('depth beyond 65535 is stored correctly (review finding)', () => {
  const d = 70000;
  const doc = parse('['.repeat(d) + ']'.repeat(d));
  assert.strictEqual(doc.depth[doc.n - 1], d - 1);
});
