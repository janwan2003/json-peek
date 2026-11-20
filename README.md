# JSON Peek

A fast, private JSON viewer, available as a browser extension and as a [web tool](https://janwan2003.github.io/json-peek/).

- **Exact numbers.** It parses the text itself, so `12345678901234567890` stays `12345678901234567890`.
  (`JSON.parse`, and the viewers built on it, round it to `12345678901234567000`.) Numbers that JavaScript
  would change get an `exact` badge.
- **Large files.** The tree is virtualised, so a 50 MB / 4.8M-value response opens in about a second and scrolls smoothly.
- **Search and JSONPath.** Text search over keys and values, with a filter that shows only matches. JSONPath queries such as
  `$.items[?(@.price > 10)].name` or `$..id`.
- **Copy** a path (`$.a[0].b`, jq `.a[0].b` or JS `a[0].b`), a value or a formatted subtree. Keyboard navigation throughout.
- **Original key order**, JSON Lines / NDJSON, JSONP and `)]}'` XSSI prefixes. Syntax errors show the reason, line and column.
- **Trustworthy by construction.** MIT licensed. The only API permission is `storage`. No network requests, analytics or remote code.
  There is no bundler or minifier: the extension package is the files in `extension/` and `src/`, plus `style.js` (the CSS as a string).

## Layout

| Path | What |
|---|---|
| `src/core/parse.js` | Lossless indexed parser: flat typed arrays pointing into the source text (about 37 bytes per value) |
| `src/core/query.js` | JSONPath subset evaluated on the index |
| `src/viewer/` | Virtualised tree UI (shadow DOM), shared by the extension and the site |
| `extension/` | MV3 manifest, content script (detects raw JSON pages), toolbar page |
| `site/` | GitHub Pages web tool |
| `scripts/build.js` | Copies everything into `dist/extension`, `dist/site` and a zip |

## Develop

```sh
node --test test/*.test.js        # parser + JSONPath unit tests
node scripts/build.js             # -> dist/
pnpm install && node test/e2e.js  # loads dist/extension into Chromium (playwright-core) and checks real pages
```

To install the extension locally, open `chrome://extensions`, turn on Developer mode, choose **Load unpacked** and pick `dist/extension`.

## Privacy

See [privacy](https://janwan2003.github.io/json-peek/privacy.html). In short: nothing is collected, and nothing leaves your device.
