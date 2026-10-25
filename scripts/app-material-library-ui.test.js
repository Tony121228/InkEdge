const assert = require('assert');
const fs = require('fs');

function read(filePath) {
  assert.ok(fs.existsSync(filePath), `${filePath} should exist`);
  return fs.readFileSync(filePath, 'utf8');
}

const appHtml = read('public/app.html');
const appJs = read('public/app.js');
const stylesCss = read('public/styles.css');

for (const removedId of ['materialTitleInput', 'materialSceneInput', 'materialTopicInput']) {
  assert.ok(!appHtml.includes(removedId), `material library UI should remove #${removedId}`);
  assert.ok(!appJs.includes(`#${removedId}`), `material library logic should not read #${removedId}`);
}

assert.ok(appHtml.includes('materialDetailInput'), 'material library should keep one raw material textarea');
assert.ok(appHtml.includes('只写一段真实素材'), 'material textarea should guide the user to input only material');
assert.ok(appHtml.includes('智能生成素材卡'), 'material button should describe AI classification and card generation');

assert.ok(appJs.includes('rawMaterial: detail'), 'frontend should send rawMaterial from the textarea');
assert.ok(appJs.includes('renderSmartMaterialCard'), 'frontend should render the smart material card');
for (const field of ['category', 'suitableTopics', 'topicReasons', 'keywords', 'writingAngles']) {
  assert.ok(appJs.includes(field), `frontend should render material field ${field}`);
}

for (const className of ['smart-material-card', 'material-topic-list', 'material-keyword-list']) {
  assert.ok(stylesCss.includes(className), `styles should include ${className}`);
}

console.log('OK app material library UI contract');
