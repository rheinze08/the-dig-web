#!/usr/bin/env node
// Proves assets/favorites.js with a minimal fake browser: hearts paint from
// localStorage, a click toggles and persists, and a storage failure warns on
// the page instead of pretending the favorite was saved.
//   node test/favorites.mjs
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const script = await readFile(new URL('../static/assets/favorites.js', import.meta.url), 'utf8');
const problems = [];
const expect = (condition, message) => {
  if (!condition) problems.push(message);
};

function button(id, withLabel = false) {
  const attrs = {'data-fav': id, 'aria-pressed': 'false'};
  const label = {textContent: 'Save as favorite'};
  return {
    label,
    getAttribute: name => attrs[name] ?? null,
    setAttribute: (name, value) => { attrs[name] = value; },
    querySelector: () => (withLabel ? label : null),
  };
}

function browser({stored = null, failSave = false} = {}) {
  const store = new Map(stored ? [['dig-favorites', stored]] : []);
  const buttons = [button('sale-a'), button('sale-b', true)];
  const listeners = {};
  const events = [];
  let warning = null;
  const window = {
    localStorage: {
      getItem: key => store.get(key) ?? null,
      setItem: (key, value) => {
        if (failSave) throw Error('storage is full');
        store.set(key, value);
      },
    },
    addEventListener: (name, fn) => { listeners[name] = fn; },
    dispatchEvent: event => { events.push(event); return true; },
    CustomEvent: class {
      constructor(type, init) {
        this.type = type;
        this.detail = init?.detail;
      }
    },
  };
  const document = {
    body: {appendChild: node => { warning = node; }},
    getElementById: id => (id === 'fav-warning' ? warning : null),
    createElement: () => ({setAttribute() {}, hidden: false, textContent: ''}),
    querySelectorAll: () => buttons,
    addEventListener: (name, fn) => { listeners[name] = fn; },
  };
  vm.runInNewContext(script, {window, document, CustomEvent: window.CustomEvent, console});
  const click = btn => listeners.click({target: {closest: () => btn}});
  return {buttons, store, events, click, warning: () => warning, window};
}

// Stored favorites paint on load, including the sale-page label.
{
  const {buttons} = browser({stored: '["sale-b"]'});
  expect(buttons[0].getAttribute('aria-pressed') === 'false', 'A sale that is not a favorite should start unpressed');
  expect(buttons[1].getAttribute('aria-pressed') === 'true', 'A stored favorite should start pressed');
  expect(buttons[1].label.textContent === 'Saved as favorite', 'The sale-page button should say it is saved');
}

// Clicking toggles, persists, and tells the search page.
{
  const env = browser();
  env.click(env.buttons[0]);
  expect(env.store.get('dig-favorites') === '["sale-a"]', 'A click should persist the favorite id');
  expect(env.buttons[0].getAttribute('aria-pressed') === 'true', 'A click should press the heart');
  expect(env.events.some(event => event.type === 'dig:favorites' && event.detail.join() === 'sale-a'),
    'A click should announce the new favorites list');
  env.click(env.buttons[0]);
  expect(env.store.get('dig-favorites') === '[]', 'A second click should remove the favorite');
  expect(env.buttons[0].getAttribute('aria-pressed') === 'false', 'A second click should unpress the heart');
  expect(env.window.DigFavorites.list().length === 0, 'DigFavorites.list should read the stored list');
}

// A browser that refuses storage: warn visibly, keep nothing, announce nothing.
{
  const env = browser({failSave: true});
  env.click(env.buttons[0]);
  expect(env.warning()?.textContent.includes('would not save favorites'), 'A failed save should warn on the page');
  expect(env.buttons[0].getAttribute('aria-pressed') === 'false', 'A failed save should leave the heart unpressed');
  expect(env.events.length === 0, 'A failed save should not announce a change');
}

if (problems.length) {
  console.error(`Favorites test FAILED (${problems.length}):`);
  for (const problem of problems) console.error('  ' + problem);
  process.exit(1);
}
console.log('Favorites test passed: stored hearts paint, clicks toggle and persist, a refused save warns and keeps nothing.');
