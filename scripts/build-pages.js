'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),out=path.join(root,'_site');
// Only the generated Pages folder is replaced; never copy the whole repository.
if(fs.existsSync(out)&&fs.lstatSync(out).isSymbolicLink())throw Error('_site must not be a symlink.');
fs.rmSync(out,{recursive:true,force:true});fs.mkdirSync(out);
for(const name of ['index.html','app.js','itinerary.js','travel-time.js','reservation-model.js','reservation-ui.js','styles.css'])fs.copyFileSync(path.join(root,name),path.join(out,name));
fs.cpSync(path.join(root,'assets'),path.join(out,'assets'),{recursive:true});
fs.writeFileSync(path.join(out,'site-config.js'),'globalThis.CathaySiteConfig = { staticDemo: true };\n');
fs.writeFileSync(path.join(out,'.nojekyll'),'');
console.log('Static demo built in _site. No server, database or credentials included.');
