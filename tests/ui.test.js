import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import * as engine from '../engine.js';
import * as handLayout from '../hand-layout.js';
const code=fs.readFileSync(new URL('../game.js',import.meta.url),'utf8').replace(/^import[^\n]+\n/gm,'');
function harness(storage=new Map(),width=390,height=844){
 const nodes=new Map(),events={},tasks=new Map();let next=1;
 const classes=()=>{const set=new Set();return{add:n=>set.add(n),remove:n=>set.delete(n),contains:n=>set.has(n),toggle(n,v){v=v??!set.has(n);v?set.add(n):set.delete(n)}}};
 function node(id){if(!nodes.has(id)){const n={id,hidden:id==='game',open:false,disabled:false,textContent:'',dataset:{},style:{setProperty(){}},classList:classes(),events:{},clientWidth:width-16,addEventListener(t,f){this.events[t]=f},setAttribute(){},getBoundingClientRect(){return{x:0,y:0,left:0,top:0,right:400,bottom:800}},showModal(){this.open=true},close(){this.open=false;this.events.close?.()}};let html='';Object.defineProperty(n,'innerHTML',{get:()=>html,set:v=>{html=v;for(const m of v.matchAll(/id="([^"]+)"/g))node(m[1]);if(id==='hand'||id==='picker-grid'){const prefix=id==='hand'?'card:':'picker-card:';for(const k of [...nodes.keys()])if(k.startsWith(prefix))nodes.delete(k);for(const m of v.matchAll(/data-card="([^"]+)"/g)){const c=node(prefix+m[1]);c.dataset.card=m[1]}}}});nodes.set(id,n)}return nodes.get(id)}
 ['classic','quick','practice'].forEach(m=>{node('mode:'+m).dataset.mode=m});
 const document={body:node('body'),documentElement:node('root'),hidden:false,querySelector:s=>node(s.slice(1)),querySelectorAll:s=>s==='[data-mode]'?[...nodes.values()].filter(n=>n.dataset.mode):s==='[data-card]'?[...nodes.values()].filter(n=>n.dataset.card):[],addEventListener:(t,f)=>events[t]=f};
 const window={innerWidth:width,innerHeight:height,addEventListener:(t,f)=>events[t]=f};
 const audioState={active:false,settings:{},unlocks:0,effects:[]};
 const sandbox={...engine,...handLayout,createGameAudio:()=>({configure:s=>audioState.settings={...s},setActive:a=>audioState.active=a,unlock:()=>{audioState.unlocks++;return Promise.resolve(true)},playEffect:n=>audioState.effects.push(n)}),console,Math,Set,JSON,document,window,localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},setTimeout:(fn,ms)=>{const id=next++;tasks.set(id,{fn,ms});return id},clearTimeout:id=>tasks.delete(id)};
 vm.createContext(sandbox);vm.runInContext(code+';globalThis.inspect=()=>({state,mode,selected,paused,auto,match,stats,reviewIndex});globalThis.startGame=start;globalThis.renderUI=render;globalThis.showResults=showResult;globalThis.assess=selectionAssessment;',sandbox);
 return{sandbox,node,events,tasks,storage,audioState,click:id=>{const n=node(id);if(!n.disabled)n.onclick?.({target:n})},tick(){const item=[...tasks].find(([,t])=>t.ms===650||t.ms===1300||t.ms===1900||t.ms===600);if(!item)return false;tasks.delete(item[0]);item[1].fn();return true}};
}
test('mobile modes, hints, legal play, history, settings, save and restore',()=>{for(const size of [[320,568],[390,844],[844,390],[1280,900]]){const h=harness(new Map(),...size);h.click('mode:classic');let s=h.sandbox.inspect().state;assert.equal(s.hands[0].length,27);assert.equal(h.node('game').hidden,false);h.click('hint');assert.ok(h.sandbox.inspect().selected.size>0);h.click('play');assert.ok(s.hands[0].length<27);const saved=JSON.parse(h.storage.get('guandan-game'));assert.equal(saved.state.moveNumber,1);h.click('history');assert.equal(h.node('modal').open,true);assert.match(h.node('modal-content').innerHTML,/整局出牌记录/);h.click('modal-close');h.click('settings');assert.match(h.node('modal-content').innerHTML,/AI 难度/);h.click('sound');h.click('modal-close');h.click('home');const restored=harness(h.storage,...size);restored.click('mode:quick');assert.equal(restored.node('modal').open,true);restored.click('resume');assert.equal(restored.sandbox.inspect().state.moveNumber,1);assert.equal(restored.node('game').hidden,false)}});
test('autoplay finishes real rounds, result is idempotent and replay starts fresh',()=>{for(const mode of ['classic','quick','practice']){const h=harness();h.click('mode:'+mode);h.click('auto');let ticks=0;while(!h.sandbox.inspect().state.result&&h.tick()){if(++ticks>600)throw Error('UI round failed to finish')}assert.ok(h.sandbox.inspect().state.result);h.tick();assert.equal(h.node('modal').open,true);assert.equal(h.sandbox.inspect().stats.rounds,1);h.sandbox.showResults();assert.equal(h.sandbox.inspect().stats.rounds,1);h.click('next-round');assert.equal(h.sandbox.inspect().state.result,null);assert.equal(h.sandbox.inspect().state.hands[0].length,27);assert.equal(h.sandbox.inspect().auto,false)}});
test('pause, help modal, and lobby suspend AI, resume schedules once',()=>{const h=harness();h.click('mode:classic');h.click('auto');h.events['guandan-pause']();assert.equal(h.sandbox.inspect().paused,true);assert.equal(h.tick(),false);h.events['guandan-resume']();assert.equal([...h.tasks.values()].filter(t=>t.ms===1300).length,1);h.click('help');assert.equal(h.tick(),false);h.click('modal-close');assert.equal([...h.tasks.values()].filter(t=>t.ms===1300).length,1);h.click('home');assert.equal(h.tick(),false)});
test('A match clears to 2 and double-down ranks are honest',()=>{const h=harness();h.click('mode:classic');const s=h.sandbox.inspect().state;s.result={winnerTeam:0,order:[0,2,1,3],upgrade:3,teamLevels:[14,2],nextLevel:14,matchWon:true,tiedLast:[1,3]};s.turn=null;h.sandbox.showResults();assert.equal(h.sandbox.inspect().match.level,2);assert.equal((h.node('modal-content').innerHTML.match(/双下/g)||[]).length,2);h.click('next-round');assert.equal(h.sandbox.inspect().state.level,2)});
test('four seat panels retain plays and passes, reset only after closing, and replay navigates',()=>{const h=harness();h.click('mode:classic');const s=h.sandbox.inspect().state;let played=0;while(!s.result&&played<8){const m=engine.chooseMove(s,s.turn);if(m){engine.play(s,s.turn,m.ids,m.combo);played++}else engine.pass(s,s.turn)}h.sandbox.renderUI();const current=engine.getCurrentTrick(s);for(let i=0;i<4;i++){const html=h.node('play-seat-'+i).innerHTML;if(current.plays[i])assert.match(html,/mini-hand/);if(current.lastActions[i]?.type==='pass')assert.match(html,/不出/);assert.equal(h.node('play-seat-'+i).classList.contains('winning'),s.trick?.seat===i)}h.click('history');const rounds=engine.getTrickTimeline(s);assert.ok(rounds.length);h.click('round-0');assert.match(h.node('modal-content').innerHTML,/本轮完整顺序/);assert.equal(h.sandbox.inspect().reviewIndex,0);if(rounds.length>1){h.click('review-next');assert.equal(h.sandbox.inspect().reviewIndex,1);h.click('review-prev');assert.equal(h.sandbox.inspect().reviewIndex,0)}h.click('modal-close');assert.equal(s.moveNumber,8+(s.history.filter(a=>a.type==='pass').length))});
test('card size persists and orientation controls do not mutate saved game',()=>{const h=harness();h.click('mode:classic');const before=JSON.stringify(h.sandbox.inspect().state);h.click('settings');h.node('card-size').onchange({target:{value:'large'}});assert.equal(JSON.parse(h.storage.get('guandan-settings')).cardSize,'large');assert.equal(h.node('body').classList.contains('large-cards'),true);h.click('modal-close');h.sandbox.window.location={hostname:'appassets.androidplatform.net',href:''};h.click('orientation');assert.equal(h.sandbox.window.location.href,'https://appassets.androidplatform.net/ui/landscape');h.click('orientation');assert.equal(h.sandbox.window.location.href,'https://appassets.androidplatform.net/ui/auto');h.sandbox.window.innerWidth=844;h.sandbox.window.innerHeight=390;h.node('hand').clientWidth=828;h.events.resize();assert.equal(JSON.stringify(h.sandbox.inspect().state),before);assert.equal((h.node('hand').innerHTML.match(/data-card=/g)||[]).length,27);assert.equal((h.node('hand').innerHTML.match(/class="hand-row"/g)||[]).length,1);h.sandbox.window.innerWidth=390;h.sandbox.window.innerHeight=844;h.node('hand').clientWidth=374;h.events.resize();assert.equal((h.node('hand').innerHTML.match(/class="hand-row"/g)||[]).length,2);assert.equal(JSON.stringify(h.sandbox.inspect().state),before)});
test('old saved game migrates without resetting hand or prior trick history',()=>{const h=harness();h.click('mode:classic');h.click('hint');h.click('play');const before=JSON.parse(h.storage.get('guandan-game'));delete before.state.trickNumber;h.storage.set('guandan-game',JSON.stringify(before));const r=harness(h.storage);r.click('mode:classic');r.click('resume');assert.deepEqual(JSON.parse(JSON.stringify(r.sandbox.inspect().state)),before.state);assert.ok(r.node('play-seat-0').innerHTML.includes('mini-hand'));assert.equal(r.node('body').classList.contains('playing'),true)});

// A real final user play, with a deterministic partner-first finish.
function completeFixture(h){
 h.click('mode:classic');const s=h.sandbox.inspect().state;
 s.hands=[[{id:'final-card',rank:3,suit:'S'}],[{id:'opponent-one',rank:4,suit:'S'}],[],[{id:'opponent-three',rank:5,suit:'S'}]];
 s.finished=[2];s.turn=0;h.sandbox.renderUI();h.click('card:final-card');h.click('play');
 assert.ok(s.result);return s;
}
test('final play settles stats and classic upgrade before the result timer, survives immediate reload',()=>{
 const h=harness();completeFixture(h);
 assert.equal(h.sandbox.inspect().stats.rounds,1);assert.equal(h.sandbox.inspect().stats.wins,1);
 assert.equal(h.sandbox.inspect().match.level,5);assert.equal(JSON.parse(h.storage.get('guandan-game')).roundSaved,true);
 assert.equal(h.node('modal').open,false);
 const restored=harness(h.storage);restored.click('mode:classic');
 assert.equal(restored.sandbox.inspect().state.level,5);assert.equal(restored.sandbox.inspect().stats.rounds,1);
});
test('legacy unsettled completed save is credited once on load',()=>{
 const h=harness();completeFixture(h);const saved=JSON.parse(h.storage.get('guandan-game'));saved.roundSaved=false;
 h.storage.set('guandan-game',JSON.stringify(saved));h.storage.set('guandan-stats',JSON.stringify({rounds:0,wins:0}));
 h.storage.set('guandan-match',JSON.stringify({levels:[2,2],level:2}));
 const restored=harness(h.storage);assert.equal(restored.sandbox.inspect().stats.rounds,1);assert.equal(restored.sandbox.inspect().match.level,5);
 assert.equal(harness(h.storage).sandbox.inspect().stats.rounds,1);
});
test('delayed result is canceled by home, pause, a newer dialog, or a new round',()=>{
 for(const action of ['home','pause','history','new-round']){
  const h=harness();completeFixture(h);
  const pending=[...h.tasks.values()].find(t=>t.ms===600);assert.ok(pending);
  if(action==='pause')h.events['guandan-pause']();else if(action==='new-round')h.sandbox.startGame('quick');else h.click(action);
  assert.equal([...h.tasks.values()].filter(t=>t.ms===600).length,0,action);
  // A stale callback already queued by the browser must also be harmless.
  pending.fn();
  if(action==='history')assert.match(h.node('modal-content').innerHTML,/整局出牌记录/);
  else assert.equal(h.node('modal').open,false,action);
  if(action==='pause'){
   h.events['guandan-resume']();assert.equal([...h.tasks.values()].filter(t=>t.ms===600).length,1);
   pending.fn();assert.equal(h.node('modal').open,false,'stale pre-pause timer stays canceled after resume');
   h.tick();assert.equal(h.node('modal').open,true);assert.equal(h.sandbox.inspect().stats.rounds,1);
  }
 }
});

test('invalid and too-small selections cannot enable play; empty lead cannot pass',()=>{
 const h=harness();h.click('mode:classic');const s=h.sandbox.inspect().state;
 s.hands[0]=[{id:'a',rank:3,suit:'S'},{id:'b',rank:5,suit:'H'},{id:'c',rank:3,suit:'C'}];s.turn=0;s.trick=null;h.sandbox.renderUI();
 assert.equal(h.node('pass').disabled,true);assert.equal(h.node('play').disabled,true);
 h.click('card:a');assert.equal(h.node('play').disabled,false);h.click('card:b');assert.equal(h.node('play').disabled,true);assert.match(h.node('selection-status').textContent,/暂不成牌/);
 h.click('clear');h.click('card:a');h.click('card:c');assert.equal(h.node('play').disabled,false);
 s.trick={seat:1,cards:[{id:'x',rank:6,suit:'S'},{id:'y',rank:6,suit:'H'}],combo:engine.classify([{id:'x',rank:6,suit:'S'},{id:'y',rank:6,suit:'H'}],s.level)};h.sandbox.renderUI();
 assert.equal(h.node('play').disabled,true);assert.match(h.node('selection-status').textContent,/压不过桌面/);assert.equal(h.node('pass').disabled,false);
});
test('selection clear and undo are reversible without changing the game',()=>{
 const h=harness();h.click('mode:classic');const s=h.sandbox.inspect().state,ids=s.hands[0].slice(0,2).map(c=>c.id),before=JSON.stringify(s);
 h.click('card:'+ids[0]);h.click('card:'+ids[1]);assert.equal(h.sandbox.inspect().selected.size,2);
 h.click('undo');assert.deepEqual([...h.sandbox.inspect().selected],[ids[0]]);h.click('clear');assert.equal(h.sandbox.inspect().selected.size,0);
 h.click('undo');assert.deepEqual([...h.sandbox.inspect().selected],[ids[0]]);assert.equal(JSON.stringify(s),before);
});
test('expanded picker preserves selection on done/Escape and submits exactly one legal play',()=>{
 const h=harness();h.click('mode:classic');const s=h.sandbox.inspect().state,id=s.hands[0][0].id;
 h.click('expand-hand');assert.equal(h.node('modal').open,true);assert.equal((h.node('picker-grid').innerHTML.match(/data-card=/g)||[]).length,27);
 h.click('picker-card:'+id);assert.equal(h.node('picker-play').disabled,false);h.click('picker-done');assert.equal(h.node('modal').open,false);assert.ok(h.sandbox.inspect().selected.has(id));
 h.click('expand-hand');h.node('modal').close();assert.equal(h.node('modal').classList.contains('picker-modal'),false);assert.ok(h.sandbox.inspect().selected.has(id));
 h.click('expand-hand');h.click('picker-play');assert.equal(h.node('modal').open,false);assert.equal(s.moveNumber,1);assert.equal(s.hands[0].length,26);assert.equal(h.sandbox.inspect().selected.size,0);
});
test('picker pauses AI, permits preselection and never plays out of turn',()=>{
 const h=harness();h.click('mode:classic');h.click('hint');h.click('play');const s=h.sandbox.inspect().state,id=s.hands[0][0].id;
 assert.notEqual(s.turn,0);h.click('expand-hand');assert.equal(h.tick(),false);h.click('picker-card:'+id);assert.equal(h.node('picker-play').disabled,true);h.click('picker-done');
 assert.ok(h.sandbox.inspect().selected.has(id));h.tick();assert.ok(h.sandbox.inspect().selected.has(id));
});
test('all sort modes retain every card and selection, and chosen mode persists',()=>{
 const h=harness();h.click('mode:classic');const s=h.sandbox.inspect().state,id=s.hands[0][0].id,before=JSON.stringify(s);h.click('card:'+id);
 h.click('sort');assert.match(h.node('hand').innerHTML,/rank-stack/);assert.equal((h.node('hand').innerHTML.match(/data-card=/g)||[]).length,27);assert.ok(h.sandbox.inspect().selected.has(id));
 h.click('sort');assert.match(h.node('sort').textContent,/花色/);h.click('sort');assert.match(h.node('sort').textContent,/点数/);assert.equal(JSON.stringify(s),before);
 h.click('sort');assert.equal(JSON.parse(h.storage.get('guandan-settings')).handOrder,'group');
});
test('music/effects opt-in and independent volumes persist, lobby and lifecycle gate audio',()=>{
 const h=harness();assert.equal(h.audioState.active,false);assert.equal(h.audioState.settings.musicEnabled,false);assert.equal(h.audioState.settings.effectsEnabled,false);
 h.click('mode:classic');assert.equal(h.audioState.active,true);assert.equal(h.audioState.unlocks,0);h.click('music');assert.equal(h.audioState.settings.musicEnabled,true);
 h.click('game-settings');h.click('sound');assert.equal(h.audioState.settings.effectsEnabled,true);h.node('music-volume').oninput({target:{value:'15'}});h.node('effect-volume').oninput({target:{value:'70'}});
 assert.equal(h.audioState.settings.musicVolume,.15);assert.equal(h.audioState.settings.effectsVolume,.7);h.click('modal-close');h.events['guandan-pause']();assert.equal(h.audioState.active,false);h.events['guandan-resume']();assert.equal(h.audioState.active,true);
 h.click('home');assert.equal(h.audioState.active,false);assert.equal(h.node('resume-table').hidden,false);h.click('resume-table');assert.equal(h.audioState.active,true);
 const saved=JSON.parse(h.storage.get('guandan-settings'));assert.equal(saved.musicEnabled,true);assert.equal(saved.effectsEnabled,true);assert.equal(saved.musicVolume,.15);assert.equal(saved.effectsVolume,.7);
});
test('new help explains controls, no tribute rules and muted default without modifying game',()=>{
 const h=harness();h.click('mode:practice');const before=JSON.stringify(h.sandbox.inspect().state);h.click('table-help');const html=h.node('modal-content').innerHTML;
 assert.match(html,/3 步上手/);assert.match(html,/不含进贡/);assert.match(html,/默认关闭/);h.click('modal-close');assert.equal(JSON.stringify(h.sandbox.inspect().state),before);
});
test('native pause, visibility and pagehide compose without accidentally resuming AI or audio',()=>{
 const h=harness();h.click('mode:classic');h.click('auto');h.events['guandan-pause']();h.sandbox.document.hidden=false;h.events.visibilitychange();
 assert.equal(h.sandbox.inspect().paused,true);assert.equal(h.audioState.active,false);assert.equal(h.tick(),false);
 h.events.pagehide();h.events['guandan-resume']();assert.equal(h.sandbox.inspect().paused,true);assert.equal(h.tick(),false);
 h.events.pageshow();assert.equal(h.sandbox.inspect().paused,false);assert.equal(h.audioState.active,true);assert.equal([...h.tasks.values()].filter(t=>t.ms===1300).length,1);
 h.sandbox.document.hidden=true;h.events.visibilitychange();h.events['guandan-resume']();assert.equal(h.sandbox.inspect().paused,true);assert.equal(h.tick(),false);
 h.sandbox.document.hidden=false;h.events.visibilitychange();assert.equal(h.sandbox.inspect().paused,false);assert.equal([...h.tasks.values()].filter(t=>t.ms===1300).length,1);
});
