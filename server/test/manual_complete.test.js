'use strict';
const assert = require('assert');
const gm = require('../game_manager');
const rules = require('../rules_validator');
function card(id, kind, value, extra = {}) { return { id, kind, value, ...extra }; }
function setup(n = 2) {
 const s = gm.createGameState(Array.from({length:n}, (_,i)=>({id:`p${i+1}`,name:`P${i+1}`})));
 for (const p of Object.values(s.players)) { p.hand=[]; p.bank=[]; p.properties={}; }
 s.turn={playerId:'p1',phase:'ACTION',playsMade:0,hasDrawn:true,handSizeAtStartOfTurn:5}; return s;
}
function play(s,a) { const r=gm.applyAction(s,a); assert.strictEqual(r.legal,true,r.reason); return r.gameState; }
function action(s,title,extra={}) { s.players.p1.hand.push(card('action','ACTION',3,{title})); return play(s,{type:'PLAY_ACTION_CARD',playerId:'p1',cardId:'action',...extra}); }
function pass(s,id) { return play(s,{type:'ACCEPT_ACTION',playerId:id}); }
describe('official manual regression',()=>{
 it('defers stealing and consumes held JSN; a counter restores effect only after explicit accept',()=>{
  let s=setup(); s.players.p2.properties.Red={cards:[card('red','PROPERTY',3,{color:'Red'})]};
  s.players.p2.hand=[card('no2','ACTION',4,{title:'Just Say No'})]; s.players.p1.hand=[card('no1','ACTION',4,{title:'Just Say No'})];
  s=action(s,'Sly Deal',{targetPlayerId:'p2',targetPropertyColor:'Red',targetCardId:'red'});
  assert.strictEqual(s.players.p2.properties.Red.cards.length,1); assert(s.pendingActionResolution);
  assert.strictEqual(gm.applyAction(s,{type:'END_TURN',playerId:'p1'}).legal,false);
  assert.strictEqual(gm.applyAction(s,{type:'JUST_SAY_NO',playerId:'p2',cardId:'fake'}).legal,false);
  s=play(s,{type:'JUST_SAY_NO',playerId:'p2',cardId:'no2'}); assert.strictEqual(s.players.p2.hand.length,0);
  s=play(s,{type:'JUST_SAY_NO',playerId:'p1',cardId:'no1'}); assert.strictEqual(s.players.p1.hand.length,0);
  assert(s.players.p2.properties.Red); s=pass(s,'p2'); assert(!s.players.p2.properties.Red); assert.strictEqual(s.players.p1.properties.Red.cards[0].id,'red');
  assert.strictEqual(s.turn.playsMade,1); assert.strictEqual(s.discardPile.filter(c=>c.title==='Just Say No').length,2);
 });
 for(const title of ['Debt Collector','Its My Birthday','Rent']) it(`JSN cancels ${title} only for its responder`,()=>{
  let s=setup(3); s.players.p2.hand=[card('no','ACTION',4,{title:'Just Say No'})];
  if(title==='Rent') { s.players.p1.properties.Red={cards:[card('r','PROPERTY',3)]}; s.players.p1.hand=[card('rent','RENT',1,{title:'Rent',colors:['Red','Yellow'],types:['Red','Yellow']})]; s=play(s,{type:'PLAY_ACTION_CARD',playerId:'p1',cardId:'rent',propertyColor:'Red'}); }
  else s=action(s,title,{targetPlayerId:'p2'});
  assert.strictEqual(gm.applyAction(s,{type:'PAY_RENT',playerId:'p2',paymentCardIds:[]}).legal,false);
  s=play(s,{type:'JUST_SAY_NO',playerId:'p2',cardId:'no'}); s=pass(s,'p1');
  assert(!s.pendingCharge || !s.pendingCharge.debtors.p2);
  if(title!=='Debt Collector') { assert(s.pendingCharge.debtors.p3); s=pass(s,'p3'); s=play(s,{type:'PAY_RENT',playerId:'p3',paymentCardIds:[]}); }
  assert(!s.pendingCharge); assert(!s.pendingActionResolution);
 });
 it('declining to counter cancels Deal Breaker and does not win prematurely',()=>{
  let s=setup(); for(const [color,n] of [['Brown',2],['DarkBlue',2]]) s.players.p1.properties[color]={cards:Array.from({length:n},(_,i)=>card(color+i,'PROPERTY',1))};
  s.players.p2.properties.Utility={cards:[card('u1','PROPERTY',2),card('u2','PROPERTY',2)]}; s.players.p2.hand=[card('no','ACTION',4,{title:'Just Say No'})];
  s=action(s,'Deal Breaker',{targetPlayerId:'p2',targetPropertyColor:'Utility'}); assert.strictEqual(s.status,'IN_PROGRESS');
  s=play(s,{type:'JUST_SAY_NO',playerId:'p2',cardId:'no'}); s=pass(s,'p1'); assert(s.players.p2.properties.Utility); assert.strictEqual(s.status,'IN_PROGRESS');
 });
 it('accepting Deal Breaker moves buildings and announces the deferred win',()=>{
  let s=setup(); for(const [color,n] of [['Brown',2],['DarkBlue',2]]) s.players.p1.properties[color]={cards:Array.from({length:n},(_,i)=>card(color+i,'PROPERTY',1))};
  s.players.p2.properties.Red={cards:[1,2,3].map(i=>card('r'+i,'PROPERTY',3)),hasHouse:true,houseCard:card('h','ACTION',3,{title:'House'})};
  s=action(s,'Deal Breaker',{targetPlayerId:'p2',targetPropertyColor:'Red'}); assert.strictEqual(s.status,'IN_PROGRESS'); s=pass(s,'p2'); assert.strictEqual(s.winnerId,'p1'); assert.strictEqual(s.players.p1.properties.Red.houseCard.id,'h');
 });
 it('cancels Forced Deal without moving either property',()=>{
  let s=setup(); s.players.p1.properties.Red={cards:[card('r','PROPERTY',3)]}; s.players.p2.properties.Green={cards:[card('g','PROPERTY',4)]}; s.players.p2.hand=[card('no','ACTION',4,{title:'Just Say No'})];
  s=action(s,'Forced Deal',{targetPlayerId:'p2',offeredPropertyColor:'Red',offeredCardId:'r',requestedPropertyColor:'Green',requestedCardId:'g'});
  s=play(s,{type:'JUST_SAY_NO',playerId:'p2',cardId:'no'}); s=pass(s,'p1'); assert.strictEqual(s.players.p1.properties.Red.cards[0].id,'r'); assert.strictEqual(s.players.p2.properties.Green.cards[0].id,'g');
 });
 it('cannot bank property, recolor native property, or discard actions as a play',()=>{
  const s=setup(); s.players.p1.hand=[card('r','PROPERTY',3,{color:'Red'}),card('a','ACTION',1,{title:'Pass Go'})];
  for(const a of [{cardId:'r',targetZone:'bank'},{cardId:'r',targetZone:'properties',propertyColor:'Green'},{cardId:'a',targetZone:'action'}]) assert.strictEqual(gm.applyAction(s,{type:'PLAY_CARD',playerId:'p1',...a}).legal,false);
 });
 it('retains physical house and hotel, and permits paying them without change',()=>{
  let s=setup(); s.players.p1.properties.Brown={cards:[card('b1','PROPERTY',1),card('b2','PROPERTY',1)]};
  s=action(s,'House',{propertyColor:'Brown'}); assert.strictEqual(s.players.p1.properties.Brown.houseCard.id,'action'); assert(!s.discardPile.some(c=>c.id==='action'));
  s.players.p1.hand.push(card('hotel','ACTION',4,{title:'Hotel'})); s=play(s,{type:'PLAY_ACTION_CARD',playerId:'p1',cardId:'hotel',propertyColor:'Brown'});
  assert(s.players.p1.properties.Brown.houseCard); assert(s.players.p1.properties.Brown.hotelCard);
  s.pendingCharge={fromPlayerId:'p2',debtors:{p1:{amountOwed:2}}}; s=play(s,{type:'PAY_RENT',playerId:'p1',paymentCardIds:['hotel']}); assert.strictEqual(s.players.p2.bank[0].id,'hotel'); assert(!s.players.p1.properties.Brown.hasHotel); assert(s.players.p1.properties.Brown.hasHouse);
 });
 it('rejects valueless wildcard payment, hand payments and partial insolvency; accepts no assets',()=>{
  let s=setup(); s.pendingCharge={fromPlayerId:'p1',debtors:{p2:{amountOwed:5}}}; s.players.p2.properties.Red={cards:[card('zero','WILDCARD',0),card('r','PROPERTY',3)]}; s.players.p2.hand=[card('cash','MONEY',10)];
  for(const ids of [['zero'],['cash'],[]]) assert.strictEqual(gm.applyAction(s,{type:'PAY_RENT',playerId:'p2',paymentCardIds:ids}).legal,false);
  s=play(s,{type:'PAY_RENT',playerId:'p2',paymentCardIds:['r']}); assert(s.players.p2.properties.Red.cards.some(c=>c.id==='zero')); assert.strictEqual(s.players.p2.hand.length,1);
  s.pendingCharge={fromPlayerId:'p1',debtors:{p2:{amountOwed:5}}}; s=play(s,{type:'PAY_RENT',playerId:'p2',paymentCardIds:[]}); assert(!s.pendingCharge);
 });
 it('uses printed full-set rent, not an invented full-set multiplier',()=>{
  const s=setup(); s.players.p1.properties.LightBlue={cards:[1,2,3].map(id=>card(id,'PROPERTY',1)),hasHouse:true,hasHotel:true}; assert.strictEqual(rules.calculateRentAmount(s,'p1','LightBlue').totalRent,10);
 });
 it('allows wild flips during draw phase without consuming a play',()=>{
  let s=setup(); s.turn.phase='DRAW'; s.players.p1.properties.Red={cards:[card('w','WILDCARD',3,{colors:['Red','Yellow']})]}; s=play(s,{type:'REARRANGE',playerId:'p1',cardId:'w',propertyColor:'Yellow'}); assert.strictEqual(s.turn.playsMade,0); assert.strictEqual(s.turn.phase,'DRAW');
 });
 it('permits two distinct rent doublers within three plays, rejecting duplicate or over-budget companions atomically',()=>{
  const s=setup(); s.players.p1.properties.Brown={cards:[card('b1','PROPERTY',1),card('b2','PROPERTY',1)]};
  s.players.p1.hand=[card('rent','RENT',1,{title:'Rent',colors:['Brown','LightBlue']}),card('d1','ACTION',1,{title:'Double The Rent'}),card('d2','ACTION',1,{title:'Double The Rent'})];
  const payload={type:'PLAY_ACTION_CARD',playerId:'p1',cardId:'rent',propertyColor:'Brown',doubleRentCardIds:['d1','d2']};
  const before=JSON.stringify(s);
  assert.strictEqual(gm.applyAction(s,{...payload,doubleRentCardIds:['d1','d1']}).legal,false);
  assert.strictEqual(gm.applyAction({...s,turn:{...s.turn,playsMade:1}},payload).legal,false);
  assert.strictEqual(JSON.stringify(s),before);
  const next=play(s,payload); assert.strictEqual(next.turn.playsMade,3); assert.strictEqual(next.pendingCharge.debtors.p2.amountOwed,8); assert.strictEqual(next.players.p1.hand.length,0); assert.strictEqual(next.discardPile.length,3);
 });
 it('rejects zero wild even alongside sufficient cash; overpayment gives no change and cannot use another players assets',()=>{
  let s=setup(); s.pendingCharge={fromPlayerId:'p1',debtors:{p2:{amountOwed:2}}};
  s.players.p2.bank=[card('large','MONEY',10)]; s.players.p1.bank=[card('theirs','MONEY',2)]; s.players.p2.properties.Red={cards:[card('zero','WILDCARD',0)]};
  const before=JSON.stringify(s);
  for (const ids of [['large','zero'],['large','large'],['theirs']]) assert.strictEqual(gm.applyAction(s,{type:'PAY_RENT',playerId:'p2',paymentCardIds:ids}).legal,false);
  assert.strictEqual(JSON.stringify(s),before); s=play(s,{type:'PAY_RENT',playerId:'p2',paymentCardIds:['large']});
  assert.strictEqual(s.players.p2.bank.length,0); assert(s.players.p1.bank.some(c=>c.id==='large')); assert(s.players.p2.properties.Red.cards.some(c=>c.id==='zero'));
 });
 it('payment optimizer excludes held cash and zero wilds, includes physical buildings',()=>{
  const s=setup(); s.players.p2.hand=[card('hand','MONEY',10)]; s.players.p2.properties.Red={cards:[card('zero','WILDCARD',0)],houseCard:card('building','ACTION',3,{title:'House'}),hasHouse:true};
  const candidates=require('../payment_optimizer').evaluatePaymentCandidates(s,'p2');
  assert.deepStrictEqual(candidates.candidates.map(c=>c.cardId),['building']); assert.strictEqual(candidates.totalLiquidValue,3);
 });
 it('keeps a physically placed building payable after its last wildcard moves away',()=>{
  let s=setup(); s.players.p1.properties.Brown={cards:[card('wild','WILDCARD',1,{colors:['Brown','LightBlue']})],houseCard:card('house','ACTION',3,{title:'House'}),hasHouse:true};
  s=play(s,{type:'REARRANGE',playerId:'p1',cardId:'wild',propertyColor:'LightBlue'}); assert.strictEqual(s.players.p1.properties.Brown.houseCard.id,'house'); assert.strictEqual(rules.calculateRentAmount(s,'p1','Brown').totalRent,0);
  s.pendingCharge={fromPlayerId:'p2',debtors:{p1:{amountOwed:2}}}; s=play(s,{type:'PAY_RENT',playerId:'p1',paymentCardIds:['house']}); assert.strictEqual(s.players.p2.bank[0].id,'house');
 });
 it('keeps the public board/replay unchanged until the nominated responder accepts, and redacts prospective effects',()=>{
  let s=setup(3); s.players.p2.properties.Red={cards:[card('red','PROPERTY',3)]}; s.players.p3.hand=[card('secret','MONEY',10)];
  s=action(s,'Sly Deal',{targetPlayerId:'p2',targetPropertyColor:'Red',targetCardId:'red'});
  assert.strictEqual(gm.applyAction(s,{type:'ACCEPT_ACTION',playerId:'p3'}).legal,false);
  const view=gm.toClientView(s,'p1'); assert(!view.pendingActionResolution.boardAfter); assert(!view.players.p3.hand); assert.strictEqual(view.players.p3.handCount,1);
  assert.strictEqual(s.replayLogs.at(-1).boardSnapshotSummary.p2.properties.Red.cardsOwned,1);
  s=pass(s,'p2'); assert.strictEqual(s.replayLogs.at(-1).boardSnapshotSummary.p1.properties.Red.cardsOwned,1);
 });
 it('enforces mandatory draws, three plays, discard to seven and five-seat turn rotation',()=>{
  let s=setup(5); s.players.p1.hand=Array.from({length:8},(_,i)=>card('m'+i,'MONEY',1)); s.turn={...s.turn,phase:'DRAW',handSizeAtStartOfTurn:8,hasDrawn:false};
  assert.strictEqual(gm.applyAction(s,{type:'PLAY_CARD',playerId:'p1',cardId:'m0',targetZone:'bank'}).legal,false);
  s=play(s,{type:'DRAW',playerId:'p1',count:2}); assert.strictEqual(s.players.p1.hand.length,10);
  for(let i=0;i<3;i++) s=play(s,{type:'PLAY_CARD',playerId:'p1',cardId:'m'+i,targetZone:'bank'});
  assert.strictEqual(gm.applyAction(s,{type:'PLAY_CARD',playerId:'p1',cardId:'m3',targetZone:'bank'}).legal,false);
  s.players.p1.hand.push(card('extra','MONEY',1)); s=play(s,{type:'END_TURN',playerId:'p1'}); assert.strictEqual(s.turn.phase,'DISCARD');
  assert.strictEqual(gm.applyAction(s,{type:'END_TURN',playerId:'p1'}).legal,false);
  s=play(s,{type:'DISCARD',playerId:'p1',cardId:'extra'}); assert.strictEqual(s.turn.playerId,'p2'); assert.strictEqual(s.turn.phase,'DRAW');
  for(const id of ['p2','p3','p4','p5']) { s=play(s,{type:'DRAW',playerId:id,count:5}); assert.strictEqual(s.players[id].hand.length,5); s=play(s,{type:'END_TURN',playerId:id}); }
  assert.strictEqual(s.turn.playerId,'p1');
 });
 it('never destroys physical buildings when an individual steal empties an incomplete group',()=>{
  let s=setup(); s.players.p2.properties.Red={cards:[card('last','PROPERTY',3)],houseCard:card('house','ACTION',3,{title:'House'}),hasHouse:true};
  s=action(s,'Sly Deal',{targetPlayerId:'p2',targetPropertyColor:'Red',targetCardId:'last'}); s=pass(s,'p2');
  assert.strictEqual(s.players.p2.properties.Red.cards.length,0); assert.strictEqual(s.players.p2.properties.Red.houseCard.id,'house'); assert.strictEqual(s.players.p1.properties.Red.cards[0].id,'last');
 });
 it('supports a third JSN in the same chain without charging additional plays',()=>{
  let s=setup(); s.players.p1.hand=[card('n1','ACTION',4,{title:'Just Say No'})]; s.players.p2.hand=[card('n2','ACTION',4,{title:'Just Say No'}),card('n3','ACTION',4,{title:'Just Say No'})];
  s=action(s,'Debt Collector',{targetPlayerId:'p2'});
  for(const [playerId,cardId] of [['p2','n2'],['p1','n1'],['p2','n3']]) s=play(s,{type:'JUST_SAY_NO',playerId,cardId});
  s=pass(s,'p1'); assert(!s.pendingCharge); assert(!s.pendingActionResolution); assert.strictEqual(s.turn.playsMade,1); assert.strictEqual(s.discardPile.filter(c=>c.title==='Just Say No').length,3);
 });
 it('enforces multiplayer seat bounds',()=>{ assert.throws(()=>setup(6)); assert.throws(()=>gm.createGameState([{id:'p',name:'a'},{id:'p',name:'b'}])); });
});
