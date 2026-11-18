'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const cache = new Map();

// Exercise the actual TSX components with installed TypeScript and React.
// No source-string assertions, browser emulation, network or fetched runners.
function load(relative) {
 const file = path.resolve(__dirname, '../../client/src', relative);
 if (cache.has(file)) return cache.get(file).exports;
 const mod = new Module(file, module); cache.set(file,mod); mod.filename=file;
 mod.paths=Module._nodeModulePaths(path.dirname(file));
 const nativeRequire = mod.require.bind(mod);
 mod.require = spec => {
  if (spec.startsWith('.')) {
   const target=path.resolve(path.dirname(file),spec);
   for (const ext of ['.tsx','.ts']) if(fs.existsSync(target+ext)) return load(path.relative(path.resolve(__dirname,'../../client/src'),target+ext));
  }
  return nativeRequire(spec);
 };
 const js=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText;
 mod._compile(js,file); return mod.exports;
}
const { ResponseDialog }=load('components/ResponseDialog.tsx');
const { ActionChoiceModal }=load('components/ActionChoiceModal.tsx');
const { PaymentModal }=load('components/PaymentModal.tsx');
const { PropertyGroupView }=load('components/PropertyGroupView.tsx');
const response={sourceTitle:'Sly Deal',fromPlayerId:'p1',targetPlayerId:'p2',eligibleResponderIds:['p2'],cancelled:false,responseCount:0};
const noop=()=>{};
const render=(component,props)=>renderToStaticMarkup(React.createElement(component,props));
describe('manual gameplay UI rendered behavior',()=>{
 it('offers explicit accept and held JSN only to the nominated responder',()=>{
  const html=render(ResponseDialog,{response,selfId:'p2',hand:[{id:'jsn',title:'Just Say No',kind:'ACTION',value:4}],onAccept:noop,onCounter:noop});
  assert.match(html,/role="dialog"/); assert.match(html,/Accept action/); assert.match(html,/Play Just Say No/);
  const waiting=render(ResponseDialog,{response,selfId:'p1',hand:[],onAccept:noop,onCounter:noop}); assert.match(waiting,/role="status"/); assert(!waiting.includes('<button'));
 });
 it('shows counter-cancellation and explicit pass without offering absent cards',()=>{
  const html=render(ResponseDialog,{response:{...response,cancelled:true},selfId:'p2',hand:[],onAccept:noop,onCounter:noop});
  assert.match(html,/Pass — keep cancellation/); assert.match(html,/no Just Say No in hand/); assert(!html.includes('Play Just Say No'));
 });
 for(const kind of ['PROPERTY','WILDCARD']) it(`never offers banking for ${kind}`,()=>{
  const html=render(ActionChoiceModal,{card:{id:'p',kind,title:'Property',color:'Red',colors:['Red','Yellow'],value:3},opponents:[],selfProperties:{},selfHand:[],actionCountRemaining:3,onClose:noop,onPlay:noop});
  assert(!html.includes('Deposit in Bank')); assert.match(html,/Place on Property Board/);
 });
 it('offers banking and held JSN response guidance outside a reaction',()=>{
  const html=render(ActionChoiceModal,{card:{id:'n',kind:'ACTION',title:'Just Say No',value:4},opponents:[],selfProperties:{},selfHand:[],actionCountRemaining:3,onClose:noop,onPlay:noop});
  assert.match(html,/Deposit in Bank/); assert.match(html,/Use when responding to an action/);
 });
 it('keeps valueless wilds out of payment and renders placed buildings as payable assets',()=>{
  const html=render(PaymentModal,{amountOwed:2,bankCards:[],propertyCards:{Red:[{id:'zero',kind:'WILDCARD',title:'ZERO-WILD',value:0}]},buildings:{Red:{house:true,houseCard:{id:'house',kind:'ACTION',title:'House',value:3}}},onPay:noop});
  assert(!html.includes('ZERO-WILD')); assert.match(html,/House/); assert.match(html,/No change is given/); assert.match(html,/disabled=""/);
 });
 const { RearrangeWildcardModal }=load('components/RearrangeWildcardModal.tsx');
 it('offers a new second same-color property group without changing printed color',()=>{
  const html=render(ActionChoiceModal,{card:{id:'p',kind:'PROPERTY',color:'Brown',value:1},opponents:[],selfProperties:{Brown:[{id:'b',value:1}]},selfHand:[],actionCountRemaining:3,onClose:noop,onPlay:noop});
  assert.match(html,/aria-label="Property set"/); assert.match(html,/value="Brown#2"/); assert.match(html,/Brown#2 \(new set\)/);
 });
 it('offers eligible existing and new same-color groups for a wildcard move, excluding its current group',()=>{
  const html=render(RearrangeWildcardModal,{card:{id:'w',kind:'WILDCARD',colors:['Brown','LightBlue'],value:1},currentColor:'Brown',properties:{Brown:[], 'Brown#2':[]},onClose:noop,onRearrange:noop});
  assert.match(html,/Brown#2/); assert.match(html,/Brown#3/); assert(!html.includes('>Brown</button>'));
 });
 it('targets complete opponent groups independently and not an incomplete group of the same color',()=>{
  const html=render(ActionChoiceModal,{card:{id:'db',kind:'ACTION',title:'Deal Breaker',value:5},opponents:[{id:'p2',displayName:'Two',handCount:0,properties:{Brown:[{id:'b',value:1}], 'Brown#2':[{id:'c',value:1},{id:'d',value:1}]},completedSetColors:['Brown'],completedSetGroups:['Brown#2']}],selfProperties:{},selfHand:[],actionCountRemaining:3,onClose:noop,onPlay:noop});
  assert.match(html,/Brown#2 \(2 cards\)/); assert(!html.includes('Brown (1 cards)'));
 });
 it('renders secondary groups with their base color name and independent identity',()=>{
  const html=render(PropertyGroupView,{color:'Brown#2',cards:[{id:'p',value:1}],hasHouse:true});
  assert.match(html,/Brown #2 \(1\)/); assert.match(html,/bg-amber-900/);
 });
 it('does not lose visible physical buildings on an empty property group',()=>{
  const html=render(PropertyGroupView,{color:'Red',cards:[],hasHouse:true,houseCard:{id:'h',kind:'ACTION',title:'House',value:3}});
  assert.match(html,/House/); assert.match(html,/Red \(0\)/); assert.match(html,/no rent bonus/);
 });
});
