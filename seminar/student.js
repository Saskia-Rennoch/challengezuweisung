(() => {
'use strict';
const {challenges,validateRanks}=window.ChallengeCatalog;
const ranks=challenges.map(c=>c.id), byChallenge=new Map(challenges.map(c=>[c.id,c]));
const escapeHtml=text=>text.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const byId=id=>document.getElementById(id);
const list=byId('preference-list'), form=byId('ballot'), result=byId('result'), send=byId('send');
let drag=null, edit=null, saving=false;
const receipt=Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join('');
function draw(){
 list.innerHTML=ranks.map((p,i)=>{
  const c=byChallenge.get(p), title=escapeHtml(c.title);
  return `<li data-challenge="${p}"><div class="row drag-area"><span class="drag-grip" aria-hidden="true">⠿</span><span class="rank-num">${p}.</span><span class="rank-name">${title} <em class="challenge-size">(max. ${c.max} Personen)</em></span></div><div class="row move"><button type="button" id="up-${p}" data-at="${i}" data-step="-1" aria-label="${title} nach oben" ${i===0?'disabled':''}>↑</button><button type="button" id="down-${p}" data-at="${i}" data-step="1" aria-label="${title} nach unten" ${i===ranks.length-1?'disabled':''}>↓</button></div></li>`;
 }).join('');
}
function move(from,to){
 if(from===to)return;
 const [project]=ranks.splice(from,1);ranks.splice(to,0,project);draw();
 byId('rank-status').textContent=`${byChallenge.get(project).title} steht jetzt auf Priorität ${to+1}.`;
}
function locate(y){
 return Math.max(0,Math.min(ranks.length-1,[...list.children].filter(el=>el.getBoundingClientRect().bottom<=y).length));
}
function markTarget(){
 const {from,y}=drag;
 const to=locate(y);
 for(const [i,el] of [...list.children].entries()){
  el.classList.toggle('drop-before',i===to&&to<from);
  el.classList.toggle('drop-after',i===to&&to>from);
 }
}
function track(){
 if(!drag?.active)return;
 const h=window.innerHeight;
 if(drag.y<45)window.scrollBy(0,-9);else if(drag.y>h-45)window.scrollBy(0,9);
 markTarget();drag.frame=requestAnimationFrame(track);
}
list.addEventListener('pointerdown',e=>{
 const area=e.target.closest(e.pointerType==='touch'?'.drag-grip':'.drag-area');
 if(!area||drag||!e.isPrimary||e.button!==0||send.disabled)return;
 const li=area.closest('li');
 drag={id:e.pointerId,from:[...list.children].indexOf(li),start:e.clientY,y:e.clientY,li};
 list.setPointerCapture(e.pointerId);
});
list.addEventListener('pointermove',e=>{
 if(drag?.id!==e.pointerId)return;
 drag.y=e.clientY;
 if(!drag.active&&Math.abs(drag.y-drag.start)>=5){drag.active=true;drag.li.classList.add('dragging');track();}
 else if(drag.active)markTarget();
});
function finish(e){
 if(drag?.id!==e.pointerId)return;
 const {active,from,frame}=drag;drag=null;cancelAnimationFrame(frame);
 for(const el of list.children)el.classList.remove('dragging','drop-before','drop-after');
 if(active&&e.type==='pointerup'&&!send.disabled)move(from,locate(e.clientY));
}
for(const type of ['pointerup','pointercancel','lostpointercapture'])list.addEventListener(type,finish);
list.addEventListener('click',e=>{
 const b=e.target.closest('button');if(!b||b.disabled||send.disabled)return;
 const i=Number(b.dataset.at),d=Number(b.dataset.step),j=i+d,p=ranks[i];
 move(i,j);
 const next=byId(`${d<0?'up':'down'}-${p}`);(next.disabled?byId(`${d<0?'down':'up'}-${p}`):next).focus();
});
const load=byId('load'), editPanel=byId('edit-panel'), editResult=byId('edit-result'), codeInput=byId('edit-code');
const firstName=byId('first-name'), teamInput=byId('team-name'), initialPassword=byId('ballot-password');
const codeKey='wiesbaden-recent-edit-code';
try{codeInput.value=localStorage.getItem(codeKey)||'';}catch{}
function status(node,text='',error=false){node.textContent=text;node.classList.toggle('warn',error);}
function setBusy(value){saving=value;send.disabled=value;load.disabled=value;}
async function post(path,payload){
 let response;
 try{response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});}
 catch{throw new Error('Keine Verbindung zum Server. Bitte erneut versuchen.');}
 const data=await response.json();
 if(!response.ok)throw new Error(data.error||'Die Anfrage konnte nicht verarbeitet werden.');
 return data;
}
byId('load-ballot').addEventListener('submit',async e=>{
 e.preventDefault();if(saving)return;
 const editCode=codeInput.value.trim(), pwd=byId('edit-password'),password=pwd.value;
 setBusy(true);status(editResult,'Wunschzettel wird geladen …');
 try{
  const data=await post('/api/ballot/load',{editCode,password});
  if(!validateRanks(data.ranks))throw new Error('Die gespeicherte Rangliste passt nicht zu dieser Runde.');
  edit={editCode:data.editCode||editCode,password};pwd.value='';initialPassword.value='';
  firstName.value=data.name;firstName.readOnly=true;teamInput.value=data.team||'';
  ranks.splice(0,ranks.length,...data.ranks);draw();
  byId('password-field').hidden=true;initialPassword.disabled=true;
  byId('edit-marker').hidden=false;form.hidden=false;byId('thanks').hidden=true;
  send.textContent='Änderungen speichern';status(result);status(editResult);editPanel.open=false;
  byId('edit-marker').tabIndex=-1;byId('edit-marker').focus();
 }catch(error){status(editResult,error.message,true);}
 finally{setBusy(false);}
});
form.addEventListener('submit',async e=>{
 e.preventDefault();if(saving)return;
 const name=firstName.value.trim(),team=teamInput.value.trim();
 if(!name){status(result,'Bitte geben Sie Ihren Namen ein.',true);return;}
 setBusy(true);status(result,'Wunschzettel wird gespeichert …');
 try{
  const data=await post(edit?'/api/ballot/update':'/api/ballot',edit?{...edit,ranks,team}:{name,ranks,team,password:initialPassword.value,receipt});
  const editCode=data.editCode||edit?.editCode;
  codeInput.value=editCode;try{localStorage.setItem(codeKey,editCode);}catch{}
  edit=null;initialPassword.value='';byId('edit-password').value='';status(result);
  form.hidden=true;editPanel.open=false;byId('thanks').hidden=false;
  byId('confirmation').textContent=`Danke, ${name}. Ihr Wunschzettel wurde gespeichert.`;
  byId('saved-code').textContent=editCode;byId('thanks').tabIndex=-1;byId('thanks').focus();
 }catch(error){status(result,error.message,true);}
 finally{setBusy(false);}
});
byId('edit-again').onclick=()=>{editPanel.open=true;byId('edit-password').focus();};
draw();
})();
