'use strict';
const assert = require('assert');
const gm = require('../game_manager');
const rules = require('../rules_validator');
function setup() {
 const s=gm.createGameState([{id:'p1',name:'One'},{id:'p2',name:'Two'}]);
 for(const p of Object.values(s.players)) Object.assign(p,{hand:[],bank:[],properties:{}});
 s.turn={playerId:'p1',phase:'ACTION',playsMade:0,hasDrawn:true,handSizeAtStartOfTurn:5}; return s;
}
const property = (id, color='Brown')=>({id,kind:'PROPERTY',color,value:1});
const group = (prefix)=>({cards:[property(prefix+'1'),property(prefix+'2')],hasHouse:false,hasHotel:false});
function apply(s,a) { const r=gm.applyAction(s,{playerId:'p1',...a}); assert.strictEqual(r.legal,true,r.reason); return r.gameState; }
describe('independent same-color property sets',()=>{
 it('places native property in a second same-color set but never recolors it',()=>{
  const s=setup(); s.players.p1.properties.Brown=group('b'); s.players.p1.hand=[property('new')];
  const next=apply(s,{type:'PLAY_CARD',cardId:'new',targetZone:'properties',propertyColor:'Brown#2'});
  assert.strictEqual(next.players.p1.properties.Brown.cards.length,2);
  assert.strictEqual(next.players.p1.properties['Brown#2'].color,'Brown');
  assert.strictEqual(gm.applyAction(s,{type:'PLAY_CARD',playerId:'p1',cardId:'new',targetZone:'properties',propertyColor:'Red#2'}).legal,false);
 });
 it('moves a wildcard between own same-color sets for free, preserving each building',()=>{
  const s=setup(); s.players.p1.properties.Brown=group('b'); s.players.p1.properties.Brown.cards.push({id:'w',kind:'WILDCARD',colors:['Brown','LightBlue'],value:1});
  s.players.p1.properties.Brown.hasHouse=true; s.players.p1.properties.Brown.houseCard={id:'h',kind:'ACTION',title:'House',value:3};
  const next=apply(s,{type:'REARRANGE',cardId:'w',propertyColor:'Brown#2'});
  assert.strictEqual(next.turn.playsMade,0); assert.strictEqual(next.players.p1.properties.Brown.houseCard.id,'h');
  assert.strictEqual(next.players.p1.properties['Brown#2'].cards[0].id,'w');
 });
 it('prices each set independently and applies buildings only to their selected set',()=>{
  let s=setup(); s.players.p1.properties.Brown=group('b'); s.players.p1.properties['Brown#2']=group('c');
  s.players.p1.hand=[{id:'h',kind:'ACTION',title:'House',value:3},{id:'hotel',kind:'ACTION',title:'Hotel',value:4}];
  s=apply(s,{type:'PLAY_ACTION_CARD',cardId:'h',propertyColor:'Brown#2'});
  s=apply(s,{type:'PLAY_ACTION_CARD',cardId:'hotel',propertyColor:'Brown#2'});
  assert.strictEqual(rules.calculateRentAmount(s,'p1','Brown').totalRent,2);
  assert.strictEqual(rules.calculateRentAmount(s,'p1','Brown#2').totalRent,9);
  s.players.p1.hand=[{id:'rent',kind:'RENT',title:'Rent',colors:['Brown','LightBlue'],value:1}];
  s=apply(s,{type:'PLAY_ACTION_CARD',cardId:'rent',propertyColor:'Brown#2'});
  assert.strictEqual(s.pendingCharge.debtors.p2.amountOwed,9);
 });
 it('steals only the targeted group with its own buildings, never merging an existing same-color set',()=>{
  let s=setup(); s.players.p1.properties.Brown=group('a'); s.players.p2.properties.Brown=group('b'); s.players.p2.properties['Brown#2']=group('c');
  s.players.p1.properties.Brown.hasHouse=true; s.players.p1.properties.Brown.houseCard={id:'own-house',kind:'ACTION',title:'House',value:3};
  s.players.p1.properties.Brown.hasHotel=true; s.players.p1.properties.Brown.hotelCard={id:'own-hotel',kind:'ACTION',title:'Hotel',value:4};
  s.players.p2.properties['Brown#2'].hasHouse=true; s.players.p2.properties['Brown#2'].houseCard={id:'h',kind:'ACTION',title:'House',value:3};
  s.players.p2.properties['Brown#2'].hasHotel=true; s.players.p2.properties['Brown#2'].hotelCard={id:'target-hotel',kind:'ACTION',title:'Hotel',value:4};
  s.players.p1.hand=[{id:'db',kind:'ACTION',title:'Deal Breaker',value:5}];
  s=apply(s,{type:'PLAY_ACTION_CARD',cardId:'db',targetPlayerId:'p2',targetPropertyColor:'Brown#2'});
  s=apply(s,{type:'ACCEPT_ACTION',playerId:'p2'});
  assert.strictEqual(s.players.p2.properties.Brown.cards[0].id,'b1'); assert(!s.players.p2.properties['Brown#2']);
  assert.strictEqual(s.players.p1.properties.Brown.houseCard.id,'own-house'); assert.strictEqual(s.players.p1.properties.Brown.hotelCard.id,'own-hotel');
  assert.strictEqual(s.players.p1.properties['Brown#2'].hotelCard.id,'target-hotel');
  assert.strictEqual(s.players.p1.properties.Brown.cards.length,2); assert.strictEqual(s.players.p1.properties['Brown#2'].houseCard.id,'h'); assert.strictEqual(s.players.p1.bank.length,0);
 });
 it('counts distinct base colors even when only secondary groups are complete',()=>{
  const s=setup(); s.players.p1.properties.Brown=group('a'); s.players.p1.properties['Brown#2']=group('b'); s.players.p1.properties['Brown#3']=group('c');
  assert.strictEqual(rules.checkWinCondition(s.players.p1).isWinner,false);
  s.players.p1.properties['Utility#2']=group('u'); s.players.p1.properties['DarkBlue#2']=group('d');
  assert.strictEqual(rules.checkWinCondition(s.players.p1).isWinner,true);
 });
 it('takes one complete set from a legacy overfull color pile and leaves surplus behind',()=>{
  let s=setup(); s.players.p2.properties.Brown={...group('b'),cards:[property('b1'),property('b2'),property('extra')],hasHouse:true,houseCard:{id:'h',title:'House',kind:'ACTION',value:3}};
  s.players.p1.hand=[{id:'db',kind:'ACTION',title:'Deal Breaker',value:5}];
  s=apply(s,{type:'PLAY_ACTION_CARD',cardId:'db',targetPlayerId:'p2',targetPropertyColor:'Brown'}); s=apply(s,{type:'ACCEPT_ACTION',playerId:'p2'});
  assert.deepStrictEqual(s.players.p1.properties.Brown.cards.map(c=>c.id),['b1','b2']);
  assert.deepStrictEqual(s.players.p2.properties.Brown.cards.map(c=>c.id),['extra']);
  assert.strictEqual(s.players.p1.properties.Brown.houseCard.id,'h'); assert(!s.players.p2.properties.Brown.hasHouse);
 });
 it('protects complete secondary groups from Sly Deal while permitting incomplete siblings',()=>{
  let s=setup(); s.players.p2.properties.Brown=group('b'); s.players.p2.properties['Brown#2']={cards:[property('extra')]}; s.players.p1.hand=[{id:'sly',kind:'ACTION',title:'Sly Deal',value:3}];
  assert.strictEqual(gm.applyAction(s,{playerId:'p1',type:'PLAY_ACTION_CARD',cardId:'sly',targetPlayerId:'p2',targetPropertyColor:'Brown',targetCardId:'b1'}).legal,false);
  s=apply(s,{type:'PLAY_ACTION_CARD',cardId:'sly',targetPlayerId:'p2',targetPropertyColor:'Brown#2',targetCardId:'extra'}); s=apply(s,{type:'ACCEPT_ACTION',playerId:'p2'});
  assert.strictEqual(s.players.p2.properties.Brown.cards.length,2); assert(!s.players.p2.properties['Brown#2']);
 });
 it('bot rent, building and Deal Breaker selectors recognize secondary set identities',()=>{
  const planner=require('../turn_planner'); const s=setup(); s.players.p1.properties['Brown#2']=group('b'); s.players.p1.hand=[{id:'h',kind:'ACTION',title:'House',value:3},{id:'rent',kind:'RENT',title:'Rent',colors:['Brown','LightBlue'],value:1},{id:'db',kind:'ACTION',title:'Deal Breaker',value:5}];
  assert.strictEqual(planner.selectBuildingCardPlay(s,'p1').propertyColor,'Brown#2');
  assert.strictEqual(planner.selectRentCardPlay(s,'p1').propertyColor,'Brown#2');
  s.players.p2.properties['DarkBlue#2']={cards:[property('d1','DarkBlue'),property('d2','DarkBlue')]};
  assert.strictEqual(planner.selectDealBreakerPlay(s,'p1').targetPropertyColor,'DarkBlue#2');
 });
 it('cancels a secondary-group Deal Breaker without moving either sibling or building',()=>{
  let s=setup(); s.players.p2.properties.Brown=group('b'); s.players.p2.properties['Brown#2']=group('c');
  s.players.p1.hand=[{id:'db',kind:'ACTION',title:'Deal Breaker',value:5}]; s.players.p2.hand=[{id:'no',kind:'ACTION',title:'Just Say No',value:4}];
  s=apply(s,{type:'PLAY_ACTION_CARD',cardId:'db',targetPlayerId:'p2',targetPropertyColor:'Brown#2'});
  s=apply(s,{type:'JUST_SAY_NO',playerId:'p2',cardId:'no'}); s=apply(s,{type:'ACCEPT_ACTION'});
  assert.strictEqual(s.players.p2.properties.Brown.cards.length,2); assert.strictEqual(s.players.p2.properties['Brown#2'].cards.length,2); assert.deepStrictEqual(s.players.p1.properties,{});
 });
 it('matches rent cards and building exclusions to the base color of a secondary set',()=>{
  const s=setup(); s.players.p1.properties['Utility#2']={cards:[property('u1','Utility'),property('u2','Utility')]};
  s.players.p1.hand=[{id:'h',kind:'ACTION',title:'House',value:3},{id:'rent',kind:'RENT',title:'Rent',colors:['Brown','LightBlue'],value:1}];
  for(const cardId of ['h','rent']) assert.strictEqual(gm.applyAction(s,{type:'PLAY_ACTION_CARD',playerId:'p1',cardId,propertyColor:'Utility#2'}).legal,false);
 });
 it('round-trips valid group identities through the wire schema, rejecting malformed identities',()=>{
  const {GameActionPayloadSchema}=require('../../shared/protocol.ts');
  assert.strictEqual(GameActionPayloadSchema.parse({type:'PLAY_ACTION_CARD',cardId:'db',targetPropertyColor:'Brown#2'}).targetPropertyColor,'Brown#2');
  for(const key of ['Brown#1','Brown#02','ALL#2','NoColor#2']) assert.strictEqual(GameActionPayloadSchema.safeParse({type:'REARRANGE',propertyColor:key}).success,false);
 });
 it('rejects malformed group keys atomically',()=>{
  const s=setup(); s.players.p1.hand=[property('new')]; const before=JSON.stringify(s);
  for(const key of ['Brown#0','Brown#1','Brown#02','Brown#x','__proto__','ALL#2']) assert.strictEqual(gm.applyAction(s,{type:'PLAY_CARD',playerId:'p1',cardId:'new',targetZone:'properties',propertyColor:key}).legal,false,key);
  assert.strictEqual(JSON.stringify(s),before);
 });
});
