(() => {
'use strict';
const {demoRound,projectRows,projects}=window.SeminarViews;
const byId=id=>document.getElementById(id);
const local=location.protocol==='file:';
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const list=byId('project-list');
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
 byId('propose').disabled=busy||state?.ballots.length!==27||Object.keys(state?.locked||{}).length===27;
 for(const id of ['refresh','view-demo','back-live','login-submit','logout'])byId(id).disabled=busy;
 byId('export').disabled=busy||Object.keys(state?.locked||{}).length!==27;
 list.querySelectorAll('[data-set],[data-unset],[data-manual]').forEach(b=>b.disabled=busy||(b.hasAttribute('data-manual')&&!b.closest('form').elements.person.value));
 list.querySelectorAll('[data-expand]').forEach(b=>b.disabled=busy||b.dataset.blocked==='true');
}
function activateDemo(){state=demoRound();demo=true;notice();render();byId('propose').focus();}
function rank(x){return `${x.rank}. Priorität`;}
function entry(x,button){return `<li><span>${esc(x.label)} <span class="tag">${rank(x)}</span></span>${button}</li>`;}
function render(){
 const previousOpen=new Set([...list.querySelectorAll('details[open]')].map(el=>el.id));
 show('signin',!state&&!busy);show('work',!!state);show('demo-banner',demo);show('back-live',demo&&!local);
 show('session-controls',!local&&!!state);show('live-tabs',!local);
 show('view-demo',!demo&&!!state);show('refresh',!demo&&!!state);show('invite',!demo&&!!state);
 byId('mode-label').textContent=demo?'Testphase':'Professorenansicht';
 if(!state){list.replaceChildren();byId('totals').replaceChildren();updateButtons();return;}
 if(!demo){
  const link=byId('submit-link');link.href=state.submitUrl;link.textContent=state.submitUrl;

 }
 const fixed=Object.keys(state.locked).length;
 byId('totals').innerHTML=`<span><strong>${state.ballots.length} / 27</strong> abgegeben</span><span><strong>${fixed} / 27</strong> festgelegt</span><span>${state.proposal&&fixed<27?'Vorschlag verfügbar':fixed===27?'Alle Plätze festgelegt':'9 Gruppen mit je 3 Personen'}</span>`;
 list.innerHTML=projectRows(state).map(r=>{
  const available=r.interest.filter(x=>x.available), first=r.interest.filter(x=>x.rank===1).length;
  const cap=r.expanded?6:3, hasB=r.locked.some(x=>x.group==='B');
  const chips=[...r.locked.map(x=>`<span class="tag">${esc(x.label)} · ${rank(x)} · fest</span>`),...r.proposed.map(x=>`<span class="tag suggested">${esc(x.label)} · ${rank(x)} · Vorschlag</span>`)].join('');
  const sections=(r.expanded?['A','B']:['A']).map(g=>{
   const locked=r.locked.filter(x=>x.group===g), proposed=r.proposed.filter(x=>x.group===g);
   return `<section class="sub-section stack" data-group="${g}"><h3>Gruppe ${g} · ${locked.length}/3 fest</h3>
   ${locked.length?`<ul class="members">${locked.map(x=>entry(x,`<button type="button" class="link" data-unset="${x.id}">Freigeben</button>`)).join('')}</ul>`:''}
   ${proposed.length?`<p class="hint">Vorschlag</p><ul class="members">${proposed.map(x=>entry(x,`<button type="button" data-set="${x.id}">Festlegen</button>`)).join('')}</ul>`:`<p class="hint">${locked.length===3?'Vollständig besetzt.':state.ballots.length<27?'Vorschlag verfügbar nach 27 Abgaben.':state.proposal?'Keine weiteren Personen für diese Gruppe vorgeschlagen.':'Noch kein Vorschlag berechnet.'}</p>`}
   ${locked.length<3&&available.length?`<form class="row picker wrap"><label><span class="hint">Manuell festlegen</span><select name="person" aria-label="Noch nicht festgelegte Personen für Projekt ${r.p}, Gruppe ${g}"><option value="">Name auswählen …</option>${available.map(x=>`<option value="${x.id}">${esc(x.label)} · ${rank(x)}</option>`).join('')}</select></label><button type="submit" data-manual disabled>Festlegen</button></form>`:''}</section>`;
  }).join('');
  const body=`<div class="body stack"><div><label class="extra"><input type="checkbox" data-expand="${r.p}" data-blocked="${hasB}" ${r.expanded?'checked':''}> Zweite Gruppe freigeben (3 zusätzliche Plätze)</label><p class="hint">${hasB?'Zum Deaktivieren zuerst die Festlegungen in Gruppe B freigeben.':'Bei 27 Studierenden gibt es insgesamt neun Dreiergruppen. Jede besetzte zweite Gruppe lässt ein anderes Projekt frei.'}</p></div>${sections}
  <div class="sub-section"><h3>Wunschliste nach Priorität</h3><p class="hint">Historische Abgaben bleiben zur Auswertung sichtbar; festgelegte Personen sind nicht mehr auswählbar.</p><dl class="priority-groups">${projects.map(rank=>`<div><dt>Priorität ${rank}</dt><dd>${r.interest.filter(x=>x.rank===rank).map(x=>`${esc(x.label)}${x.available?'':state.locked[x.id]===r.p?' (hier fest)':' (anderswo fest)'}`).join(', ')||'–'}</dd></div>`).join('')}</dl></div></div>`;
  return `<details class="panel allocation" data-project="${r.p}" id="projekt-${r.p}" ${previousOpen.has(`projekt-${r.p}`)?'open':''}><summary><span class="summary-project"><span class="summary-name">Projekt ${r.p}</span><small class="muted">${first} Erstwünsche · ${r.locked.length}/${cap} fest${state.proposal&&!r.locked.length&&!r.proposed.length?' · bleibt frei':''}</small></span><span class="summary-chips">${chips||'<span class="hint">Wunschliste öffnen</span>'}</span></summary>${body}</details>`;
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
async function run(path,body,p){
 if(busy||!state)return;busy=true;updateButtons();
 try{
  if(demo){
   const next={...state,locked:{...state.locked},groups:{...state.groups},expanded:[...(state.expanded??[])]};
   if(path==='/api/lock'){
    if(body.project===null){delete next.locked[body.id];delete next.groups[body.id];}
    else if(!Object.hasOwn(next.locked,body.id)){next.locked[body.id]=p;next.groups[body.id]=body.group;}
    else throw Error('Dieser Platz ist nicht verfügbar.');
   }
   if(path==='/api/groups')next.expanded=[...next.expanded.filter(x=>x!==p),...(body.enabled?[p]:[])];
   window.ProjectSolver.groupBounds(next.locked,next.groups,next.expanded);
   if(path==='/api/propose'||next.proposal)next.proposal=window.ProjectSolver.solveGrouped({...next,seed:54}).assignment;
   state=next;
  }else state=await request(path,body);
  notice(path==='/api/propose'?'Vorschlag berechnet: je drei Personen pro Gruppe.':path==='/api/groups'?(body.enabled?'Zweite Gruppe freigegeben.':'Zweite Gruppe deaktiviert.'):body.project===null?'Festlegung aufgehoben.':'Platz festgelegt.');
 }catch(e){if(e.status===401)clearSession();notice(e.message,true);}
 finally{busy=false;render();if(p)byId(`projekt-${p}`)?.querySelector('summary').focus();}
}
function csv(){
 const text=['Projekt;Gruppe;Name;Priorität',...projectRows(state).flatMap(r=>r.locked.map(x=>`${r.p};${x.group};"${x.label.replace(/^[=+\-@\t\r\n]/,"'$&").replaceAll('"','""')}";${x.rank}`))].join('\r\n');
 const url=URL.createObjectURL(new Blob(['\ufeff',text],{type:'text/csv;charset=UTF-8'}));
 const anchor=document.createElement('a');anchor.href=url;anchor.download=demo?'projektvergabe-testphase.csv':'projektvergabe.csv';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),15000);
}
list.addEventListener('click',e=>{
 const b=e.target.closest('[data-set],[data-unset]');if(!b||b.disabled)return;
 const p=Number(b.closest('details').dataset.project);run('/api/lock',{id:b.dataset.set??b.dataset.unset,project:b.hasAttribute('data-set')?p:null,group:b.closest('[data-group]').dataset.group},p);
});
list.addEventListener('change',e=>{
 if(e.target.hasAttribute('data-expand')){const p=Number(e.target.dataset.expand);run('/api/groups',{project:p,enabled:e.target.checked},p);}
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
