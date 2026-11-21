'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const React=require('react');
const {loader}=require('./first_match_ui.test');
describe('Pocket Atlas review regressions',()=>{
 it('delivers a native touch drop exactly once when the board provides a callback',()=>{
  let callbacks=0,events=0;
  const ghost={style:{},remove(){}};
  const drop={closest(){return this},getAttribute:k=>k==='data-drop-zone'?'BANK':null,classList:{add(){},remove(){}}};
  global.document={getElementById:()=>ghost,elementFromPoint:()=>drop};
  global.window={dispatchEvent:e=>{if(e.type==='md:drag:drop')events++}};global.CustomEvent=class {constructor(type,options={}){this.type=type;this.detail=options.detail;}};
  try {
   const touch=loader({'./soundEngine':{playCardDraw(){},playCardPlay(){}}})('client/src/utils/touchDragEngine.ts');
   touch.handleTouchStart({touches:[{identifier:1,clientX:10,clientY:10}]},{id:'cash',kind:'MONEY',value:1},0,'HAND');
   touch.handleTouchMove({changedTouches:[{identifier:1,clientX:50,clientY:10}],cancelable:false},{isMyTurn:true,playsMade:0,turnPhase:'ACTION',waitingForPayment:false,selfOwesPayment:false});
   touch.handleTouchEnd({},()=>callbacks++);
   assert.deepEqual([callbacks,events],[1,0],'callback and fallback event must not both submit a play');
  } finally {delete global.document;delete global.window;delete global.CustomEvent;}
 });
 it('lets vertical hand gestures scroll while retaining deliberate horizontal drag',()=>{
  const {shouldStartTouchDrag}=loader()('client/src/utils/touchDragEngine.ts');
  assert.equal(shouldStartTouchDrag(2,80),false);
  assert.equal(shouldStartTouchDrag(9,50),false);
  assert.equal(shouldStartTouchDrag(2,2),false);
  assert.equal(shouldStartTouchDrag(30,2),true);
  assert.equal(shouldStartTouchDrag(-30,3),true);
 });
 it('counts distinct victory colors while keeping group identity separate',()=>{
  const {completedColorCount}=loader()('client/src/utils/publicTable.ts');
  assert.equal(completedColorCount({completedSetGroups:['Brown','Brown#2','DarkBlue']}),2);
  assert.equal(completedColorCount({completedSetColors:['Brown','DarkBlue'],completedSetGroups:['Brown','Brown#2','DarkBlue']}),2);
  assert.equal(completedColorCount({completedSetGroups:['Brown','DarkBlue','Utility']}),3);
 });
 it('does not mount a discretionary preview above an incoming mandatory response',()=>{
  const preview={id:'preview',kind:'MONEY',title:'1M',value:1};let index=0;
  const fakeReact={...React,useState:v=>[index++===1?preview:typeof v==='function'?v():v,()=>{}],useEffect:()=>{},useRef:v=>({current:v})};
  const state={matchId:'m',roomCode:'ABCD',turnPhase:'ACTION',currentTurnPlayerId:'other',actionCountRemaining:2,self:{id:'self',hand:[],bank:[],properties:{}},opponents:[{id:'other',displayName:'Other',handCount:1,bank:[],properties:{}}],pendingActionResolution:{eligibleResponderIds:['self'],sourceTitle:'Debt Collector'}};
  global.localStorage={getItem:()=>null};
  try {
   const {GameBoardView}=loader({'react':fakeReact,'../store/useGameStore':{useGameStore:()=>({gameState:state,events:[]})}})('client/src/components/GameBoardView.tsx');
   const tree=GameBoardView();let previewMounted=false;const walk=x=>{if(!x||typeof x!=='object')return;if(x.type?.name==='CardPreviewModal')previewMounted=true;React.Children.forEach(x.props?.children,walk)};walk(tree);
   assert.equal(previewMounted,false);
  } finally {delete global.localStorage;}
 });
 it('keeps the bank drop target inside the retained interactive hand, not the inert footer',()=>{
  const board=fs.readFileSync(path.resolve(__dirname,'../../client/src/components/GameBoardView.tsx'),'utf8');
  const css=fs.readFileSync(path.resolve(__dirname,'../../client/src/index.css'),'utf8');
  assert(!/\.atlas-bank-drop\s*\{[^}]*display:none/.test(css));
  assert(board.indexOf('data-drop-zone="BANK"')>board.indexOf('{panel &&'),'bank is inside the hand panel');
 });
});
