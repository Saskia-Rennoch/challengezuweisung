'use strict';
const PDFDocument=require('pdfkit');
const {existsSync}=require('node:fs');
const {join}=require('node:path');
const {projectRows}=require('./demo');
function assignmentPdf(state){
 const doc=new PDFDocument({size:'A4',margin:46,info:{Title:'Endgültige Zusortierung'}});
 const fonts=[process.env.WINDIR&&join(process.env.WINDIR,'Fonts','segoeui.ttf'),'/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf','/System/Library/Fonts/Supplemental/Arial.ttf'];
 const font=fonts.find(p=>p&&existsSync(p));
 if(font)doc.font(font);
 return new Promise((resolve,reject)=>{
  const chunks=[];doc.on('data',b=>chunks.push(b));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);
  const rows=projectRows(state).filter(row=>row.locked.length);
  doc.fillColor('#215646').fontSize(23).text('Endgültige Zusortierung');
  doc.moveDown(.4).fillColor('#43534b').fontSize(11).text(`${rows.reduce((sum,r)=>sum+r.locked.length,0)} von ${state.ballots.length} eingegangenen Abgaben bestätigt`);
  for(const row of rows){
   if(doc.y>doc.page.height-140)doc.addPage();
   doc.moveDown(.85).fillColor('#215646').fontSize(14).text(`${row.p}. ${row.title}`);
   for(const group of ['A','B']){
    const people=row.locked.filter(x=>x.group===group);if(!people.length)continue;
    if(doc.y>doc.page.height-112)doc.addPage();
    doc.moveDown(.3).fillColor('#43534b').fontSize(11).text(`Gruppe ${group}`);
    for(const p of people)doc.fillColor('#232f2a').fontSize(11).text(`${p.label}${p.team?` · ${p.team}`:''} · Priorität ${p.rank}`,{indent:12});
   }
  }
  doc.end();
 });
}
module.exports={assignmentPdf};
