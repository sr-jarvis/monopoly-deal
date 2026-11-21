'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const root = path.resolve(__dirname, '../../client/src');
const cache = new Map();
function load(relative) {
  const file = path.resolve(root, relative);
  if (cache.has(file)) return cache.get(file).exports;
  const mod = new Module(file, module); cache.set(file, mod);
  mod.filename = file; mod.paths = Module._nodeModulePaths(path.dirname(file));
  const native = mod.require.bind(mod);
  mod.require = spec => {
    if (spec === './CardView') return { CardView: ({card}) => React.createElement('img', {alt:card.title}) };
    if (spec.startsWith('.')) {
      const target = path.resolve(path.dirname(file), spec);
      for (const ext of ['.tsx', '.ts']) if (fs.existsSync(target + ext)) return load(path.relative(root, target + ext));
    }
    return native(spec);
  };
  mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS, jsx:ts.JsxEmit.React, target:ts.ScriptTarget.ES2020, esModuleInterop:true}}).outputText, file);
  return mod.exports;
}
const noop = () => {};
const render = (component, props) => renderToStaticMarkup(React.createElement(component, props));
describe('Pocket Atlas card dialogs', () => {
  it('renders independent textual rules and rent tiers with a labelled bounded dialog', () => {
    const {CardPreviewModal} = load('components/CardPreviewModal.tsx');
    const html = render(CardPreviewModal, {card:{id:'p', title:'Mediterranean Avenue', kind:'PROPERTY', color:'Brown', value:1}, onClose:noop});
    assert.match(html, /role="dialog"/);
    assert.match(html, /aria-modal="true"/);
    assert.match(html, /aria-describedby=/);
    assert.match(html, /atlas-card-dialog/);
    assert.match(html, /2 cards complete/);
    assert.match(html, /1 card: 1M/);
    assert.match(html, /2 cards: 2M/);
    assert.match(html, /cannot be banked/);
  });
  it('preserves banking and response-only Just Say No guidance outside artwork', () => {
    const {ActionChoiceModal} = load('components/ActionChoiceModal.tsx');
    const html = render(ActionChoiceModal, {card:{id:'n',kind:'ACTION',title:'Just Say No',value:4}, opponents:[],selfProperties:{},selfHand:[],actionCountRemaining:3,onClose:noop,onPlay:noop});
    assert.match(html,/Deposit in Bank/);
    assert.match(html,/Use when responding to an action/);
    assert.match(html,/cancel/);
  });
  it('uses the canonical rent tiers rather than inferring them from art', () => {
    const {ATLAS_RENT_TIERS} = load('components/AtlasCardDialog.tsx');
    const {getCardCatalog} = require('../card_catalog');
    for (const card of getCardCatalog().properties) assert.deepStrictEqual(ATLAS_RENT_TIERS[card.color], card.rentTiers);
  });
});

// Small DOM boundary fixture: real controller, deterministic focus/history/events;
// not a substitute for the owner's viewport/browser acceptance pass.
function fixture({retained = false, settings = false} = {}) {
  const previousGlobals = Object.fromEntries(['window','document','HTMLElement','Element'].map(key => [key, Object.getOwnPropertyDescriptor(global, key)]));
  const listeners = new Map(); const timers = new Map(); let tick = 0;
  const doc = {activeElement:null, native:false,
    querySelector(selector) { return selector === 'dialog[open]' ? (this.native ? {} : null) : selector === '.atlas-sheet-overlay' ? (retained ? {} : null) : selector === '.md-settings-trigger' ? (settings ? trigger : null) : null; },
    addEventListener(type, fn) { listeners.set(type, fn); },
    removeEventListener(type, fn) { if (listeners.get(type) === fn) listeners.delete(type); }
  };
  class Node {
    constructor(id) { this.id = id; this.isConnected = true; this.inert = false; }
    focus() { doc.activeElement = this; }
    getClientRects() { return [{}]; }
    closest(selector) { return selector === '.md-settings-trigger' && this === trigger ? this : selector === '[inert]' && this.inert ? this : null; }
  }
  const previous = new Node('opener'), first = new Node('close'), last = new Node('play'), trigger = new Node('settings'), outside = new Node('outside'), element = new Node('dialog');
  element.querySelectorAll = () => [first, last]; element.contains = node => node === first || node === last || node === element;
  doc.activeElement = previous;
  const history = {state:{route:'match'}, pushes:0, backs:0, pushState(state) { this.state = state; this.pushes++; }, back() {this.backs++;}};
  const win = {history, setTimeout(fn) {timers.set(++tick, fn); return tick;}, clearTimeout(id) {timers.delete(id);}, addEventListener:doc.addEventListener,removeEventListener:doc.removeEventListener};
  Object.assign(global, {document:doc, window:win, HTMLElement:Node, Element:Node});
  return {doc,history,element,previous,first,last,trigger,outside,listeners,
    flush() {const work = [...timers.values()]; timers.clear(); work.forEach(fn => fn());},
    key(key, shiftKey = false, defaultPrevented = false) {const event = {key,shiftKey,defaultPrevented,preventDefault(){this.defaultPrevented = true;},stopPropagation(){}}; listeners.get('keydown')?.(event); return event;},
    restore() { for (const [key, descriptor] of Object.entries(previousGlobals)) { if (descriptor) Object.defineProperty(global,key,descriptor); else delete global[key]; } }
  };
}
describe('Pocket Atlas keyboard and history lifecycle', () => {
  const {containAtlasDialog} = load('components/AtlasCardDialog.tsx');
  let f, cleanup;
  afterEach(() => {cleanup?.(); f?.restore(); cleanup = null; f = null;});
  it('contains forward/reverse Tab, redirects background focus and restores opener on cleanup', () => {
    f = fixture(); cleanup = containAtlasDialog(f.element, noop);
    assert.strictEqual(f.doc.activeElement, f.first);
    f.key('Tab'); assert.strictEqual(f.doc.activeElement, f.last);
    f.key('Tab'); assert.strictEqual(f.doc.activeElement, f.first);
    f.key('Tab', true); assert.strictEqual(f.doc.activeElement, f.last);
    f.outside.focus(); f.listeners.get('focusin')({target:f.outside}); assert.strictEqual(f.doc.activeElement, f.first);
    cleanup(); cleanup = null; f.flush(); assert.strictEqual(f.doc.activeElement, f.previous);
    assert.strictEqual(f.listeners.size, 0);
  });
  it('allows keyboard host settings and yields Tab, focus and Escape to native top-layer settings', () => {
    f = fixture({settings:true}); let closed = 0; cleanup = containAtlasDialog(f.element, () => closed++);
    f.key('Tab'); f.key('Tab'); assert.strictEqual(f.doc.activeElement, f.trigger);
    f.key('Tab', true); assert.strictEqual(f.doc.activeElement, f.last);
    f.doc.native = true; f.outside.focus();
    assert.strictEqual(f.key('Tab').defaultPrevented, false);
    f.listeners.get('focusin')({target:f.outside}); f.key('Escape');
    assert.strictEqual(f.doc.activeElement, f.outside); assert.strictEqual(closed, 0);
    f.doc.native = false; f.key('Escape', false, true); assert.strictEqual(closed, 0);
    f.key('Escape'); assert.strictEqual(closed, 1);
  });
  it('uses one Back entry when standalone and consumes no extra Back during dismissal', () => {
    f = fixture(); let closed = 0; cleanup = containAtlasDialog(f.element, () => closed++); f.flush();
    assert.strictEqual(f.history.pushes, 1); f.listeners.get('popstate')(); assert.strictEqual(closed, 1);
    cleanup(); cleanup = null; f.flush(); assert.strictEqual(f.history.backs, 0);
  });
  it('returns its standalone entry on button dismissal but never competes with the retained hand', () => {
    f = fixture(); cleanup = containAtlasDialog(f.element, noop); f.flush(); cleanup(); cleanup = null; f.flush(); assert.strictEqual(f.history.backs, 1); f.restore();
    f = fixture({retained:true}); cleanup = containAtlasDialog(f.element, noop); f.flush();
    assert.strictEqual(f.history.pushes, 0); assert(!f.listeners.has('popstate'));
  });
  it('cancels the StrictMode-style setup probe without writing history or restoring to a removed opener', () => {
    f = fixture(); cleanup = containAtlasDialog(f.element, noop); f.previous.isConnected = false;
    cleanup(); cleanup = null; f.flush(); assert.strictEqual(f.history.pushes, 0); assert.strictEqual(f.history.backs, 0); assert.notStrictEqual(f.doc.activeElement, f.previous);
  });
});
