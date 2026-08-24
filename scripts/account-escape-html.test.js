const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('public/account.js', 'utf8');
const match = source.match(/function escapeHtml\(text\) \{[\s\S]*?\n\}/);

assert(match, 'escapeHtml function should exist');

const escapeHtml = vm.runInNewContext(`(${match[0]})`);

assert.strictEqual(escapeHtml(0), '0');
assert.strictEqual(escapeHtml(null), '');
assert.strictEqual(escapeHtml(undefined), '');
assert.strictEqual(escapeHtml('<span>&"x"</span>'), '&lt;span&gt;&amp;&quot;x&quot;&lt;/span&gt;');
