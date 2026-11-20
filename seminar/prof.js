(() => {
'use strict';
const {demoRound,projectRows,projects}=window.SeminarViews;
const {MAX_BALLOTS}=window.ChallengeCatalog;
const byId=id=>document.getElementById(id);
const local=location.protocol==='file:';
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const list=byId('project-list');
const ballotList=byId('ballot-list'), deleteDialog=byId('delete-ballot-dialog');
let deleteId=null;
let state=null, demo=false, busy=false, qrUrl='';
const show=(id,on)=>byId(id).hidden=!on;
function notice(text='',bad=false){byId('status').textContent=text;byId('status').classList.toggle('warn',bad);}
async function request(path,body){
 const headers={};
 if(body!==undefined)headers['Content-Type']='application/json';
 const res=await fetch(path,{headers,method:body===undefined?'GET':'POST',body:body===undefined?undefined:JSON.stringify(body)});
 if(path==='/api/qr'&&res.ok)return res.blob();
 const data=await res.json();if(!res.ok)throw Object.assign(Error(data.error||'Die Anfrage konnte nicht ausgeführt werden.'),{status:res.status});return data;
}
function updateButtons(){
 byId('propose').disabled=busy||!(state?.ballots.length);
 for(const id of ['refresh','view-demo','back-live','login-submit','logout'])byId(id).disabled=busy;
 byId('confirm-all').disabled=busy||!state?.proposal||Object.keys(state.proposal).every(id=>Object.hasOwn(state.locked,id));
 byId('final-show').disabled=busy||!Object.keys(state?.locked||{}).length;
 list.querySelectorAll('[data-set],[data-unset],[data-manual]').forEach(b=>b.disabled=busy||(b.hasAttribute('data-manual')&&!b.closest('form').elements.person.value));
 list.querySelectorAll('[data-expand]').forEach(b=>b.disabled=busy||b.dataset.blocked==='true');
 list.querySelectorAll('[data-size],select[name="person"]').forEach(b=>b.disabled=busy);
 ballotList.querySelectorAll('[data-delete-ballot]').forEach(b=>b.disabled=busy);
}
function activateDemo(){state=demoRound();demo=true;notice();render();byId('propose').focus();}
function rank(x){return `${x.rank}. Priorität`;}
const person=x=>`${esc(x.label)}${x.team?` · ${esc(x.team)}`:''}`;
const capacity=(r,g)=>r.sizes[g]??r.max;
const ballotLabel=b=>`${b.name}${b.team?` · ${b.team}`:''} · Nr. ${b.id}`;

function entry(x,confirm){
 const action=confirm?'Confirm':'Undo';
 return `<li><span class="member-name break">${person(x)} <span class="tag">${rank(x)}</span></span><button type="button"${confirm?'':' class="link"'} data-${confirm?'set':'unset'}="${esc(x.id)}" aria-label="${action}: ${esc(x.label)}">${action}</button></li>`;
}
function render(){
 const previousOpen=new Set([...list.querySelectorAll('details[open]')].map(el=>el.id));
 show('signin',!state&&!busy);show('work',!!state);show('demo-banner',demo);show('back-live',demo&&!local);
 show('session-controls',!local&&!!state);show('live-tabs',!local);
 show('view-demo',!demo&&!!state);show('refresh',!demo&&!!state);show('invite',!demo&&!!state);
 show('ballot-management',!demo&&!!state);
 const ballots=demo?null:state?.ballots;
 ballotList.innerHTML=!ballots?'':ballots.length?`<ul class="members">${ballots.map(b=>{
  const label=esc(ballotLabel(b));
  return `<li class="wrap"><span class="member-name break">${label}</span><button type="button" data-delete-ballot="${esc(b.id)}" aria-label="Wunschzettel löschen: ${label}">Löschen</button></li>`;
 }).join('')}</ul>`:'<p class="hint">Noch keine Wunschzettel abgegeben.</p>';
 byId('mode-label').textContent=demo?'Testphase':'Professorenansicht';
 if(!state){list.replaceChildren();byId('totals').replaceChildren();byId('warnings').replaceChildren();updateButtons();return;}
 if(!demo){
  const link=byId('submit-link');link.href=state.submitUrl;link.textContent=state.submitUrl;

 }
 const fixed=Object.keys(state.locked).length;
 byId('totals').innerHTML=`<span><strong>${state.ballots.length} / ${MAX_BALLOTS}</strong> abgegeben</span><span><strong>${fixed} / ${state.ballots.length}</strong> bestätigt</span><span>${state.ballots.length&&fixed===state.ballots.length?'Alle Abgaben zugeteilt':state.proposal?'Vorschlag berechnet':'Noch kein Vorschlag'}</span>`;
 const warnings=state.warnings??[];
 byId('warnings').innerHTML=warnings.length?`<ul>${warnings.map(w=>`<li class="break">${esc(w)}</li>`).join('')}</ul>`:'';
 list.innerHTML=projectRows(state).map(r=>{
  const available=r.interest.filter(x=>x.available), first=r.interest.filter(x=>x.rank===1).length;
  const groups=r.expanded?['A','B']:['A'];
  const cap=groups.reduce((sum,g)=>sum+capacity(r,g),0), hasB=r.locked.some(x=>x.group==='B');
  const chip=(x,suggested)=>`<span class="tag${suggested?' suggested':''}">${person(x)} · ${rank(x)} · Gruppe ${x.group} · ${suggested?'Vorschlag':'fest'}</span>`;
  const chips=[...r.locked.map(x=>chip(x,false)),...r.proposed.map(x=>chip(x,true))].join('');
  const sections=groups.map(g=>{
   const locked=r.locked.filter(x=>x.group===g), proposed=r.proposed.filter(x=>x.group===g);
   const limit=capacity(r,g), id=`gruppe-${r.p}-${g}`;
   return `<section class="sub-section stack allocation-group" data-group="${g}" aria-labelledby="${id}">
   <div class="row spread wrap group-header"><h3 id="${id}">Gruppe ${g} · ${locked.length}/${limit} fest</h3>
   <label class="group-capacity row wrap">Maximale Größe <select id="size-${r.p}-${g}" data-size aria-label="Maximale Größe für ${esc(r.title)}, Gruppe ${g}"><option value="">Automatisch (max. ${r.max})</option>${Array.from({length:r.max},(_,i)=>i+1).map(n=>`<option value="${n}"${r.sizes[g]===n?' selected':''}>${n}</option>`).join('')}</select></label></div>
   ${locked.length?`<ul class="members">${locked.map(x=>entry(x,false)).join('')}</ul>`:''}
   ${proposed.length?`<p class="hint">Vorschlag</p><ul class="members">${proposed.map(x=>entry(x,true)).join('')}</ul>`:`<p class="hint">${locked.length>=limit?'Kapazität erreicht.':state.proposal?'Keine weiteren Personen für diese Gruppe vorgeschlagen.':'Noch kein Vorschlag berechnet.'}</p>`}
   ${locked.length<limit&&available.length?`<form class="row picker wrap"><label><span class="hint">Manuell zuteilen</span><select name="person" aria-label="Noch nicht bestätigte Personen für ${esc(r.title)}, Gruppe ${g}"><option value="">Name auswählen …</option>${available.map(x=>`<option value="${esc(x.id)}">${person(x)} · ${rank(x)}</option>`).join('')}</select></label><button type="submit" data-manual disabled>Confirm</button></form>`:''}</section>`;
  }).join('');
  const body=`<div class="body stack"><div><label class="extra"><input type="checkbox" id="expand-${r.p}" data-expand="${r.p}" data-blocked="${hasB}" ${r.expanded?'checked':''}> Gruppe B freigeben</label>${hasB?'<p class="hint">Zum Deaktivieren zuerst die Zuteilungen in Gruppe B aufheben.</p>':''}</div>${sections}
  <div class="sub-section"><h3>Wunschliste nach Priorität</h3><p class="hint">Bestätigte Personen bleiben in der Wunschliste sichtbar.</p><dl class="priority-groups">${projects.map(rank=>`<div><dt>Priorität ${rank}</dt><dd>${r.interest.filter(x=>x.rank===rank).map(x=>`${person(x)}${x.available?'':state.locked[x.id]===r.p?' (hier fest)':' (anderswo fest)'}`).join(', ')||'–'}</dd></div>`).join('')}</dl></div></div>`;
  return `<details class="panel allocation" data-project="${r.p}" id="projekt-${r.p}" ${previousOpen.has(`projekt-${r.p}`)?'open':''}><summary><span class="summary-project"><span class="summary-name">${esc(r.title)} <i class="challenge-size">(max. ${r.max} Personen je Gruppe)</i></span><small class="muted">${first} Erstwünsche · ${r.locked.length}/${cap} fest</small></span><span class="summary-chips">${chips||'<span class="hint">Wunschliste öffnen</span>'}</span></summary>${body}</details>`;
 }).join('');
 updateButtons();
}
function clearSession(){
 state=null;demo=false;if(qrUrl)URL.revokeObjectURL(qrUrl);qrUrl='';byId('qr').removeAttribute('src');
}
async function loadLive(password){
 if(busy)return;busy=true;updateButtons();notice('Abgaben werden geladen …');
 const signingIn=typeof password==='string',hadState=!!state;
 try{
  if(signingIn)await request('/api/login',{password});
  const next=await request('/api/prof');state=next;demo=false;render();notice('');
  if(!qrUrl){const svg=await request('/api/qr');qrUrl=URL.createObjectURL(svg);byId('qr').src=qrUrl;}
 }catch(e){if(e.status===401)clearSession();notice(e.status===401&&!signingIn&&!hadState?'':e.message,true);}
 finally{busy=false;render();}
}
function updateDemo(path,body){
 const {project,group,id,size,enabled}=body;
 const next={...state,locked:{...state.locked},groups:{...state.groups}};
 if(path==='/api/lock'){
  if(project===null){delete next.locked[id];delete next.groups[id];}
  else if(!Object.hasOwn(next.locked,id)){next.locked[id]=project;next.groups[id]=group;}
  else throw Error('Die bestehende Zuteilung muss zuerst aufgehoben werden.');
 }
 if(path==='/api/groups')next.expanded=[...state.expanded.filter(x=>x!==project),...(enabled?[project]:[])];
 if(path==='/api/size'){
  const limits={...state.sizes[project]};
  if(size===null)delete limits[group];else limits[group]=size;
  next.sizes={...state.sizes,[project]:limits};
 }
 const {checkLocks,solve,confirmAll}=window.ChallengeAllocation;
 if(path==='/api/confirm-all')Object.assign(next,confirmAll(state,body.entries));
 checkLocks(next);
 if(path==='/api/propose'||next.proposal){
  const {assignment,teamAssignments,warnings}=solve(next);
  Object.assign(next,{proposal:assignment,proposalGroups:teamAssignments,warnings});
 }
 return next;
}
async function run(path,body,p,focusId){
 if(busy||!state)return;busy=true;updateButtons();
 try{
  state=demo?updateDemo(path,body):await request(path,body);
  notice(path==='/api/propose'?'Vorschlag berechnet.':path==='/api/groups'?(body.enabled?'Gruppe B freigegeben.':'Gruppe B deaktiviert.'):
   path==='/api/ballot/delete'?'Wunschzettel gelöscht.':path==='/api/size'?'Maximale Gruppengröße aktualisiert.':path==='/api/confirm-all'?`${body.entries.length} Zusortierung(en) bestätigt.`:body.project===null?'Zuteilung aufgehoben.':'Zuteilung bestätigt.');
 }catch(e){if(e.status===401)clearSession();notice(e.message,true);}
 finally{busy=false;render();if(p)((focusId&&byId(focusId))||byId(`projekt-${p}`)?.querySelector('summary'))?.focus();}
}
ballotList.addEventListener('click',e=>{
 const button=e.target.closest('[data-delete-ballot]');
 if(!button||busy||demo||!state)return;
 const ballot=state.ballots.find(b=>b.id===button.dataset.deleteBallot);
 if(!ballot)return;
 deleteId=ballot.id;
 deleteDialog.returnValue='cancel';
 byId('delete-ballot-target').textContent=ballotLabel(ballot);
 deleteDialog.showModal();
});
deleteDialog.addEventListener('close',async()=>{
 const id=deleteId;
 deleteId=null;
 byId('delete-ballot-target').textContent='';
 if(deleteDialog.returnValue!=='delete'||!id||busy||demo||!state)return;
 await run('/api/ballot/delete',{id});
 byId(state?'ballot-management-summary':'password').focus();
});
function csv(){
 const field=value=>`"${String(value??'').replace(/^\s*[=+\-@\t\r\n]/,"'$&").replaceAll('"','""')}"`;
 const text=['Nr.;Challenge;Gruppe;Name;Teamname;Priorität',...projectRows(state).flatMap(r=>r.locked.map(x=>`${r.p};${field(r.title)};${x.group};${field(x.label)};${field(x.team)};${x.rank}`))].join('\r\n');
 const url=URL.createObjectURL(new Blob(['\ufeff',text],{type:'text/csv;charset=UTF-8'}));
 const anchor=document.createElement('a');anchor.href=url;anchor.download=demo?'projektvergabe-testphase.csv':'projektvergabe.csv';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),15000);
}
function showFinal(){
 const rows=projectRows(state).filter(r=>r.locked.length);
 byId('final-count').textContent=`${Object.keys(state.locked).length} von ${state.ballots.length} eingegangenen Abgaben bestätigt. Nicht bestätigte Vorschläge sind nicht enthalten.`;
 byId('final-list').innerHTML=rows.map(r=>`<section><h3>${r.p}. ${esc(r.title)}</h3>${['A','B'].map(g=>{
  const members=r.locked.filter(x=>x.group===g);
  return members.length?`<h4>Gruppe ${g}</h4><ul>${members.map(x=>`<li class="break">${person(x)} · ${rank(x)}</li>`).join('')}</ul>`:'';
 }).join('')}</section>`).join('');
 byId('final-dialog').showModal();
}
list.addEventListener('click',e=>{
 const b=e.target.closest('[data-set],[data-unset]');if(!b||b.disabled)return;
 const p=Number(b.closest('details').dataset.project);run('/api/lock',{id:b.dataset.set??b.dataset.unset,project:b.hasAttribute('data-set')?p:null,group:b.closest('[data-group]').dataset.group},p);
});
list.addEventListener('change',e=>{
 const target=e.target;
 if(target.hasAttribute('data-expand')){const p=Number(target.dataset.expand);run('/api/groups',{project:p,enabled:target.checked},p,target.id);}
 else if(target.hasAttribute('data-size')){
  const p=Number(target.closest('details').dataset.project), group=target.closest('[data-group]').dataset.group;
  run('/api/size',{project:p,group,size:target.value===''?null:Number(target.value)},p,target.id);
 }
 else updateButtons();
});
list.addEventListener('submit',e=>{
 e.preventDefault();const id=e.target.elements.person.value,p=Number(e.target.closest('details').dataset.project),group=e.target.closest('[data-group]').dataset.group;if(id)run('/api/lock',{id,project:p,group},p);
});
byId('copy-link').onclick=async()=>{
 try{await navigator.clipboard.writeText(state.submitUrl);notice('Abgabelink kopiert.');}
 catch{const selection=getSelection(), range=document.createRange();range.selectNodeContents(byId('submit-link'));selection.removeAllRanges();selection.addRange(range);notice('Link markiert. Kopieren Sie ihn mit Strg+C.');}
};
byId('propose').onclick=()=>run('/api/propose',{});byId('refresh').onclick=loadLive;byId('export').onclick=csv;
byId('confirm-all').onclick=()=>run('/api/confirm-all',{entries:window.ChallengeAllocation.pending(state)});
byId('final-show').onclick=showFinal;
byId('export-pdf').onclick=()=>{
 if(demo){window.print();return;}
 const link=document.createElement('a');link.href='/api/final.pdf';link.download='zusortierung.pdf';link.click();
};
byId('view-demo').onclick=activateDemo;byId('back-live').onclick=loadLive;
byId('login').onsubmit=e=>{
 e.preventDefault();if(busy)return;const input=byId('password'),password=input.value;input.value='';
 loadLive(password).then(()=>{if(!state)input.focus();});
};
byId('logout').onclick=async()=>{
 if(busy)return;busy=true;updateButtons();
 try{await request('/api/logout',{});clearSession();notice('Abgemeldet.');}
 catch(e){notice(e.message,true);}
 finally{busy=false;render();if(!state)byId('password').focus();}
};
if(local)activateDemo();else loadLive();
})();
