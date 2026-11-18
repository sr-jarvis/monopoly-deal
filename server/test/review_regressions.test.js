'use strict';
const assert = require('assert');
const gm = require('../game_manager');
const p = (id,color) => ({id,kind:'PROPERTY',color,value:1});
function fixture() {
 const s=gm.createGameState([{id:'a',name:'A'},{id:'b',name:'B'}]);
 Object.values(s.players).forEach(x=>Object.assign(x,{hand:[],bank:[],properties:{}}));
 s.turn={playerId:'a',phase:'ACTION',playsMade:0,hasDrawn:true,handSizeAtStartOfTurn:5};
 s.players.a.properties={Brown:{cards:[p('baltic','Brown')]},DarkBlue:{cards:[p('d1','DarkBlue'),p('d2','DarkBlue')]},Utility:{cards:[p('u1','Utility'),p('u2','Utility')]}};
 s.players.b.properties={'Brown#2':{cards:[p('med','Brown')]}};
 return s;
}
function act(s, action) { const r=gm.applyAction(s,action); assert.strictEqual(r.legal,true,r.reason); return r.gameState; }
describe('Review regressions: recipient-local property grouping',()=>{
 for (const title of ['Sly Deal','Forced Deal']) it(`${title} from donor secondary group completes recipient primary group only after acceptance`,()=>{
  let s=fixture(); s.players.a.hand=[{id:'action',kind:'ACTION',title,value:3}];
  if(title==='Forced Deal') s.players.a.properties.Orange={cards:[p('offer','Orange')]};
  s=act(s,{type:'PLAY_ACTION_CARD',playerId:'a',cardId:'action',targetPlayerId:'b',targetPropertyColor:'Brown#2',targetCardId:'med',offeredPropertyColor:'Orange',offeredCardId:'offer',requestedPropertyColor:'Brown#2',requestedCardId:'med'});
  assert.strictEqual(s.status,'IN_PROGRESS'); assert.strictEqual(s.players.a.properties.Brown.cards.length,1);
  s=act(s,{type:'ACCEPT_ACTION',playerId:'b'});
  assert.deepStrictEqual(s.players.a.properties.Brown.cards.map(c=>c.id),['baltic','med']);
  assert.strictEqual(s.status,'FINISHED');assert.strictEqual(s.winnerId,'a');
 });
 it('property payment combines recipient incomplete group and triggers third-color win',()=>{
  let s=fixture(); s.pendingCharge={fromPlayerId:'a',sourceTitle:'Debt Collector',debtors:{b:{amountOwed:5}}};
  s=act(s,{type:'PAY_RENT',playerId:'b',paymentCardIds:['med']});
  assert.strictEqual(s.players.a.properties.Brown.cards.length,2);assert.strictEqual(s.winnerId,'a');
 });
 it('does not merge an individual transfer into a completed set or duplicate its buildings',()=>{
  let s=fixture();delete s.players.a.properties.Utility;
  s.players.a.properties.Brown.cards.push(p('old','Brown'));s.players.a.properties.Brown.houseCard={id:'h',kind:'ACTION',title:'House',value:3};s.players.a.properties.Brown.hasHouse=true;
  s.pendingCharge={fromPlayerId:'a',sourceTitle:'Debt Collector',debtors:{b:{amountOwed:5}}};
  s=act(s,{type:'PAY_RENT',playerId:'b',paymentCardIds:['med']});
  assert.strictEqual(s.players.a.properties.Brown.cards.length,2);assert.strictEqual(s.players.a.properties.Brown.houseCard.id,'h');
  assert.deepStrictEqual(s.players.a.properties['Brown#2'].cards.map(c=>c.id),['med']);
 });
});
