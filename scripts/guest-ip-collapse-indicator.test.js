const assert = require('assert');
const fs = require('fs');

const html = fs.readFileSync('public/account.html', 'utf8');
const css = fs.readFileSync('public/styles.css', 'utf8');

const panelIndex = html.indexOf('guestIpPanel');
const panelMarkup = html.slice(Math.max(0, panelIndex - 80), panelIndex + 500);

assert(panelMarkup.includes('<details'), 'temporary IP panel should use details');
assert(!panelMarkup.includes(' open'), 'temporary IP panel should be collapsed by default');
assert(!panelMarkup.includes('展开'), 'collapse indicator should not use text label');
assert(!panelMarkup.includes('收起'), 'collapse indicator should not use text label');
assert(css.includes('border-left'), 'collapse indicator should use CSS triangle');
assert(css.includes('transform: rotate(90deg)'), 'open state should rotate the triangle');
