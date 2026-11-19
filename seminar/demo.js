(() => {
'use strict';
const node=typeof module==='object'&&module.exports;
const {challenges}=node?require('./challenges'):window.ChallengeCatalog;
const projects=challenges.map(c=>c.id);
const names=['Lea','Mika','Aylin','Jonas','Emma','Noah','Sofia','Elias','Mila','Lukas','Amira','Felix','Clara','Finn','Nora','Samir','Lina','Paul','Leni','Oskar','Mara','Yusuf','Hannah','Nico','Jana','Tobias','Alina'];
const first=[1,2,3,4,5,6,7,8,9,10,2,3,4,5,1,2,3,4,5,1,2,3,4,5,1,2,1];
const score=(p,i)=>(p*13+i*7+p*i*5)%29+(p>5?13:0);
function demoRound(){return {
 ballots:names.map((name,i)=>({name,id:String(i+1).padStart(2,'0'),...(i<2?{team:'Team Main'}:{}),
  ranks:[first[i],...projects.filter(p=>p!==first[i]).sort((a,b)=>score(a,i)-score(b,i))]})),
 codes:[],locked:{},groups:{},expanded:[],sizes:{},proposal:null,proposalGroups:{},warnings:[],submitUrl:''
};}
function projectRows(state){
 const groups=new Map(), labels=new Map();
 for(const b of [...state.ballots].sort((a,b)=>a.id.localeCompare(b.id))){const k=b.name.toLocaleLowerCase('de');const group=groups.get(k)||[];group.push(b);groups.set(k,group);}
 for(const group of groups.values())group.forEach((b,i)=>labels.set(b.id,group.length>1?`${b.name} (${String.fromCharCode(65+i)})`:b.name));
 return challenges.map(({id:p,title,min,max})=>{
  const interest=state.ballots.map(b=>({...b,label:labels.get(b.id),rank:b.ranks.indexOf(p)+1,available:!Object.hasOwn(state.locked,b.id)})).sort((a,b)=>a.rank-b.rank||a.label.localeCompare(b.label,'de')||a.id.localeCompare(b.id));
  const locked=interest.filter(b=>state.locked[b.id]===p).map(b=>({...b,group:state.groups?.[b.id]??'A'}));
  const proposed=interest.filter(b=>b.available&&state.proposal?.[b.id]===p).map(b=>({...b,group:state.proposalGroups?.[b.id]??'A'}));
  return {p,title,min,max,interest,locked,proposed,sizes:state.sizes?.[p]??{},expanded:state.expanded?.includes(p)??false};
 });
}
const api={demoRound,projectRows,projects};
if(node)module.exports=api;else window.SeminarViews=api;
})();
