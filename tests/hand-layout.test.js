import test from 'node:test';
import assert from 'node:assert/strict';
import {computeHandLayout,arrangeHand,assessSelection} from '../hand-layout.js';
import {createDeck,classify} from '../engine.js';
test('hand layout bounds rows and exposes readable corners without dropping cards',()=>{
 for(const [width,height] of [[304,568],[374,844],[548,320],[824,390],[1260,900]])for(const large of [false,true])for(let count=0;count<=27;count++){
  const l=computeHandLayout(count,width,height,large);assert.ok(l.rows<=(width>height?1:2));assert.ok(l.perRow*l.rows>=count);assert.ok(l.step>=(large?27:23));assert.ok(Number.isFinite(l.rowWidth));
  if(!l.scrollable)assert.ok(l.rowWidth<=l.available+.5);
 }
});
test('small screens retain horizontal scroll, larger screens fit all rows',()=>{
 assert.equal(computeHandLayout(27,304,568,false).rows,2);assert.equal(computeHandLayout(27,304,568,false).scrollable,true);
 assert.equal(computeHandLayout(27,548,320,false).rows,1);assert.equal(computeHandLayout(27,548,320,false).scrollable,true);
 assert.equal(computeHandLayout(27,824,390,false).scrollable,false);
});
test('rank and suit arrangements never mutate or lose the original cards',()=>{
 const hand=createDeck().slice(0,27),ids=hand.map(c=>c.id);for(const mode of ['rank','group','suit'])assert.deepEqual(arrangeHand(hand,2,mode).map(c=>c.id).sort(),[...ids].sort());assert.deepEqual(hand.map(c=>c.id),ids);
});
test('selection feedback separates incomplete and too-small hands',()=>{
 const c=(rank,id)=>({rank,suit:'S',id});assert.equal(assessSelection([],2).reason,'empty');assert.equal(assessSelection([c(3,'a'),c(5,'b')],2).reason,'invalid');
 const target=classify([c(6,'x')],2);assert.equal(assessSelection([c(3,'a')],2,target).reason,'too-small');assert.equal(assessSelection([c(7,'a')],2,target).valid,true);
});
