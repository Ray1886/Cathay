const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const engine = require('../itinerary.js');

const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

function loadPage(Recognition) {
  const nodes = new Map();
  function node() {
    const listeners = {};
    return {
      listeners, value: '', textContent: '', innerHTML: '', hidden: false, disabled: false,
      classList: { add() {}, remove() {}, toggle() {} },
      addEventListener(name, callback) { listeners[name] = callback; },
      setAttribute() {}, scrollIntoView() {}, focus() {}
    };
  }
  const document = {
    querySelector(selector) { if (!nodes.has(selector)) nodes.set(selector, node()); return nodes.get(selector); },
    querySelectorAll() { return []; }
  };
  const window = { isSecureContext: true, SpeechRecognition: Recognition };
  vm.runInNewContext(source, { document, window, ItineraryEngine:engine, localStorage: { getItem: () => null, setItem() {} }, setTimeout() {}, clearTimeout() {} });
  return (selector) => document.querySelector(selector);
}

test('spoken simplified meal request fills the composer without changing the itinerary', () => {
  class FakeRecognition {
    start() {
      this.onstart();
      this.onresult({ results: [{ isFinal: true, 0: { transcript: '我想吃饭' } }] });
      this.onend();
    }
  }
  const element = loadPage(FakeRecognition);
  const before = element('#activityList').innerHTML;
  element('#speechLang').value = 'zh-CN';
  element('#micButton').listeners.click();
  assert.match(element('#requestInput').value, /吃饭/);
  assert.equal(element('#activityList').innerHTML, before);
  assert.match(element('#voiceStatus').textContent, /請按發送/);
});

test('unsupported voice engine gives an actionable fallback', () => {
  const element = loadPage(undefined);
  assert.match(element('#voiceStatus').textContent, /沒有語音辨識引擎/);
  element('#micButton').listeners.click();
  assert.match(element('#voiceStatus').textContent, /裝置聽寫/);
});
