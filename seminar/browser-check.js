const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {mkdtempSync,readFileSync,rmSync}=require('node:fs');
const {join,resolve}=require('node:path');
const {pathToFileURL}=require('node:url');

const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function wait(fn){for(let i=0;i<100;i++){const result=await fn();if(result)return result;await delay(70);}throw Error('Zeitlimit bei der Browserprüfung');}
async function check(){
 const temp=process.env.TMPDIR||join(process.env.LOCALAPPDATA,'hermes','cache','scratch');
 require('node:fs').mkdirSync(temp,{recursive:true});
 const dir=mkdtempSync(join(temp,'seminar-browser-'));
 const chrome=spawn(process.env.CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-first-run','--remote-debugging-port=0',`--user-data-dir=${dir}`,'about:blank'],{stdio:'ignore'});
 let ws;
 try{
  const port=await wait(()=>{try{return readFileSync(join(dir,'DevToolsActivePort'),'utf8').split(/\r?\n/)[0];}catch{return null;}});
  const tabs=await (await fetch(`http://localhost:${port}/json/list`)).json();
  ws=new WebSocket(tabs.find(x=>x.type==='page').webSocketDebuggerUrl);
  await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
  let next=0;const pending=new Map(),errors=[];
  ws.onmessage=({data})=>{const m=JSON.parse(data);if(m.id){const [r,j]=pending.get(m.id);pending.delete(m.id);m.error?j(Error(m.error.message)):r(m.result);}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);};
  const send=(method,params={})=>new Promise((r,j)=>{const id=++next;pending.set(id,[r,j]);ws.send(JSON.stringify({id,method,params}));});
  const ev=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.result.description);return r.result.value;};
  const open=async(url,selector)=>{await send('Page.navigate',{url});await wait(()=>ev(`document.readyState==='complete'&&!!document.querySelector(${JSON.stringify(selector)})`));};
  await send('Runtime.enable');
  await open(pathToFileURL(resolve('Testphase.html')).href,'#projekt-10');
  assert.equal(await ev(`document.querySelectorAll('.allocation').length`),10);
  assert.equal(await ev(`document.querySelectorAll('[data-expand]').length`),10);
  assert.match(await ev(`document.querySelector('#projekt-10 summary').textContent`),/Finanzen aufgedeckt/);
  assert.match(await ev(`document.querySelector('#projekt-1 dl').textContent`),/Lea/);
  await ev(`document.querySelector('#propose').click()`);
  assert.equal(await ev(`document.querySelectorAll('[data-set]').length`),27);
  const id=await ev(`(()=>{const b=document.querySelector('[data-set]');b.closest('details').open=true;const id=b.dataset.set;b.click();return id})()`);
  assert.equal(await ev(`!!document.querySelector('option[value="${id}"]')`),false);
  assert.match(await ev(`document.querySelector('[data-unset="${id}"]').textContent`),/Undo/);
  await ev(`document.querySelector('[data-unset="${id}"]').click()`);
  assert.equal(await ev(`!!document.querySelector('option[value="${id}"]')`),true);
  await ev(`document.querySelector('#projekt-9').open=true;document.querySelector('#projekt-9 [data-expand]').click()`);
  assert.equal(await ev(`!!document.querySelector('#projekt-9 [data-group="B"]')`),true);
  const groupB=await ev(`(()=>{const form=document.querySelector('#projekt-9 [data-group="B"] form');const s=form.elements.person;s.selectedIndex=1;s.dispatchEvent(new Event('change',{bubbles:true}));const id=s.value;form.requestSubmit();return id;})()`);
  assert.equal(await ev(`!!document.querySelector('#projekt-9 [data-group="B"] [data-unset="${groupB}"]')`),true);
  assert.ok(await ev(`['A','B'].every(g=>document.querySelector('#projekt-9 [data-group="'+g+'"]').querySelectorAll('[data-set],[data-unset]').length<=4)`));
  await send('Emulation.setDeviceMetricsOverride',{width:375,height:800,deviceScaleFactor:1,mobile:true});
  assert.equal(await ev('document.documentElement.scrollWidth<=innerWidth'),true);
  console.log('Chrome: zehn benannte Challenges, 27 Vorschläge, Confirm/Undo und zweite Gruppe.');
  if(process.argv.includes('--live')){
   const {createServer}=require('../server');
   const app=createServer({port:0,roundFile:join(dir,'test-round.json'),adminPassword:'test-only-login-2467'});
   await new Promise((resolve,reject)=>{app.server.once('error',reject);app.server.listen(0,'127.0.0.1',resolve);});
   const prof=new URL(`http://127.0.0.1:${app.server.address().port}/prof`);
   try{
   await open(prof.href,'#signin');await wait(()=>ev(`!document.querySelector('#signin').hidden`));
   assert.equal(await ev(`document.querySelector('#work').hidden`),true);
   await ev(`document.querySelector('#password').value='incorrect';document.querySelector('#login-submit').click()`);
   await wait(()=>ev(`document.querySelector('#status').textContent.includes('falsch')`));
   await ev(`document.querySelector('#password').value='test-only-login-2467';document.querySelector('#login-submit').click()`);
   await wait(()=>ev(`document.querySelector('#qr').naturalWidth>0`));
   const state=await ev(`fetch('/api/prof').then(r=>r.json())`);assert.equal(state.ballots.length,0);
   await ev(`document.querySelector('#projekt-5').open=true;document.querySelector('#projekt-5 [data-expand]').click()`);
   await wait(()=>ev(`!!document.querySelector('#projekt-5 [data-group="B"]')`));
   assert.deepEqual(await ev(`fetch('/api/prof').then(r=>r.json()).then(x=>x.expanded)`),[5]);
   const studentLink=await ev(`document.querySelector('#submit-link').href`);assert.equal(studentLink,state.submitUrl);
   const studentUrl=new URL(new URL(studentLink).pathname,prof).href;
   await open(studentUrl,'#preference-list li:last-child');
   assert.equal(await ev(`document.querySelector('#entry-code')===null`),true);
   for(const width of [320,360,390,430]){
    await send('Emulation.setDeviceMetricsOverride',{width,height:860,deviceScaleFactor:1,mobile:true});
    assert.equal(await ev('document.documentElement.scrollWidth<=innerWidth'),true,`mobile width ${width}`);
   }
   assert.equal(await ev(`document.querySelectorAll('#preference-list li em').length`),10);
   const point=(selector)=>ev(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
   const start=await point('#preference-list li:nth-child(2) .drag-grip'),end=await point('#preference-list li:nth-child(1) .drag-grip');
   await send('Input.dispatchMouseEvent',{type:'mousePressed',...start,button:'left',buttons:1,clickCount:1});
   await send('Input.dispatchMouseEvent',{type:'mouseMoved',...end,button:'left',buttons:1});
   await send('Input.dispatchMouseEvent',{type:'mouseReleased',...end,button:'left',buttons:0,clickCount:1});
   assert.equal(await ev(`document.querySelector('#preference-list li:first-child').dataset.challenge`),'2');
   assert.equal(await ev(`document.querySelector('#preference-list li:first-child .rank-num').textContent`),'2.');
   await send('Input.dispatchMouseEvent',{type:'mousePressed',...end,button:'left',buttons:1,clickCount:1});
   await send('Input.dispatchMouseEvent',{type:'mouseMoved',...start,button:'left',buttons:1});
   await send('Input.dispatchMouseEvent',{type:'mouseReleased',...start,button:'left',buttons:0,clickCount:1});
   assert.equal(await ev(`document.querySelector('#preference-list li:first-child').dataset.challenge`),'1');
   await ev(`document.querySelector('#up-2').click()`);
   const third=await point('#preference-list li:nth-child(3) .drag-grip'),second=await point('#preference-list li:nth-child(2) .drag-grip');
   await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[third]});
   await send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[second]});
   await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
   assert.equal(await ev(`document.querySelector('#preference-list li:nth-child(2)').dataset.challenge`),'3');
   assert.equal(await ev(`document.querySelector('#team-name').placeholder`),'dieHackies');
   assert.equal(await ev(`document.querySelector('#team-name').value`),'');
   await ev(`document.querySelector('#first-name').value='Lea Weber';document.querySelector('#ballot-password').value='w9Ez';document.querySelector('#send').click()`);
   await wait(()=>ev(`!document.querySelector('#thanks').hidden`));
   const code=await ev(`document.querySelector('#saved-code').textContent`);assert.match(code,/^\d{4}$/);
   const saved=await ev(`fetch('/api/prof').then(r=>r.json())`);assert.equal(saved.ballots[0].name,'Lea Weber');assert.equal(saved.ballots[0].team,'');assert.deepEqual(saved.ballots[0].ranks,[2,3,1,4,5,6,7,8,9,10]);
   await ev(`document.querySelector('#edit-again').click();document.querySelector('#edit-password').value='w9Ez';document.querySelector('#load').click()`);
   await wait(()=>ev(`!document.querySelector('#edit-marker').hidden`));
   assert.equal(await ev(`document.querySelector('#team-name').value`),'');
   await ev(`document.querySelector('#team-name').value='dieHackies';document.querySelector('#up-3').click();document.querySelector('#send').click()`);
   await wait(()=>ev(`!document.querySelector('#thanks').hidden`));
   const updated=await ev(`fetch('/api/prof').then(r=>r.json())`);assert.equal(updated.ballots.length,1);assert.equal(updated.ballots[0].team,'dieHackies');assert.deepEqual(updated.ballots[0].ranks,[3,2,1,4,5,6,7,8,9,10]);
   await open(prof.href,'#projekt-10');assert.match(await ev(`document.querySelector('#projekt-2 dd:nth-of-type(1)').parentElement.parentElement.textContent`),/Lea Weber/);
  assert.equal(await ev(`document.querySelector('#final-show').disabled`),true);
  await ev(`document.querySelector('#propose').click()`);
  await wait(()=>ev(`!document.querySelector('#confirm-all').disabled`));
  await ev(`document.querySelector('#confirm-all').click()`);
  await wait(()=>ev(`!document.querySelector('#final-show').disabled`));
  await ev(`document.querySelector('#final-show').click()`);
  assert.equal(await ev(`document.querySelector('#final-dialog').open`),true);
  assert.match(await ev(`document.querySelector('#final-count').textContent`),/1 von 1/);
  assert.match(await ev(`document.querySelector('#final-list').textContent`),/Lea Weber/);
  const downloads=join(dir,'downloads');
  await send('Page.setDownloadBehavior',{behavior:'allow',downloadPath:downloads});
  await ev(`document.querySelector('#export').click();document.querySelector('#export-pdf').click()`);
  const csv=await wait(()=>{try{return readFileSync(join(downloads,'projektvergabe.csv'),'utf8');}catch{return null;}});
  assert.match(csv,/Challenge;Gruppe;Name;Teamname;Priorität/);
  assert.match(csv,/Lea Weber/);
  await wait(()=>{try{return readFileSync(join(downloads,'zusortierung.pdf')).subarray(0,5).toString()==='%PDF-';}catch{return false;}});
  await ev(`document.querySelector('#final-close').click()`);
   await ev(`document.querySelector('#logout').click()`);await wait(()=>ev(`!document.querySelector('#signin').hidden`));
   assert.equal(await ev(`fetch('/api/prof').then(r=>r.status)`),401);
   console.log('Chrome: QR, Maus/Touch, 320–430 px, Wunschbearbeitung, Sammelbestätigung und beide Downloads.');
   }finally{app.server.closeAllConnections();await new Promise(resolve=>app.server.close(resolve));}
  }
  assert.deepEqual(errors,[]);
 }finally{ws?.close();chrome.kill();await delay(300);try{rmSync(dir,{force:true,recursive:true});}catch{}}
}
check().catch(e=>{console.error(e);process.exitCode=1;});
