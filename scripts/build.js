// Build = copy. No bundler or transpiler, so the shipped extension is byte-for-byte
// the source in this repo plus a generated style.js (the CSS as a JS string).
'use strict';
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const root = path.join(__dirname, '..'), dist = path.join(root, 'dist');
const ext = path.join(dist, 'extension'), site = path.join(dist, 'site');
fs.rmSync(dist, { recursive: true, force: true });
const shared = ['src/core/parse.js', 'src/core/query.js', 'src/viewer/viewer.js'];
const css = fs.readFileSync(path.join(root, 'src/viewer/viewer.css'), 'utf8');
const styleJs = '// Generated from src/viewer/viewer.css by scripts/build.js\n' +
  '(function (r) { (r.JSONPeek = r.JSONPeek || {}).css = ' + JSON.stringify(css) + '; })(typeof self !== "undefined" ? self : this);\n';

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const f of fs.readdirSync(from, { withFileTypes: true })) {
    if (f.isDirectory()) copyDir(path.join(from, f.name), path.join(to, f.name));
    else fs.copyFileSync(path.join(from, f.name), path.join(to, f.name));
  }
}
function addShared(dir) {
  fs.mkdirSync(dir, { recursive: true });
  for (const f of shared) fs.copyFileSync(path.join(root, f), path.join(dir, path.basename(f)));
  fs.writeFileSync(path.join(dir, 'style.js'), styleJs);
}

copyDir(path.join(root, 'extension'), ext);
addShared(ext);
copyDir(path.join(root, 'site'), site);
addShared(path.join(site, 'js'));
fs.copyFileSync(path.join(root, 'extension/icons/128.png'), path.join(site, 'icon.png'));
fs.copyFileSync(path.join(root, 'extension/icons/32.png'), path.join(site, 'favicon.png'));

const version = JSON.parse(fs.readFileSync(path.join(ext, 'manifest.json'), 'utf8')).version;
const zip = path.join(dist, `json-peek-extension-${version}.zip`);
try {
  execFileSync('zip', ['-qrX', zip, '.'], { cwd: ext });
  fs.mkdirSync(path.join(site, 'download'), { recursive: true });
  fs.copyFileSync(zip, path.join(site, 'download', 'json-peek-extension.zip'));
  console.log('built', path.relative(root, zip));
} catch (e) {
  console.warn('zip not available; skipped extension archive');
}
console.log('built dist/extension and dist/site');
