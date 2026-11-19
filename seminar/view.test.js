const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {runInNewContext}=require('node:vm');
const read=file=>readFileSync(join(__dirname,file),'utf8');
const {demoRound,projectRows}=require('./demo');
const catalog=require('./challenges');
test('proposal rows honor the returned group even when group A has room',()=>{
 const state=demoRound(), {id}=state.ballots[0];
 state.expanded=[1];
 state.sizes={1:{A:2,B:4}};
 state.proposal={[id]:1};
 state.proposalGroups={[id]:'B'};
 const row=projectRows(state).find(r=>r.p===1);
 assert.equal(row.proposed[0].group,'B');
 assert.deepEqual(row.sizes,{A:2,B:4});
});
test('demo uses 27 distinct realistic first names and valid ballots',()=>{
 const b=demoRound().ballots;
 assert.equal(new Set(b.map(x=>x.name)).size,27);
 assert.ok(b.every(x=>/^\p{L}+$/u.test(x.name)&&catalog.validateRanks(x.ranks)));
 assert.ok(b.some(x=>x.name==='Lea'));
});
test('all challenges show ranked interest and exclude confirmed people from suggestions',()=>{
 const state=demoRound(), [{id}]=state.ballots;
 Object.assign(state,{proposal:{[id]:1},proposalGroups:{[id]:'A'},locked:{[id]:1}});
 const rows=projectRows(state); assert.equal(rows.length,10);
 for(const r of rows){assert.equal(r.interest.length,27);assert.deepEqual(r.interest.map(x=>x.rank),r.interest.map(x=>x.rank).toSorted((a,b)=>a-b));}
 assert.equal(rows.flatMap(r=>r.proposed).some(x=>x.id===state.ballots[0].id),false);
 assert.equal(rows.filter(r=>r.interest.some(x=>x.available&&x.id===state.ballots[0].id)).length,0);
});
test('identical first names remain distinguishable without displaying student numbers',()=>{
 const s=demoRound();s.ballots[1].name=s.ballots[0].name;
 const a=projectRows(s)[0].interest.filter(x=>x.name===s.ballots[0].name);
 assert.deepEqual(new Set(a.map(x=>x.label)),new Set(['Lea (A)','Lea (B)']));
});

const settle=()=>new Promise(resolve=>setImmediate(resolve));
async function dashboard(state,{local=false}={}){
 const nodes=new Map(), requests=[];
 const response=data=>({ok:true,json:async()=>data,blob:async()=>({})});
 const document={getElementById(id){
  if(!nodes.has(id))nodes.set(id,{classList:{toggle(){}},querySelectorAll:()=>[],querySelector:()=>null,
   focus(){},addEventListener(type,fn){this[type]=fn;}});
  return nodes.get(id);
 }};
 const window={SeminarViews:require('./demo'),ChallengeCatalog:catalog,ChallengeAllocation:local?require('./allocation'):undefined};
 runInNewContext(read('prof.js'),{document,window,location:{protocol:local?'file:':'https:'},URL:{createObjectURL:()=>''},
  fetch:async(path,{body})=>{if(body)requests.push([path,JSON.parse(body)]);return response(state);}});
 await settle();
 return {el:id=>nodes.get(id),requests};
}
test('dashboard shows titles, warnings and per-group actions and accepts proposals from two ballots',async()=>{
 const state=demoRound();state.ballots=state.ballots.slice(0,2);
 const [a,b]=state.ballots;
 a.team='<Team & Co>';
 Object.assign(state,{expanded:[1],sizes:{1:{B:2}},locked:{[b.id]:1},groups:{[b.id]:'A'},
  proposal:{[a.id]:1},proposalGroups:{[a.id]:'B'},warnings:['<Warnung>']});
 const {el,requests}=await dashboard(state);
 assert.equal(el('propose').disabled,false);
 const html=el('project-list').innerHTML;
 const headings=[...html.matchAll(/class="summary-name">(.+?) <i[^>]*>\(max\. (\d+) Personen je Gruppe\)<\/i>/g)];
 const escapeTitle=title=>title.replaceAll('"','&quot;');
 assert.deepEqual(headings.map(m=>m.slice(1)),catalog.challenges.map(c=>[escapeTitle(c.title),String(c.max)]));
 const groupA=html.match(/<section[^>]*data-group="A"[\s\S]*?<\/section>/)[0];
 const groupB=html.match(/<section[^>]*data-group="B"[\s\S]*?<\/section>/)[0];
 assert.match(groupB,/0\/2 fest[\s\S]*?data-size[\s\S]*?<option value="2" selected>2<\/option>/);
 assert.ok(groupB.includes(`data-set="${a.id}"`)&&!groupA.includes(`data-set="${a.id}"`));
 assert.match(groupB,/data-set[^>]*>Confirm<\/button>/);
 assert.match(groupA,/data-unset[^>]*>Undo<\/button>/);
 assert.match(html,/&lt;Team &amp; Co&gt;/);
 assert.doesNotMatch(html,/<Team & Co>/);
 assert.match(el('warnings').innerHTML,/&lt;Warnung&gt;/);
 const target={value:'3',hasAttribute:key=>key==='data-size',closest:sel=>sel==='details'?{dataset:{project:'1'}}:{dataset:{group:'B'}}};
 el('project-list').change({target});
 assert.deepEqual(requests.at(-1),['/api/size',{project:1,group:'B',size:3}]);
 await settle();
 target.value='';el('project-list').change({target});
 assert.deepEqual(requests.at(-1),['/api/size',{project:1,group:'B',size:null}]);
});
test('standalone build embeds both shared scripts before the dashboard',()=>{
 const {buildDemo}=require('./build-demo');
 const html=buildDemo();
 assert.doesNotMatch(html,/<script\b[^>]*\bsrc=/);
 assert.ok(html.indexOf('ChallengeCatalog')<html.indexOf('ChallengeAllocation'));
 assert.ok(html.includes(read('challenges.js'))&&html.includes(read('allocation.js')));
});
test('offline demo proposes, confirms and undoes using the shared allocator without requests',async()=>{
 const {el,requests}=await dashboard(null,{local:true});
 const list=el('project-list');
 el('propose').onclick();
 const id=list.innerHTML.match(/data-set="([^"]+)"/)?.[1];
 assert.ok(id,el('status').textContent);
 const row=list.innerHTML.split('<details').find(part=>part.includes(`data-set="${id}"`));
 const project=row.match(/data-project="(\d+)"/)[1];
 function action(undo){
  list.click({target:{closest:()=>({dataset:undo?{unset:id}:{set:id},hasAttribute:()=>!undo,
   closest:selector=>({dataset:selector==='details'?{project}:{group:'A'}})})}});
 }
 action(false);
 assert.ok(list.innerHTML.includes(`data-unset="${id}"`),el('status').textContent);
 action(true);
 assert.ok(!list.innerHTML.includes(`data-unset="${id}"`));
 assert.deepEqual(requests,[]);
});
