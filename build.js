const {readFileSync,writeFileSync}=require('node:fs');
const {join}=require('node:path');
const read=name=>readFileSync(join(__dirname,name),'utf8');
let html=read('index.template.html');
for(const [slot,file] of [['CSS','style.css'],['SOLVER','solver.js'],['APP','app.js']]){
 const source=read(file);
 if(/<\/(?:script|style)\b/i.test(source))throw Error(`Ungültiger End-Tag in ${file}`);
 html=html.replace(`/* BUILD:${slot} */`,()=>source);
}
writeFileSync(join(__dirname,'Projektvergabe.html'),html);
