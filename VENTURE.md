---
slug: json-peek
stage: idea
priority: 2
url:
repo:
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
launched in 2026. Priority 3 for that reason. The reach of the leader's fall (2M
users) makes it worth trying anyway, and the product is small.

## Status

Idea only. Nothing built. Evidence above gathered by web search and live curl of
Chrome Web Store listing and review pages on 2026-11-20.

## Next steps

1. Choose a distinct name (not "JSON Formatter"/"JSONVue"/"JSON Alexander").
2. MV3 content script that detects `application/json` and JSON-looking `text/plain`
   documents and replaces the view. Lossless big-number parser. Virtualised tree renderer.
3. Benchmarks: 1 MB, 20 MB and 100 MB files compared with JSONVue and Chrome's built-in viewer; publish the numbers.
4. Static web tool page (format/validate/diff), GitHub Pages.
5. Store listing; the Chrome Web Store developer account goes in OPERATOR-INBOX.md.
6. Firefox AMO port.

## Monetization plan

None until the operator enables it. The extension stays free. Later options: GitHub
Sponsors/donation link (no in-page prompts), or a paid desktop/web "JSON workbench"
(large-file diff, schema inference). No affiliate or ad injection, ever.

## Log

- 2026-11-20 scout: created idea. Evidence: live curl of JSON Formatter and JSONVue
  listings and JSON Formatter reviews; web search (dev.to, wikidocs, septimlabs, wesbos.com).
- 2026-11-20 review: lowered p3→2. The demand is real (re-curled CWS: JSON Formatter 2,000,000 users/1.5 stars, JSONVue 900,000/4.3, not updated since 2023), but ≥3 replacements already shipped in 2026, Chrome has a built-in JSON pretty-print, and monetization is donations at best. Build after save-image-format proves the store channel. No url/repo yet.
