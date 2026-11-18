const {test}=require('node:test');
const assert=require('node:assert/strict');
const solver=require('../solver');
const {demoRound,projectRows}=require('./demo');
test('demo uses 27 distinct realistic first names and valid ballots',()=>{
 const b=demoRound().ballots;
 assert.equal(new Set(b.map(x=>x.name)).size,27);
 assert.ok(b.every(x=>/^\p{L}+$/u.test(x.name)&&solver.validateBallot(x)));
 assert.ok(b.some(x=>x.name==='Lea'));
});
test('all projects have names sorted by preference, exactly three in proposal',()=>{
 const state=demoRound(); state.proposal=solver.solve({ballots:state.ballots,seed:4}).assignment;
 state.locked={ [state.ballots[0].id]:state.proposal[state.ballots[0].id] };
 const rows=projectRows(state); assert.equal(rows.length,9);
 for(const r of rows){assert.equal(r.interest.length,27);assert.deepEqual(r.interest.map(x=>x.rank),r.interest.map(x=>x.rank).toSorted((a,b)=>a-b));assert.equal(r.proposed.length+r.locked.length,3);}
 assert.equal(rows.flatMap(r=>r.proposed).some(x=>x.id===state.ballots[0].id),false);
 assert.equal(rows.filter(r=>r.interest.some(x=>x.available&&x.id===state.ballots[0].id)).length,0);
});
test('identical first names remain distinguishable without displaying student numbers',()=>{
 const s=demoRound();s.ballots[1].name=s.ballots[0].name;
 const a=projectRows(s)[0].interest.filter(x=>x.name===s.ballots[0].name);
 assert.deepEqual(new Set(a.map(x=>x.label)),new Set(['Lea (A)','Lea (B)']));
});
