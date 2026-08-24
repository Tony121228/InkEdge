const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

function createElement(id = '') {
  return {
    id,
    value: '',
    textContent: '',
    innerHTML: '',
    disabled: false,
    style: {},
    dataset: {},
    classList: {
      values: new Set(),
      add(...names) {
        names.forEach((name) => this.values.add(name));
      },
      remove(...names) {
        names.forEach((name) => this.values.delete(name));
      },
      toggle(name, force) {
        if (force === undefined) {
          if (this.values.has(name)) this.values.delete(name);
          else this.values.add(name);
          return this.values.has(name);
        }
        if (force) this.values.add(name);
        else this.values.delete(name);
        return !!force;
      },
      contains(name) {
        return this.values.has(name);
      }
    },
    addEventListener() {},
    setAttribute() {},
    appendChild() {},
    closest() {
      return null;
    }
  };
}

const elements = new Map();
const documentStub = {
  getElementById(id) {
    if (!elements.has(id)) elements.set(id, createElement(id));
    return elements.get(id);
  },
  querySelector(selector) {
    if (!elements.has(selector)) elements.set(selector, createElement(selector));
    return elements.get(selector);
  },
  createElement
};

const source = fs
  .readFileSync('public/app.js', 'utf8')
  .replace(/\(async function init\(\) \{[\s\S]*?\}\)\(\);\s*$/, '');

const context = {
  document: documentStub,
  window: {
    clearInterval() {},
    setInterval() { return 1; },
    location: { href: '', pathname: '/', search: '', replace() {} }
  },
  localStorage: {
    getItem() { return ''; },
    setItem() {},
    removeItem() {}
  },
  navigator: { clipboard: { writeText() {} } },
  URLSearchParams,
  fetch: async () => ({ ok: true, json: async () => ({}) }),
  setTimeout,
  clearTimeout,
  console
};

vm.createContext(context);
vm.runInContext(source, context, { filename: 'public/app.js' });

assert.doesNotThrow(() => {
  context.renderRewriteProcess({
    rewriteMode: 'aggressive',
    safetyMode: 'off',
    rewriteStatus: 'safe',
    fallbackTriggeredBy: 'none',
    factInventory: null,
    factAudit: null,
    needsUserFacts: [],
    rewriteFailureReasons: [],
    editPlan: [{
      action: 'compress',
      problemType: 'style',
      segment: 'sample',
      reason: 'sample reason',
      target: 'sample target'
    }],
    deletedOrCompressed: [],
    selfReview: [],
    rewriteStats: [{ probability: 42, compressionRate: 0.9 }],
    beforeAfter: { originalScore: 80, rewrittenScore: 42, explanation: '', reducedDimensions: [] },
    voiceProfile: null
  });
});

const rewriteProcess = elements.get('rewriteProcess');
assert(rewriteProcess.innerHTML.includes('rewrite-plan-card'), 'edit plan should still render');
assert(!rewriteProcess.innerHTML.includes('fact-boundary'), 'fact boundary should stay hidden without fact inventory');
