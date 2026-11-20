// Generates a realistic API-like JSON file of roughly the requested size in MB.
'use strict';
const fs = require('fs');
const mb = Number(process.argv[2] || 10), out = process.argv[3] || `sample-${mb}mb.json`;
let seed = 42; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const words = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india', 'juliet'];
const parts = []; let size = 0, i = 0;
while (size < mb * 1e6) {
  const rec = JSON.stringify({
    id: 1000000000000000000 + i, // placeholder, replaced below by a 19-digit id
    uuid: Math.floor(rnd() * 1e16).toString(16) + '-' + i,
    name: words[i % 10] + ' ' + words[Math.floor(rnd() * 10)],
    active: rnd() > 0.5, score: Math.round(rnd() * 10000) / 100, tags: [words[i % 7], words[i % 3]],
    address: { city: words[i % 5], zip: String(10000 + (i % 89999)), geo: { lat: rnd() * 180 - 90, lng: rnd() * 360 - 180 } },
    note: null,
  }).replace(/"id":\d+/, '"id":' + (BigInt('9007199254740993') + BigInt(i)).toString());
  parts.push(rec); size += rec.length + 1; i++;
}
fs.writeFileSync(out, '{"count":' + i + ',"items":[' + parts.join(',') + ']}');
console.log(out, (size / 1e6).toFixed(1) + ' MB', i + ' records');
