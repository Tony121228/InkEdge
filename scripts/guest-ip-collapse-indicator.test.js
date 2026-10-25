const assert = require('assert');
const fs = require('fs');

const html = fs.readFileSync('public/account.html', 'utf8');
const css = fs.readFileSync('public/styles.css', 'utf8');

assert(!html.includes('guestIpPanel'), 'temporary IP panel should be removed from the account page');
assert(!html.includes('临时IP管理后台'), 'temporary IP copy should be removed from the account page');
assert(css.includes('border-left'), 'legacy collapse indicator styles may remain compatible');
