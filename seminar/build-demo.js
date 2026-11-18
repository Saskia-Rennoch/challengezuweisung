const {readFileSync,writeFileSync}=require('node:fs');
const {join}=require('node:path');
const read=file=>readFileSync(join(__dirname,file),'utf8');
let html=read('prof.html');
for(const file of ['../style.css','seminar.css']){
 const body=read(file);if(/<\/style\b/i.test(body))throw Error(`Ungültiger Style-Block: ${file}`);
 html=html.replace(`<link rel="stylesheet" href="/assets/${file.replace('../','')}">`,()=>`<style>${body}</style>`);
}
for(const file of ['../solver.js','demo.js','prof.js']){
 const body=read(file);if(/<\/script\b/i.test(body))throw Error(`Ungültiger Skriptblock: ${file}`);
 html=html.replace(`<script defer src="/assets/${file.replace('../','')}"></script>`,'');
 html=html.replace('</body>',()=>`<script>${body}</script></body>`);
}
writeFileSync(join(__dirname,'../Testphase.html'),html);
