const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=f=>fs.readFileSync(path.join(__dirname,f),'utf8');
test('student page loads the common catalog and provides accessible edit and team fields',()=>{
 const html=read('student.html');
 assert.match(html,/src="\/assets\/challenges\.js"/);
 for(const id of ['team-name','ballot-password','edit-code','edit-password']){
  assert.match(html,new RegExp(`for="${id}"`));assert.match(html,new RegExp(`id="${id}"`));
 }
 assert.match(html,/id="ballot-password"[^>]*type="password"/);
 assert.match(html,/id="edit-password"[^>]*type="password"/);
 assert.match(html,/id="team-name"[^>]*placeholder="dieHackies"/);
 assert.doesNotMatch(html,/id="team-name"[^>]*\svalue=/);
 assert.match(html,/id="ballot-password"[^>]*minlength="4"/);
});
