(() => {
'use strict';
const ranks=[1,2,3,4,5,6,7,8,9];
const byId=id=>document.getElementById(id);
const list=byId('preference-list'), form=byId('ballot'), result=byId('result'), send=byId('send');
let drag=null;
const receipt=Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join('');
function draw(){
 list.innerHTML=ranks.map((p,i)=>`<li><div class="row drag-area"><span class="drag-grip" aria-hidden="true">⠿</span><span class="rank-num">${i+1}.</span><span class="rank-name">Projekt ${p}</span></div><div class="row move"><button type="button" id="up-${p}" data-at="${i}" data-step="-1" aria-label="Projekt ${p} nach oben" ${i===0?'disabled':''}>↑</button><button type="button" id="down-${p}" data-at="${i}" data-step="1" aria-label="Projekt ${p} nach unten" ${i===8?'disabled':''}>↓</button></div></li>`).join('');
}
function move(from,to){
 if(from===to)return;
 const [project]=ranks.splice(from,1);ranks.splice(to,0,project);draw();
 byId('rank-status').textContent=`Projekt ${project} steht jetzt auf Priorität ${to+1}.`;
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
form.addEventListener('submit',async e=>{
 e.preventDefault();if(send.disabled)return;
 const name=byId('first-name').value.trim();
 if(!name){result.textContent='Bitte geben Sie Ihren Namen ein.';return;}
 send.disabled=true;result.textContent='Wunschzettel wird übermittelt …';result.classList.remove('warn');
 try{
  const response=await fetch('/api/ballot',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,ranks,receipt})});
  const data=await response.json();if(!response.ok)throw new Error(data.error||'Die Abgabe konnte nicht gespeichert werden.');
  form.hidden=true;byId('thanks').hidden=false;byId('confirmation').textContent=`Danke, ${name}. Ihr Wunschzettel wurde gespeichert.`;byId('thanks').tabIndex=-1;byId('thanks').focus();
 }catch(error){result.textContent=error.message==='Failed to fetch'?'Keine Verbindung zur Projektvergabe. Bitte erneut versuchen.':error.message;result.classList.add('warn');}
 finally{send.disabled=false;}
});
draw();
})();
