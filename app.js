(() => {
'use strict';
const projects=Array.from({length:9},(_,i)=>i+1);
const ids=Array.from({length:27},(_,i)=>String(i+1).padStart(2,'0'));
const count=(map,p)=>Object.values(map).filter(x=>x===p).length;
const capacity=(p, expanded)=>expanded.includes(p)?6:3;
const priority=(ballot,p)=>ballot.ranks.indexOf(p)+1;
function demoBallots(){
 const first=[1,2,3,4,5,6,7,8,9,1,2,3,4,5,1,2,3,4,5,1,2,3,4,5,1,2,1];
 return ids.map((id,i)=>({id,ranks:[first[i],...projects.filter(p=>p!==first[i]).sort((a,b)=>demoScore(a,i)-demoScore(b,i))]}));
}
function demoScore(p,i){return (p*13+i*7+p*i*5)%29+(p>5?13:0);}
function candidates(ballots,locked,p){return ballots.filter(b=>!Object.hasOwn(locked,b.id)).sort((a,b)=>priority(a,p)-priority(b,p)||a.id.localeCompare(b.id));}
function groupMembers(members){const split=Math.ceil(members.length/2);return members.length>3?[members.slice(0,split),members.slice(split)]:[members];}
function locksFeasible(locked,expanded){
 const used=projects.map(p=>count(locked,p));
 return used.every((n,i)=>n<=capacity(projects[i],expanded))&&used.reduce((sum,n)=>sum+Math.max(2,n),0)<=27;
}
function csvReport(ballots,map,status){
 let csv='Kennung;Projekt;Gruppe;Wunsch;Status\r\n';
 for(const p of projects){
  const members=ballots.filter(b=>map[b.id]===p).sort((a,b)=>a.id.localeCompare(b.id));
  groupMembers(members).forEach((group,i)=>group.forEach(b=>{csv+=`${b.id};${p};${i?'B':'A'};${priority(b,p)};${status}\r\n`;}));
 }
 return csv;
}
if(typeof module==='object'&&module.exports){module.exports={demoBallots,candidates,groupMembers,locksFeasible,csvReport};return;}
const {solve,validateBallot}=window.ProjectSolver;
const app=document.querySelector('#app');
const notice=document.querySelector('#notice');
const key='seminar-projektvergabe-v1';
const fresh=(demo=false)=>({demo,ballots:demo?demoBallots():[],locked:{},expanded:[],seed:crypto.getRandomValues(new Uint32Array(1))[0]||1});
let state, saved;
try{saved=localStorage.getItem(key);state=saved?JSON.parse(saved):fresh(true);}catch{state=fresh(true);}
let view='prof', selected=1, draft=[...projects], studentId='', timer, comparison=null;
const byId=id=>document.getElementById(id);
const first=p=>state.ballots.filter(b=>b.ranks[0]===p).length;
const isEligible=p=>first(p)>=6;
const complete=()=>state.ballots.length===27;
function inform(text,error=false){clearTimeout(timer);notice.textContent=text;notice.hidden=false;notice.classList.toggle('error',error);timer=setTimeout(()=>notice.hidden=true,error?10000:5500);}
function save(){try{localStorage.setItem(key,JSON.stringify(state));}catch{inform('Der Browser blockiert das lokale Speichern. Exportieren Sie die Ergebnisse vor dem Schließen.',true);}}
function rankTag(rank){return `<span class="tag${rank>=7?' alert':rank>=4?' warm':''}">${rank}. Wunsch</span>`;}
function preview(){return state.proposal||{};}
function changeProject(p){selected=p;render();byId(`project-${p}`).focus();}
function setView(next){view=next;render();}
function render(){
 byId('prof-tab').setAttribute('aria-pressed',String(view==='prof'));
 byId('student-tab').setAttribute('aria-pressed',String(view==='student'));
 view==='prof'?renderProfessor():renderStudent();
}
function renderProfessor(){
 const p=selected, fixed=Object.keys(state.locked).length, suggested=Object.keys(preview()).length;
 const current=state.ballots.filter(b=>state.locked[b.id]===p).sort((a,b)=>a.id.localeCompare(b.id));
 const recommendations=state.ballots.filter(b=>preview()[b.id]===p&&!Object.hasOwn(state.locked,b.id)).sort((a,b)=>priority(a,p)-priority(b,p)||a.id.localeCompare(b.id));
 const pool=candidates(state.ballots,state.locked,p);
 const cap=capacity(p,state.expanded), full=current.length>=cap;
 const fixedMembers=groupMembers(current);
 const visibleAssignment=Object.assign({},preview(),state.locked);
 const top3=state.ballots.filter(b=>visibleAssignment[b.id]&&priority(b,visibleAssignment[b.id])<=3).length;
 const canAdd=pool.length>0&&locksFeasible({...state.locked,[pool[0].id]:p},state.expanded);
 const demand=projects.map(rank=>state.ballots.filter(b=>priority(b,p)===rank).length);
 app.innerHTML=`<div class="intro row spread"><div><div class="eyebrow">Verwaltung · 9 Projekte</div><h1>Projekte zuteilen</h1><p class="muted">Wünsche auswerten, Vorschlag prüfen und die Vergabe festlegen.</p></div><div class="toolbar"><button id="import">Wunschzettel importieren</button><button id="calculate" class="primary" ${complete()?'':'disabled'}>Vorschlag berechnen</button><input id="files" type="file" accept=".json,application/json" multiple hidden></div></div>
 ${state.demo?'<p class="empty" style="margin-bottom:14px"><strong>Beispielrunde.</strong> Die 27 Ranglisten sind fiktiv. <button class="link" id="start-real">Leere Runde beginnen</button></p>':''}
 <div class="stats" aria-label="Übersicht"><div class="metric"><strong>${state.ballots.length} / 27</strong><span>Wunschzettel</span></div><div class="metric"><strong>${fixed} / 27</strong><span>Festgelegt</span></div><div class="metric"><strong>${projects.filter(p=>first(p)>3).length}</strong><span>Überbucht nach Erstwunsch</span></div><div class="metric"><strong>${suggested||fixed?top3:'–'}</strong><span>Unter den Top 3${suggested?' im Vorschlag':''}</span></div></div>
 <div class="grid"><section class="panel stack" aria-labelledby="demand"><div><h2 id="demand">Nachfrage</h2><p class="hint">Überbucht heißt: mehr als 3 Erstwünsche. Ab 6 ist eine zweite Gruppe möglich.</p></div><p class="project-legend hint"><span>Projekt</span><span>Erst</span><span>Fest</span></p><div class="project-list">${projects.map(i=>{const n=first(i);return `<button class="project" id="project-${i}" data-project="${i}" aria-pressed="${i===p}" aria-label="Projekt ${i}, ${n} Erstwünsche, ${count(state.locked,i)} von ${capacity(i,state.expanded)} festgelegt"><span>Projekt ${i}${state.expanded.includes(i)?' <small>· 2 Gr.</small>':''}</span><span class="bar" aria-hidden="true"><i style="width:${n/Math.max(6,...projects.map(first))*100}%"></i></span><span class="numeric ${n>3?'tag warm':''}">${n}</span><span class="numeric muted">${count(state.locked,i)}/${capacity(i,state.expanded)}</span></button>`;}).join('')}</div></section>
 <section class="panel stack" aria-labelledby="project-title"><div class="row spread wrap"><h2 id="project-title">Projekt ${p}</h2><span class="tag ${isEligible(p)?'warm':''}">${first(p)} Erstwünsche · ${cap} Plätze</span></div>
 ${isEligible(p)?`<label class="extra"><input type="checkbox" id="expand" ${state.expanded.includes(p)?'checked':''} ${current.length>3?'disabled':''}> Zweite Gruppe freigeben (bis zu 6 Plätze)</label><p class="hint">Ab 4 Zuteilungen entstehen zwei Gruppen mit je 2–3 Personen. Mindestens 2 Personen bleiben für jedes andere Projekt vorgesehen.</p>`:''}
 <div class="rule"><h3>Festgelegt (${current.length})</h3>${current.length?fixedMembers.map((members,i)=>`<div>${fixedMembers.length>1?`<p class="hint">Gruppe ${i?'B':'A'}</p>`:''}<ul class="members">${members.map(b=>`<li><span>Kennung ${b.id} ${rankTag(priority(b,p))}</span><button class="link" data-unlock="${b.id}" aria-label="Kennung ${b.id} freigeben">Freigeben</button></li>`).join('')}</ul></div>`).join(''):'<p class="hint">Noch niemand festgelegt.</p>'}</div>
 <div class="rule"><h3>Vorschlag (${recommendations.length})</h3>${recommendations.length?`<ul class="members">${recommendations.map(b=>`<li><span>Kennung ${b.id} ${rankTag(priority(b,p))}</span><button data-lock="${b.id}">Festlegen</button></li>`).join('')}</ul>`:`<p class="hint">${!complete()?'Der Vorschlag ist verfügbar, sobald alle 27 Wunschzettel da sind.':suggested?'Für dieses Projekt sind keine weiteren Vorschläge offen.':'Berechnen Sie einen Vorschlag oder wählen Sie manuell aus.'}</p>`}</div>
 <div class="rule stack"><h3>Manuell festlegen</h3><div class="row picker wrap"><select id="candidate" aria-label="Noch nicht festgelegte Kennung" ${!canAdd?'disabled':''}><option value="">Kennung auswählen …</option>${pool.map(b=>`<option value="${b.id}">Kennung ${b.id} · ${priority(b,p)}. Wunsch</option>`).join('')}</select><button id="manual" disabled>Festlegen</button></div><p class="hint">${full?'Dieses Projekt ist voll.':!pool.length?'Keine freien Kennungen mit Wunschzettel.':!canAdd?'Ein weiterer Platz würde die Mindestgröße anderer Projekte blockieren.':'Nur noch nicht festgelegte Personen erscheinen in dieser Liste.'}</p></div>
 <details class="rule manage"><summary>Alle Wunschplätze für Projekt ${p}</summary>${histogramLine(demand)}</details></section>
 <section class="panel full stack"><div class="row spread wrap"><h2>Wunschverteilung</h2><div class="toolbar"><button id="export" ${fixed===27?'':'disabled'}>Endgültige Zuteilung als CSV</button></div></div>${renderHistogram(visibleAssignment,comparison)}<p class="hint">Der Export wird verfügbar, sobald alle 27 Personen festgelegt sind.</p></section>
 <details class="panel full manage"><summary>Vergaberegeln und Rundeneinstellungen</summary><p class="hint">Der Vorschlag minimiert zuerst die Anzahl der 9. Wünsche, dann die der 8. Wünsche und so weiter. Festgelegte Plätze bleiben bestehen. Bei gleich guten Lösungen entscheidet eine reproduzierbare Auslosung unabhängig von der Importreihenfolge. Pro Projekt sind mindestens 2 und üblicherweise höchstens 3 Personen vorgesehen.</p><div class="toolbar"><label>Losnummer <input id="seed" type="number" min="1" max="4294967295" value="${state.seed}"></label><button id="save-seed">Losnummer speichern</button><button id="demo">Beispielrunde laden</button><button id="reset">Leere Runde beginnen</button></div></details></div>`;
 byId('import').onclick=()=>byId('files').click();byId('files').onchange=e=>importFiles(e.target.files);
 byId('calculate').onclick=calculate;
 byId('candidate').onchange=e=>byId('manual').disabled=!e.target.value;
 byId('manual').onclick=()=>lockStudent(byId('candidate').value);
 byId('export').onclick=()=>download('projektzuteilung.csv','\ufeff'+csvReport(state.ballots,state.locked,'Festgelegt'),'text/csv;charset=utf-8');
 byId('reset').onclick=()=>reset(false);byId('demo').onclick=()=>reset(true);
 if(byId('start-real'))byId('start-real').onclick=()=>reset(false);
 if(byId('expand'))byId('expand').onchange=e=>{
  state.expanded=e.target.checked?[...state.expanded,p]:state.expanded.filter(i=>i!==p);
  refreshProposal();save();render();byId('expand')?.focus();
 };
 byId('save-seed').onclick=()=>{
  const value=byId('seed').valueAsNumber;
  if(!Number.isInteger(value)||value<1||value>4294967295){inform('Die Losnummer muss eine ganze Zahl von 1 bis 4.294.967.295 sein.',true);return;}
  state.seed=value;refreshProposal();save();render();byId('save-seed').closest('details').open=true;byId('save-seed').focus();inform('Losnummer gespeichert.');
 };
 app.querySelectorAll('[data-project]').forEach(btn=>btn.onclick=()=>changeProject(Number(btn.dataset.project)));
 app.querySelectorAll('[data-lock]').forEach(btn=>btn.onclick=()=>lockStudent(btn.dataset.lock));
 app.querySelectorAll('[data-unlock]').forEach(btn=>btn.onclick=()=>{
  delete state.locked[btn.dataset.unlock];refreshProposal();save();render();byId('project-title').setAttribute('tabindex','-1');byId('project-title').focus();inform(`Kennung ${btn.dataset.unlock} ist wieder in den Auswahllisten.`);
 });
}
function histogramLine(counts){return `<div class="comparison" aria-label="Anzahlen nach Wunschplatz">${projects.map((p,i)=>`<span><small>Nr. ${p}</small><strong>${counts[i]}</strong></span>`).join('')}</div>`;}
function renderHistogram(map,baseline){
 if(!Object.keys(map).length)return '<p class="hint">Noch keine Zuteilungen zum Auswerten.</p>';
 const hist=Array(9).fill(0);
 for(const b of state.ballots)if(map[b.id])hist[priority(b,map[b.id])-1]++;
 return `<div><p class="hint">${Object.keys(preview()).length&&Object.keys(state.locked).length<27?'Aktueller Vorschlag inklusive festgelegter Plätze':'Festgelegte Plätze'}</p>${histogramLine(hist)}</div>${baseline?`<div><p class="hint">Vergleich: ohne zweite Gruppen, mit denselben Festlegungen</p>${histogramLine(baseline)}</div>`:''}`;
}
function compute(){
 const result=solve(state);
 state.proposal=result.assignment;
 comparison=null;
 if(state.expanded.length&&locksFeasible(state.locked,[])){
  const baseline=solve({...state,expanded:[]});
  comparison=projects.map(rank=>state.ballots.filter(b=>priority(b,baseline.assignment[b.id])===rank).length);
 }
}
function refreshProposal(){comparison=null;if(state.proposal){try{compute();}catch(e){delete state.proposal;inform(e.message,true);}}}
function calculate(){
 try{compute();save();render();byId('calculate').focus();inform('Vorschlag berechnet. Festgelegte Plätze bleiben unverändert.');}catch(e){inform(e.message,true);}
}
function lockStudent(id){
 const p=selected;
 if(!ids.includes(id)||Object.hasOwn(state.locked,id)||!state.ballots.some(b=>b.id===id))return;
 const next={...state.locked,[id]:p};
 if(!locksFeasible(next,state.expanded)){inform('Diese Zuteilung würde eine Kapazitäts- oder Mindestgrenze verletzen.',true);return;}
 state.locked=next;refreshProposal();save();render();byId('project-title').setAttribute('tabindex','-1');byId('project-title').focus();
 inform(Object.keys(state.locked).length===27?'Alle 27 Personen sind festgelegt. Die CSV-Datei kann exportiert werden.':`Kennung ${id} wurde für Projekt ${p} festgelegt.`);
}
function reset(demo){
 if((state.ballots.length||Object.keys(state.locked).length)&&!window.confirm('Die aktuelle Runde wird durch eine neue ersetzt. Fortfahren?'))return;
 state=fresh(demo);comparison=null;selected=1;save();render();inform(demo?'Beispielrunde geladen.':'Leere Runde begonnen.');
}
async function importFiles(files){
 if(state.demo){inform('Beginnen Sie vor dem Import echter Wunschzettel eine leere Runde.',true);byId('files').value='';return;}
 if(!files.length)return;
 const target=state;
 try{
  const incoming=await Promise.all(Array.from(files,async file=>{
   if(file.size>10000)throw Error('Die Datei ist zu groß für einen Wunschzettel.');
   const b=JSON.parse(await file.text());
   if(b.typ!=='projekt-wunsch-v1'||!validateBallot(b))throw Error('Mindestens ein Wunschzettel ist ungültig. Es wurde nichts importiert.');
   return {id:b.id,ranks:b.ranks};
  }));
  if(target!==state||state.demo)throw Error('Die Runde wurde inzwischen geändert. Bitte erneut importieren.');
  const unique=new Set(incoming.map(b=>b.id));
  if(unique.size!==incoming.length)throw Error('Eine Kennung kommt in mehreren ausgewählten Dateien vor. Es wurde nichts importiert.');
  if(incoming.some(b=>Object.hasOwn(state.locked,b.id)))throw Error('Mindestens eine Kennung ist bereits festgelegt. Geben Sie sie vor einer Korrektur frei.');
  const current=new Map(state.ballots.map(b=>[b.id,b]));
  if(incoming.some(b=>current.has(b.id))&&!window.confirm('Vorhandene Wunschzettel derselben Kennung ersetzen?'))return;
  incoming.forEach(b=>current.set(b.id,b));
  const next=[...current.values()].sort((a,b)=>a.id.localeCompare(b.id));
  const expanded=state.expanded.filter(p=>next.filter(b=>b.ranks[0]===p).length>=6);
  if(!locksFeasible(state.locked,expanded))throw Error('Die Korrektur würde eine bereits belegte zweite Gruppe unzulässig machen. Es wurde nichts importiert.');
  state.ballots=next;state.expanded=expanded;refreshProposal();save();render();inform(`${incoming.length} Wunschzettel importiert.`);
 }catch(e){inform(e instanceof SyntaxError?'Mindestens eine Datei enthält kein gültiges JSON. Es wurde nichts importiert.':e.message,true);}
 finally{if(byId('files'))byId('files').value='';}
}
function renderStudent(){
 app.innerHTML=`<div class="intro"><div class="eyebrow">Studierende · Wunschzettel</div><h1>Projekte in Reihenfolge bringen</h1><p class="muted">Rang 1 ist Ihr Lieblingsprojekt, Rang 9 Ihr letzter Wunsch.</p></div><section class="panel student stack"><label for="student-id">Ihre vergebene Kennung</label><select id="student-id"><option value="">Bitte auswählen …</option>${ids.map(id=>`<option ${id===studentId?'selected':''} value="${id}">${id}</option>`).join('')}</select><p class="hint">Nutzen Sie die Pfeile, um Projekte zu verschieben. Senden Sie die heruntergeladene JSON-Datei über den vereinbarten Abgabeweg an den Professor.</p><ol aria-label="Ihre Rangfolge">${draft.map((p,i)=>`<li><div class="row"><span class="rank-num">${i+1}.</span><span class="rank-name">Projekt ${p}</span></div><div class="row move"><button id="up-${p}" data-move="${i},-1" aria-label="Projekt ${p} nach oben" ${i===0?'disabled':''}>↑</button><button id="down-${p}" data-move="${i},1" aria-label="Projekt ${p} nach unten" ${i===8?'disabled':''}>↓</button></div></li>`).join('')}</ol><button class="primary" id="ballot-export" ${studentId?'':'disabled'}>Wunschzettel herunterladen</button></section>`;
 byId('student-id').onchange=e=>{studentId=e.target.value;byId('ballot-export').disabled=!studentId;};
 app.querySelectorAll('[data-move]').forEach(btn=>btn.onclick=()=>{
  const [i,delta]=btn.dataset.move.split(',').map(Number),j=i+delta,p=draft[i];
  [draft[i],draft[j]]=[draft[j],draft[i]];render();
  const same=byId(`${delta<0?'up':'down'}-${p}`);(same.disabled?byId(`${delta<0?'down':'up'}-${p}`):same).focus();
 });
 byId('ballot-export').onclick=()=>{
  const b={typ:'projekt-wunsch-v1',id:studentId,ranks:draft};
  if(validateBallot(b)){download(`wunschzettel-${studentId}.json`,JSON.stringify(b,null,2),'application/json');inform('Wunschzettel heruntergeladen. Bitte an den Professor senden.');}
 };
}
function download(filename,content,type){
 const url=URL.createObjectURL(new Blob([content],{type})), a=document.createElement('a');
 a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
byId('prof-tab').onclick=()=>setView('prof');byId('student-tab').onclick=()=>setView('student');
refreshProposal();render();
})();
