---
slug: json-peek
stage: launched
priority: 2
url: https://janwan2003.github.io/json-peek/
repo: https://github.com/janwan2003/json-peek
updated: 2026-11-20
---

# json-peek

## Thesis

**Who:** Developers, QA testers and data people who open JSON API responses in the browser and want
them pretty-printed, collapsible and searchable.

**What:** An open-source, zero-network Chrome/Firefox extension that renders JSON
responses as a fast, collapsible tree with a raw view, path copy (`$.data[3].id`), a filter
box (JSONPath/jq-lite), dark/light themes, and good performance on 50 MB+ files. It
comes with a static web page (paste or drop JSON, format, validate and diff locally) that can
rank for "json formatter online"-type searches.

**Why now:** The category leader, *JSON Formatter* (2M users), was sold, went closed
source, and added donation hijacking, affiliate injection and geolocation tracking in
2026. Its rating is now **1.5 stars from 2.1K ratings**, and reviewers report that Malwarebytes
flags it as `PUP.Optional.Hijacker`. The #2, JSONVue (900K users), has not been updated
since November 2023. Developers are looking for a replacement right now, and many dev.to
posts are trying to capture that search traffic.

## Market evidence

Competitors (Chrome Web Store, queried live with curl on 2026-11-20):
| Extension | Users | Rating | Last update |
|---|---|---|---|
| [JSON Formatter](https://chromewebstore.google.com/detail/bcjindcccaagfpapjjmafapmmgkkhgoa) | 2,000,000 | **1.5** (2.1K) | 2026-05-16 |
| [JSONVue](https://chromewebstore.google.com/detail/chklaanhfefbnpoihckbnefhakgolnmc) | 900,000 | 4.3 (2.6K) | 2023-11-29 |
- Other alternatives named in coverage: [JSON Alexander (Wes Bos)](https://wesbos.com/json-alexander),
  [Arnav Kumar's JSON Formatter (Firefox, MIT)](https://addons.mozilla.org/addon/json_formatter/),
  "JSON Formatter Pro" (promoted by a [dev.to comparison series](https://dev.to/alphashark/json-formatter-pro-vs-callum-locke-json-formatter-2026-5bo0)).

Demand and complaints:
- Recent JSON Formatter reviews, read live 2026-11-20: "donation hijacking and implemented
  tracking without consent", "Malwarebyte detected this extension to be
  PUP.Optional.Hijacker", "Uninstalling after seeing others have mentioned injection"
  ([reviews](https://chromewebstore.google.com/detail/json-formatter/bcjindcccaagfpapjjmafapmmgkkhgoa/reviews)).
- Writeups: [dev.to: turns closed source, intrusive donation tactics and tracking](https://dev.to/pavkode/json-formatter-extension-turns-closed-source-introduces-intrusive-donation-tactics-and-tracking-kf8),
  [dev.to: I built a JSON viewer because the most popular one betrayed its users](https://dev.to/valentinconan/i-built-a-json-viewer-because-the-most-popular-one-betrayed-its-users-5e6e),
  [wikidocs (Korean): "2M-user JSON Formatter turned adware"](https://wikidocs.net/blog/@jaehong/11324/),
  [septimlabs: adware alternatives](https://septimlabs.vercel.app/blog/json-formatter-adware-alternatives.html).
  The dates of the change vary between sources (January to mid-2026). Several of these
  posts were written by competitors, so their claims are not independent.

## Our edge

- **Trust that can be checked:** MIT-licensed, no network permission at all, no remote code,
  reproducible builds from tagged source, and a one-paragraph privacy statement. This
  is the exact point where the leader failed.
- **Actively maintained**, unlike JSONVue (last update 2023).
- **Faster on big files:** stream-parse and virtualise the tree so 50–100 MB responses
  open without freezing the tab. The old formatters choke on these.
- Developer features in a free extension: JSONPath filter, copy path, copy subtree,
  sort keys, toggle between raw and parsed, and big-number-safe parsing (no precision loss on 64-bit
  IDs, which `JSON.parse` silently corrupts).
- The companion web page and the GitHub repo reach developers through dev.to, Hacker News "Show HN" and
  GitHub stars. These are organic launches by us, not mass posting.

Risks: Chrome has a basic built-in JSON pretty-print, and at least 3 other replacements
launched in 2026. That is why priority is 2 (lowered from 3 by the 2026-11-20 review). The reach of the leader's fall (2M
users) makes it worth trying anyway, and the product is small.

## Status

**Live:** web tool at https://janwan2003.github.io/json-peek/ (plus `/jsonpath.html` and `/privacy.html`), deployed
by GitHub Actions (`.github/workflows/pages.yml`: unit tests → build → Pages). The extension is built and tested,
and it can be downloaded as a zip from the site (load unpacked). It is **not yet in the Chrome Web Store**: that
needs the operator's developer account (OPERATOR-INBOX). The listing text, permission justifications and
screenshots are ready in `store/`.

What exists (all verified 2026-11-20, see Log):
- `src/core/parse.js`: lossless indexed parser (typed arrays pointing into the source text). It keeps numbers
  exact and flags those `JSON.parse` would round, preserves key order, reports errors with line and column,
  supports JSON Lines, and strips JSONP and XSSI wrappers. 100k-deep nesting is OK.
  Speed: 50 MB / 3.3M values in 0.93–1.15 s in node (`JSON.parse` 0.36–0.50 s).
- `src/core/query.js`: JSONPath subset (child, index, negative index, slice, wildcard, recursive descent, union, filters).
- `src/viewer/`: virtualised tree in a shadow root. It has search with highlighting, filter-to-matches, JSONPath,
  copy path (JSONPath, jq or JS style), value or subtree, keyboard navigation, expand to level 1–3 or all,
  raw view, save, and light/dark/auto themes.
- `extension/`: MV3. The content script detects JSON content types, plus `text/plain` and JS types that parse as JSON.
  Its only API permission is `storage`. The toolbar icon opens a paste/drop viewer page.
- Tests: `node --test test/*.test.js` (13 unit tests). `node test/e2e.js` (16 checks) loads the real built
  extension into Chromium 159 via playwright-core and serves JSON, bad JSON, JSON Lines, text/plain, prose, HTML,
  XSSI and a 50 MB document.
- Known gaps: Chrome downloads `application/x-ndjson` instead of displaying it, so the extension can't render those.
  Firefox is not ported yet (its built-in viewer intercepts JSON). Text selection across rows is limited by
  virtualisation; use the Raw tab or the copy buttons.
- Open from code review (2026-11-20, a separate agent; fixed items have regression tests): Save on a JSON Lines page
  writes a `.jsonl.json` array, not lines. Search highlighting is offset next to characters whose lowercase is
  longer (display only). Every page evaluates about 60 KB of viewer JS before bailing out, because all scripts are content scripts.

## Next steps

1. Operator: publish to the Chrome Web Store (account needed; listing ready in `store/LISTING.md`).
2. More rankable tool pages, built on the same viewer: JSON validator, JSON Lines viewer, "JSON big number
   precision" explainer, JSON diff (new feature, high search volume), JSON to CSV.
3. Firefox AMO port: disable or override the built-in JSON viewer (`devtools.jsonview.enabled`), or use
   `webRequest.filterResponseData`. Edge Add-ons can use the same package.
4. Benchmarks page: 1/20/100 MB against Chrome's built-in viewer and JSONVue, with published numbers (not done yet).
5. Lazy-load the viewer: inject only a tiny detector, then load the rest with `chrome.scripting` (adds the
   `scripting` permission). This cuts per-page cost on non-JSON sites. Also fix Save for JSON Lines.
6. Performance: the parser is about 2.5× slower than `JSON.parse`. Try an `indexOf`-based string scan. Optionally
   move parsing to a worker for files over 20 MB so the tab never blocks.
7. Launch posts once the store listing is live (Show HN, a dev.to write-up of the big-number bug). These are organic, one post each.

## Monetization plan

None until the operator enables it. The extension stays free. Later options: GitHub
Sponsors/donation link (no in-page prompts), or a paid desktop/web "JSON workbench"
(large-file diff, schema inference). No affiliate or ad injection, ever.

## Log

- 2026-11-20 scout: created idea. Evidence: live curl of JSON Formatter and JSONVue
  listings and JSON Formatter reviews; web search (dev.to, wikidocs, septimlabs, wesbos.com).
- 2026-11-20 review: lowered p3→2. The demand is real (re-curled CWS: JSON Formatter 2,000,000 users/1.5 stars, JSONVue 900,000/4.3, not updated since 2023), but ≥3 replacements already shipped in 2026, Chrome has a built-in JSON pretty-print, and monetization is donations at best. Build after save-image-format proves the store channel. No url/repo yet.
- 2026-11-20 builder: re-checked the evidence (curl of the CWS listing: JSON Formatter still 2,000,000 users / 1.5★;
  no existing extension named "JSON Peek" found by web search). Built the parser, JSONPath, virtualised viewer, MV3
  extension and web tool. Published repo and Pages; stage idea→launched (web tool live; extension awaiting store account).
  Verified: 11/11 unit tests; e2e 14/14 with the real extension in Chromium 159 (50 MB file: navigation to rows 1.1 s,
  expand all 60 ms, search 88 ms). Actions run 44730952580 succeeded (build + deploy). Live URL curled 200 for
  /, privacy, JS, zip. The live page was loaded in headless Chromium: it rendered pasted JSON, with 0 console errors
  and 0 network requests after pasting.
- 2026-11-20 builder (same session): an independent review agent found no injection path. It reproduced keyboard traps
  (ArrowDown loop on adjacent closing brackets, PageDown/End stuck), missed search on escaped strings (`\/`, `\u00e9`),
  scaled-scroll rounding, a first-Enter no-op, unseparated JSON Lines being accepted, and depth overflow past 65,535.
  All fixed, with tests: 13/13 unit, 16/16 e2e (50 MB: rows in 0.98 s, expand all 51 ms, search 91 ms).
