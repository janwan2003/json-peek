# Chrome Web Store listing (draft, ready to paste)

- **Name:** JSON Peek
- **Category:** Developer Tools
- **Package:** `dist/json-peek-extension-<version>.zip` from `node scripts/build.js`
  (also published at https://janwan2003.github.io/json-peek/download/json-peek-extension.zip)
- **Privacy policy URL:** https://janwan2003.github.io/json-peek/privacy.html
- **Homepage:** https://janwan2003.github.io/json-peek/
- **Screenshots (1280×800):** `store/screenshot-*.png`
- **Icon:** `extension/icons/128.png`

## Short description (≤132 chars)
Fast, private JSON viewer: collapsible tree, search and JSONPath, exact big numbers. Open source, no tracking, no network access.

## Description
JSON Peek turns raw JSON responses into a fast, searchable tree. It is open source, and you can check its privacy claims in the code.

• Exact numbers: 64-bit IDs such as 12345678901234567890 are shown exactly as the server sent them. Viewers built on JSON.parse round them.
• Large files: a virtualised tree opens 50 MB responses in about a second and scrolls smoothly.
• Search keys and values, and filter to matches only. JSONPath queries such as $..id or $.items[?(@.price > 10)].
• Copy the path ($.data[3].id, jq or JS style), the value or a formatted subtree.
• Original key order, JSON Lines / NDJSON, JSONP and )]}' prefixes. Syntax errors show line and column.
• Keyboard navigation, light and dark themes, raw view, save as file.
• Click the toolbar icon for a scratch viewer where you can paste or drop JSON.

Privacy: no analytics, no network requests, no remote code, no ads, no donation pop-ups. The only API permission is "storage", which remembers your theme. Source: https://github.com/janwan2003/json-peek

## Permission justifications
- **Host access (content script on all URLs):** JSON can be served from any URL. The script only acts when the page is a raw JSON document, and it renders that document in place. Other pages are left untouched.
- **storage:** remembers the theme and path-style settings on the device.
- **Remote code:** none. All code is in the package.
- **Data usage:** collects nothing.
