const {test}=require('node:test');
const assert=require('node:assert/strict');
const {demoBallots, candidates, groupMembers, locksFeasible, csvReport}=require('./app.js');
test('demo covers 27 unique students and 4–5 overbooked first choices',()=>{
 const ballots=demoBallots(); assert.equal(new Set(ballots.map(b=>b.id)).size,27);
 const n=Array.from({length:9},(_,i)=>ballots.filter(b=>b.ranks[0]===i+1).length).filter(n=>n>3).length;
 assert.ok(n>=4&&n<=5);
});
test('a fixed student immediately disappears from candidates for every other project',()=>{
 const ballots=demoBallots(), locked={'01':1};
 for(let p=1;p<=9;p++) assert.ok(!candidates(ballots,locked,p).some(row=>row.id==='01'));
 assert.ok(candidates(ballots,{},2).some(row=>row.id==='01'));
});
test('extra fixed seats cannot block two persons at each of the other projects',()=>{
 const ids=demoBallots().map(b=>b.id); const locked={};
 [1,1,1,1,1,1,2,2,2,2,2,2,3,3,3,4,4,4].forEach((p,i)=>locked[ids[i]]=p);
 assert.equal(locksFeasible(locked,[1,2]),false);
 delete locked[ids[17]]; assert.equal(locksFeasible(locked,[1,2]),true);
 assert.equal(locksFeasible(locked,[1]),false);
});
test('second groups are balanced and use every person once',()=>{
 assert.deepEqual(groupMembers(['a','b','c','d','e']),[['a','b','c'],['d','e']]);
 assert.deepEqual(groupMembers(['a','b','c']),[['a','b','c']]);
});
test('CSV contains project, group, achieved rank and status',()=>{
 const csv=csvReport(demoBallots(),{'01':1},'Festgelegt');
 assert.match(csv,/Kennung;Projekt;Gruppe;Wunsch;Status/); assert.match(csv,/01;1;A;1;Festgelegt/);
});
