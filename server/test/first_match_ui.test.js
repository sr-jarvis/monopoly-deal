'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const ts = require('typescript');
const React = require('react');
const {renderToStaticMarkup} = require('react-dom/server');
function loader(overrides = {}) {
 const cache = new Map();
 function load(file) {
  file = path.resolve(__dirname, '../..', file);
  if(cache.has(file)) return cache.get(file).exports;
  const mod = new Module(file, module); cache.set(file,mod); mod.filename=file;
  mod.paths=Module._nodeModulePaths(path.dirname(file));
  const native=mod.require.bind(mod);
  mod.require=spec=>{
   if(overrides[spec]) return overrides[spec];
   if(spec==='@monopoly-deal/shared') return load('shared/protocol.ts');
   if(spec.startsWith('.')) {
    const base=path.resolve(path.dirname(file),spec);
    for(const ext of ['.tsx','.ts']) if(fs.existsSync(base+ext)) return load(base+ext);
   }
   return native(spec);
  };
  mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,file);
  return mod.exports;
 }
 return load;
}
const load=loader();
describe('first match UI refinements',()=>{
 it('does not infer another five-card deal from bank/property snapshots changing hand length',()=>{
  let state; let index=0; const refs=[]; let effects=[]; let legacyDeals=0; const emissions=[];
  const fakeReact={...React,useRef:v=>refs[index++] ||= {current:v},useState:v=>[typeof v==='function'?v():v,()=>{}],useEffect:f=>effects.push(f),useSyncExternalStore:()=>true};
  const run=loader({'react':fakeReact,'../store/useGameStore':{useGameStore:()=>({gameState:state,roomCode:'ABCD',events:[]})},'../net/socket':{socketService:{emit:(...args)=>emissions.push(args)}},'../utils/cardDealFlightEngine':{scheduleInitialDealCascade:()=>({flights:[{}]}),emitDealStart:()=>legacyDeals++}});
  global.localStorage={getItem:()=>null}; global.window={addEventListener(){},removeEventListener(){},matchMedia:()=>({matches:true})};
  try {
   const {GameBoardView}=run('client/src/components/GameBoardView.tsx');
   for(const count of [7,6,5]) {
    state={matchId:'match',turnNumber:1,drawEvents:[],turnPhase:'ACTION',currentTurnPlayerId:'self',actionCountRemaining:3,self:{id:'self',hand:Array.from({length:count},(_,i)=>({id:String(i),value:1})),properties:{},bank:[]},opponents:[]};
    index=0;effects=[];const tree=GameBoardView(); for(const effect of effects) {const cleanup=effect();if(typeof cleanup==='function')cleanup();}
    const nodes=[];const walk=node=>{if(!node || typeof node!=='object')return;nodes.push(node);React.Children.forEach(node.props?.children,walk);};walk(tree);
    assert.equal(emissions.length,0,'snapshots must never auto-emit draw or end turn');
    const end=nodes.find(n=>n.type==='button' && n.props.children==='End Turn');assert(end,'manual early End Turn remains available');
    end.props.onClick();assert.deepEqual(emissions.pop(),['game:action',{type:'END_TURN'}]);
    const settings=nodes.find(n=>n.type?.name==='GameSettings');assert(settings);assert.equal(settings.props.onReplay,undefined,'active matches have no replay affordance');
   }
   assert.equal(legacyDeals,0,'hand lengths are not server draw events');
  } finally {delete global.localStorage;delete global.window;}
 });
 it('orients the printed dual-wild image to its public group, including a second group',()=>{
  const {PropertyGroupView}=load('client/src/components/PropertyGroupView.tsx');
  const card={id:'w',kind:'WILDCARD',title:'Property Wild Card',colors:['Red','Yellow'],value:3};
  const html=renderToStaticMarkup(React.createElement(PropertyGroupView,{color:'Yellow#2',cards:[card]}));
  assert.match(html,/data-property-rotation="180"/);
  assert.match(html,/rotate\(180deg\)/);
  assert(!html.includes('Flip card to'), 'public board must not have ephemeral hand flip controls');
 });

 const {DrawOrchestrator}=load('client/src/utils/drawPresentation.ts');
 function initial(seats=2, matchId='match-1') {
  const ids=Array.from({length:seats},(_,i)=>`p${i+1}`);
  return {matchId,turnNumber:1,self:{id:'p1',hand:Array.from({length:7},(_,i)=>({id:`c${i}`,value:1})),bank:[],properties:{}},opponents:ids.slice(1).map(id=>({id,handCount:5,bank:[],properties:{}})),drawEvents:[...ids.map((playerId,i)=>({id:i+1,playerId,count:5,kind:'INITIAL'})),{id:seats+1,playerId:'p1',count:2,kind:'DRAW'}]};
 }
 const options={startup:true,now:1000};
 for(const seats of [2,3,4,5]) it(`deals exactly five per seat then the first draw of two in order for ${seats} players`,()=>{
  const engine=new DrawOrchestrator(); const state=initial(seats);
  const result=engine.consume(state,options);
  assert.equal(result.shuffleAt,1000);
  assert.deepEqual(result.batches.map(b=>[b.playerId,b.count]),[...state.drawEvents.map(e=>[e.playerId,e.count])]);
  assert.deepEqual(result.batches[0].cards.map(c=>c.id),['c0','c1','c2','c3','c4']);
  assert.deepEqual(result.batches.at(-1).cards.map(c=>c.id),['c5','c6']);
  for(let i=1;i<result.batches.length;i++) assert(result.batches[i].startAt>result.batches[i-1].endAt,'events must not overlap');
  for(const batch of result.batches.filter(b=>!b.self)) assert.deepEqual(batch.cards,[],'never project an opponent card face');
  assert.deepEqual(engine.consume(state,options).batches,[],'duplicate snapshot/StrictMode');
 });
 it('ignores hand/phase/property changes and stale/reordered snapshots; draws exact actual counts, not hand delta',()=>{
  const engine=new DrawOrchestrator();const state=initial();engine.consume(state,options);
  for(const handSize of [6,5,7]) assert.deepEqual(engine.consume({...state,turnPhase:'ACTION',self:{...state.self,hand:state.self.hand.slice(0,handSize)}},options).batches,[]);
  const next={...state,drawEvents:[...state.drawEvents,{id:4,playerId:'p1',count:2,kind:'DRAW'}],self:{...state.self,hand:state.self.hand.slice(0,6)}};
  const go=engine.consume(next,options);assert.deepEqual(go.batches.map(b=>b.count),[2]);assert.equal(go.shuffleAt,null);
  assert.deepEqual(engine.consume({...next,drawEvents:[...next.drawEvents].reverse()},options).batches,[]);
  assert.deepEqual(engine.consume(state,options).batches,[]);
  const empty=engine.consume({...next,turnNumber:3,drawEvents:[{id:5,playerId:'p2',count:5,kind:'DRAW'}]},options);
  assert.deepEqual(empty.batches.map(b=>[b.playerId,b.count,b.cards]),[['p2',5,[]]]);
 });
 it('suppresses historical late joins, reconnect and remount but admits subsequent events',()=>{
  const data=new Map();const storage={getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v)};
  let engine=new DrawOrchestrator(storage);const state=initial();
  assert.deepEqual(engine.consume(state,{now:0}).batches,[],'no witnessed lobby: historical baseline');
  const next={...state,drawEvents:[...state.drawEvents,{id:4,playerId:'p1',count:2,kind:'DRAW'}]};
  assert.equal(engine.consume(next,{now:100}).batches.length,1);
  engine=new DrawOrchestrator(storage);assert.deepEqual(engine.consume(next,options).batches,[],'session watermark persists across reload');
  engine.disconnect(); const missed={...state,drawEvents:[{id:5,playerId:'p2',count:2,kind:'DRAW'}]};
  assert.deepEqual(engine.consume(missed,options).batches,[],'reconnect establishes baseline, not backlog');
  assert.equal(engine.consume({...missed,drawEvents:[{id:6,playerId:'p2',count:2,kind:'DRAW'}]},options).batches.length,1);
  assert.equal(engine.consume(initial(2,'rematch'),options).shuffleAt,1000);
 });
 it('animates a new live match identity once without needing another lobby; reconnect stays suppressed',()=>{
  global.window={sessionStorage:{getItem:()=>null,setItem(){}},matchMedia:()=>({matches:false})};
  try {
   const {drawPresentation:present}=loader()('client/src/utils/drawPresentation.ts');
   present.witnessLobby();present.receive(initial());
   assert.equal(present.getSnapshot().batches.length,3);
   present.receive(initial(2,'restarted'));
   assert.equal(present.getSnapshot().batches.length,3,'fresh direct restart must deal exactly5+5+2');
   assert.notEqual(present.getSnapshot().shuffleAt,null);
   present.receive(initial(2,'restarted'));
   assert.equal(present.getSnapshot().batches.length,3,'duplicate restart snapshot must not add flights');
   present.disconnect();present.receive(initial(2,'missed-during-reconnect'));
   assert.equal(present.getSnapshot().batches.length,0,'disconnected backlog is historical');
  } finally {delete global.window;}
 });
 it('consumes reduced-motion events without any shuffle or flights and bounds persisted history',()=>{
  const data=new Map();const storage={getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v)};
  const engine=new DrawOrchestrator(storage);
  assert.deepEqual(engine.consume(initial(),{...options,reducedMotion:true}),{batches:[],shuffleAt:null});
  assert.deepEqual(engine.consume(initial(),options).batches,[]);
  for(let i=0;i<40;i++) engine.consume(initial(2,`m${i}`),options);
  assert.equal(JSON.parse([...data.values()][0]).length,24);
 });
 it('rejects malformed events and duplicate event ids without manufacturing flights',()=>{
  const engine=new DrawOrchestrator();const state=initial();
  const result=engine.consume({...state,drawEvents:[...state.drawEvents,...state.drawEvents,{id:4,playerId:'unknown',count:2,kind:'DRAW'},{id:5,playerId:'p1',count:500,kind:'DRAW'}]},options);
  assert.equal(result.batches.length,3);
 });
 it('uses printed asset orientation for both ends of every dual pair, never ALL, hand, preview or hidden cards',()=>{
  const {CardView}=load('client/src/components/CardView.tsx');
  const {publicWildcardRotation}=load('client/src/utils/publicWildcardOrientation.ts');
  for(const [top,bottom] of [['Green','DarkBlue'],['Brown','LightBlue'],['LightBlue','Railroad'],['Green','Railroad'],['Railroad','Utility'],['Orange','Purple'],['Red','Yellow']]) {
   const card={id:'w',kind:'WILDCARD',colors:[bottom,top],value:3};
   assert.equal(publicWildcardRotation(card,`${top}#2`),0);
   assert.equal(publicWildcardRotation(card,`${bottom}#2`),180);
   assert.equal(publicWildcardRotation(card),0);
   assert.equal(publicWildcardRotation({...card,colors:['ALL']},bottom),0);
   assert.equal(publicWildcardRotation({...card,colors:['Red','Yellow','Green']},bottom),0);
   const hidden=renderToStaticMarkup(React.createElement(CardView,{card,faceDown:true,publicPropertyGroup:bottom}));
   assert.match(hidden,/data-property-rotation="0"/);
  }
 });
 it('bounds the playfield grid with an explicit zero-minimum column instead of a min-content implicit track',()=>{
  const board=fs.readFileSync(path.resolve(__dirname,'../../client/src/components/GameBoardView.tsx'),'utf8');
  const css=fs.readFileSync(path.resolve(__dirname,'../../client/src/index.css'),'utf8');
  assert.ok(board.includes('className="atlas-workspace"'),'Public table has an independently bounded workspace');
  assert.match(css,/\.atlas-workspace\s*\{[^}]*min-width:0;[^}]*overflow:auto/,'Workspace must not inherit hand min-content width');
  assert.match(css,/grid-template-rows:auto auto minmax\(0,1fr\) auto/,'Table scrolls inside a zero-minimum viewport track');
  assert.match(css,/\.atlas-hand-grid\s*\{[^}]*repeat\(2,minmax\(0,1fr\)\)/,'Hand uses two zero-minimum artwork columns');
 });
 it('keeps host settings inside each mandatory gameplay dialog without resolving it',()=>{
  for (const [file,name,props] of [
   ['ResponseDialog','ResponseDialog',{response:{eligibleResponderIds:['self'],sourceTitle:'Debt Collector',responseCount:0},selfId:'self',hand:[],onAccept(){},onCounter(){}}],
   ['PaymentModal','PaymentModal',{amountOwed:5,bankCards:[],propertyCards:{},onPay(){}}],
   ['DiscardModal','DiscardModal',{hand:Array.from({length:8},(_,i)=>({id:String(i),kind:'MONEY',title:'1M',value:1})),onDiscard(){}}],
   ['WinModal','WinModal',{gameOver:{winnerId:'self'},selfId:'self',selfDisplayName:'Host',opponents:[],onRematch(){},onLeaveRoom(){}}]
  ]) {
   const Component=load(`client/src/components/${file}.tsx`)[name];
   const html=renderToStaticMarkup(React.createElement(Component,{...props,settings:React.createElement('button',{},'Host settings test')}));
   assert.match(html,/Host settings test/,`${file} must keep management reachable`);
  }
 });
 it('renders settings with a native keyboard-contained dialog and no active-match replay or visual shuffle',()=>{
  const {GameSettings}=load('client/src/components/GameSettings.tsx');
  const active=renderToStaticMarkup(React.createElement(GameSettings,{onLeaderboard:()=>{}}));
  assert.match(active,/<dialog/);assert.match(active,/Close settings/);assert.match(active,/Music/);assert(!active.includes('Match replay'));assert(!active.includes('Shuffle'));
  const over=renderToStaticMarkup(React.createElement(GameSettings,{onLeaderboard:()=>{},onReplay:()=>{}}));
  assert.match(over,/Match replay/);
 });

});
module.exports={loader};
