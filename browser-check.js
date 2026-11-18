const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {mkdtempSync,readFileSync,rmSync,writeFileSync}=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {demoBallots}=require('./app');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function wait(fn){for(let i=0;i<150;i++){const val=await fn();if(val)return val;await delay(50);}throw Error('Browserprüfung: Zeitlimit');}
async function run(){
 const directory=mkdtempSync(path.join(os.tmpdir(),'proj-test-'));
 const exe=process.argv[2]||'C:/Program Files/Google/Chrome/Application/chrome.exe';
 const chrome=spawn(exe,['--headless=new','--no-first-run','--disable-extensions','--remote-debugging-port=0',`--user-data-dir=${directory}`,'about:blank'],{stdio:'ignore'});
 let ws;
 try{
  const port=await wait(()=>{try{return readFileSync(path.join(directory,'DevToolsActivePort'),'utf8').split(/\r?\n/)[0];}catch{return null;}});
  const tabs=await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  ws=new WebSocket(tabs.find(x=>x.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
  const errors=[], pending=new Map();let serial=0;
  ws.onmessage=({data})=>{const m=JSON.parse(data);if(m.id){const [resolve,reject]=pending.get(m.id);pending.delete(m.id);m.error?reject(Error(m.error.message)):resolve(m.result);}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text);};
  const send=(method,params={})=>new Promise((res,rej)=>{const id=++serial;pending.set(id,[res,rej]);ws.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.result.description);return r.result.value;};
  await send('Runtime.enable');await send('Page.enable');
  await send('Page.navigate',{url:pathToFileURL(path.resolve('Projektvergabe.html')).href});
  await wait(()=>evaluate(`!!document.querySelector('#calculate')`));
  assert.equal(await evaluate(`document.querySelector('.metric strong').textContent`),'27 / 27');
  assert.equal(await evaluate(`document.querySelectorAll('.project').length`),9);
  await evaluate(`document.querySelector('#calculate').click();document.querySelector('#expand').click()`);
  assert.equal(await evaluate(`document.querySelectorAll('section.full .comparison').length`),2);
  assert.match(await evaluate(`document.querySelector('#project-1').getAttribute('aria-label')`),/von 6/);
  assert.ok(await evaluate(`document.querySelectorAll('[data-lock]').length>3`));
  if(process.env.PROJEKT_SCREENSHOT){const shot=await send('Page.captureScreenshot',{format:'png'});writeFileSync(process.env.PROJEKT_SCREENSHOT,Buffer.from(shot.data,'base64'));}
  const id=await evaluate(`document.querySelector('[data-lock]').dataset.lock`);
  await evaluate(`document.querySelector('[data-lock]').click();document.querySelector('#project-2').click();`);
  assert.equal(await evaluate(`!!document.querySelector('#candidate option[value="${id}"]')`),false);
  await evaluate(`document.querySelector('#project-1').click();document.querySelector('[data-unlock]').click();document.querySelector('#project-2').click();`);
  assert.equal(await evaluate(`!!document.querySelector('#candidate option[value="${id}"]')`),true);
  await evaluate(`const manualId=document.querySelector('#candidate').options[1].value;document.querySelector('#candidate').value=manualId;document.querySelector('#candidate').dispatchEvent(new Event('change'));document.querySelector('#manual').click();`);
  assert.equal(await evaluate(`!!document.querySelector('[data-unlock="'+manualId+'"]')`),true);
  await evaluate(`document.querySelector('#project-3').click();`);
  assert.equal(await evaluate(`!!document.querySelector('#candidate option[value="'+manualId+'"]')`),false);
  await evaluate(`window.confirm=()=>true;document.querySelector('#start-real').click();document.querySelector('#student-tab').click();`);
  assert.equal(await evaluate(`document.querySelector('#ballot-export').disabled`),true);
  await evaluate(`document.querySelector('#student-id').value='01';document.querySelector('#student-id').dispatchEvent(new Event('change'));document.querySelector('#up-2').click();window.downloads=[];const nativeUrl=URL.createObjectURL;URL.createObjectURL=(blob)=>{downloads.push(blob);return nativeUrl.call(URL,blob)};document.querySelector('#ballot-export').click();`);
  const ballot=JSON.parse(await evaluate('downloads[0].text()'));
  assert.deepEqual(ballot,{typ:'projekt-wunsch-v1',id:'01',ranks:[2,1,3,4,5,6,7,8,9]});
  await evaluate(`document.querySelector('#prof-tab').click();window.loadFiles=(ballots)=>{const files=new DataTransfer();ballots.forEach((b,i)=>files.items.add(new File([JSON.stringify(b)],i+'.json',{type:'application/json'})));const input=document.querySelector('#files');input.files=files.files;input.dispatchEvent(new Event('change'));};loadFiles([{foo:true}]);`);
  await wait(()=>evaluate(`document.querySelector('#notice').textContent.includes('ungültig')`));
  const ballots=demoBallots().map(b=>({...b,typ:'projekt-wunsch-v1'}));ballots[0]=ballot;
  await evaluate(`loadFiles(${JSON.stringify(ballots)})`);
  await wait(()=>evaluate(`!document.querySelector('#calculate').disabled`));
  await evaluate(`document.querySelector('#calculate').click();`);
  assert.equal(await evaluate(`document.querySelectorAll('[data-lock]').length`),3);
  await evaluate(`for(let p=1;p<=9;p++){document.querySelector('#project-'+p).click();for(let i=0;i<3;i++)document.querySelector('[data-lock]').click();}document.querySelector('#export').click();`);
  const csv=await evaluate('downloads[1].text()');
  assert.equal(csv.trim().split(/\r?\n/).length,28);
  assert.equal(new Set(csv.trim().split(/\r?\n/).slice(1).map(s=>s.split(';')[0])).size,27);
  await send('Page.reload');await wait(()=>evaluate(`!!document.querySelector('#export')`));
  assert.equal(await evaluate(`document.querySelector('#export').disabled`),false);
  await send('Emulation.setDeviceMetricsOverride',{width:375,height:800,deviceScaleFactor:1,mobile:true});
  assert.equal(await evaluate(`document.documentElement.scrollWidth<=innerWidth`),true);
  assert.deepEqual(errors,[]);
  console.log('Chrome: Beispielrunde, zweite Gruppe, Festlegen/Freigeben, Wunschzettel-Export, ungültiger & gültiger Import, 27 endgültige Plätze, CSV, Reload und mobile Breite geprüft.');
 }finally{ws?.close();chrome.kill();await delay(400);try{rmSync(directory,{force:true,recursive:true});}catch{}}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
