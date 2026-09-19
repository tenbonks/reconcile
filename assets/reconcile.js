(function(){
"use strict";

const S={main:null, lookups:[], rules:[], output:null, view:'preview'};
let uid=1; const nid=()=>'id'+(uid++);
const STORE_KEY='reconcile.setups.v1';

const OPS=[
  {v:'trim',label:'Match · trim + ignore case'},
  {v:'iexact',label:'Match · ignore case'},
  {v:'exact',label:'Match · exact'},
  {v:'contains',label:'Contains'},
  {v:'starts',label:'Starts with'},
  {v:'numeric',label:'Numeric equal'},
];
const OPLBL=Object.fromEntries(OPS.map(o=>[o.v,o.label]));
const EQ=new Set(['trim','iexact','exact','numeric']);

const $=s=>document.querySelector(s);
const el=(t,c,txt)=>{const e=document.createElement(t); if(c)e.className=c; if(txt!=null)e.textContent=txt; return e;};
function toast(m){const t=$('#toast'); t.textContent=m; t.classList.add('show'); clearTimeout(t._t); t._t=setTimeout(()=>t.classList.remove('show'),2000);}

function norm(v,op){
  const s=v==null?'':String(v);
  switch(op){
    case 'exact':return s;
    case 'iexact':return s.toLowerCase();
    case 'trim':return s.trim().toLowerCase();
    case 'numeric':{const n=Number(s.replace(/[^0-9.\-]/g,'')); return isNaN(n)?'':String(n);}
    default:return s.trim().toLowerCase();
  }
}
function testCond(mv,lv,op){
  if(EQ.has(op)){const a=norm(mv,op); return a!==''&&a===norm(lv,op);}
  const a=(mv==null?'':String(mv)).trim().toLowerCase();
  const b=(lv==null?'':String(lv)).trim().toLowerCase();
  if(b==='')return false;
  return op==='starts'?a.startsWith(b):a.includes(b);
}
function lev(a,b){
  a=a||''; b=b||''; const m=a.length,n=b.length;
  if(!m)return n; if(!n)return m;
  const d=new Array(n+1); for(let j=0;j<=n;j++)d[j]=j;
  for(let i=1;i<=m;i++){let prev=d[0]; d[0]=i;
    for(let j=1;j<=n;j++){const tmp=d[j]; d[j]=Math.min(d[j]+1,d[j-1]+1,prev+(a[i-1]===b[j-1]?0:1)); prev=tmp;}}
  return d[n];
}

function parseFile(file){
  return new Promise((res,rej)=>{
    Papa.parse(file,{header:true, skipEmptyLines:'greedy', transformHeader:h=>h.trim(),
      complete:r=>{const headers=(r.meta.fields||[]).filter(h=>h!==''); if(!headers.length)return rej(new Error('No column headers found in '+file.name)); res({name:file.name,headers,rows:r.data});},
      error:e=>rej(e)});
  });
}

function getLookup(id){return S.lookups.find(l=>l.id===id);}

function buildIndex(lk,strat){
  const map=new Map();
  for(const row of lk.rows){
    let bad=false; const comps=[];
    for(const c of strat.conditions){const k=norm(row[c.lookupColumn],c.op); if(k===''){bad=true;break;} comps.push(k);}
    if(bad)continue;
    const key=comps.join('\u0000'); (map.get(key)||map.set(key,[]).get(key)).push(row);
  }
  return map;
}
function runRule(rule){
  const lk=getLookup(rule.lookupId);
  const out={matched:0,unmatched:0,ambiguous:0,results:[]};
  if(!lk){out.results=S.main.rows.map(()=>({matched:false})); out.unmatched=S.main.rows.length; return out;}
  const valid=rule.strategies.filter(s=>s.conditions.length&&s.conditions.every(c=>c.mainColumn&&c.lookupColumn));
  const prep=valid.map(s=>({s,hash:s.conditions.every(c=>EQ.has(c.op)),idx:null}));
  for(const p of prep){if(p.hash)p.idx=buildIndex(lk,p.s);}
  for(const row of S.main.rows){
    let hit=null,ambig=false;
    for(const p of prep){
      let cand;
      if(p.hash){
        let bad=false; const comps=[];
        for(const c of p.s.conditions){const k=norm(row[c.mainColumn],c.op); if(k===''){bad=true;break;} comps.push(k);}
        if(bad)continue;
        cand=p.idx.get(comps.join('\u0000'))||[];
      }else{
        cand=lk.rows.filter(lr=>p.s.conditions.every(c=>testCond(row[c.mainColumn],lr[c.lookupColumn],c.op)));
      }
      if(cand.length===0)continue;
      if(cand.length>1&&rule.requireUnique){ambig=true;continue;}
      hit={row:cand[0],label:p.s.label};break;
    }
    if(hit){out.matched++; out.results.push({matched:true,row:hit.row,label:hit.label});}
    else{out.unmatched++; if(ambig)out.ambiguous++; out.results.push({matched:false});}
  }
  return out;
}

function process(){
  $('#runError').hidden=true;
  const headers=[...S.main.headers];
  const rows=S.main.rows.map(r=>Object.assign({},r));
  const newCols=new Set();
  const addCol=n=>{if(n&&!headers.includes(n))headers.push(n); if(n)newCols.add(n);};
  const perRule=[];
  for(const rule of S.rules){
    const res=runRule(rule); perRule.push({rule,res});
    if(rule.flag.on)addCol(rule.flag.name);
    if(rule.method.on)addCol(rule.method.name);
    for(const cp of rule.copies){if(cp.lookupColumn&&cp.newName)addCol(cp.newName);}
    const unmatchedRows=[];
    res.results.forEach((r,i)=>{
      const dst=rows[i];
      if(rule.flag.on&&rule.flag.name)dst[rule.flag.name]=r.matched?'TRUE':'FALSE';
      if(rule.method.on&&rule.method.name)dst[rule.method.name]=r.matched?(r.label||''):'';
      for(const cp of rule.copies){if(cp.lookupColumn&&cp.newName)dst[cp.newName]=r.matched?(r.row[cp.lookupColumn]??''):'';}
      if(!r.matched)unmatchedRows.push({i,row:S.main.rows[i]});
    });
    perRule[perRule.length-1].unmatchedRows=unmatchedRows;
  }
  S.output={headers,rows,newCols,perRule};
  renderStats(perRule); renderViewToggle(); renderResults();
  $('#downloadBtn').hidden=false; $('#copyBtn').hidden=false;
  toast('Done · '+rows.length+' rows processed');
}

/* ---- files ---- */
function renderFiles(){
  const mt=$('#mainTag'); mt.innerHTML='';
  $('#mainDrop').classList.toggle('filled',!!S.main);
  if(S.main){
    const tag=el('div','file-tag');
    tag.append(el('span','nm',S.main.name),el('span','meta',S.main.rows.length+' rows · '+S.main.headers.length+' cols'));
    const x=el('button','x','✕'); x.onclick=()=>{S.main=null; renderFiles(); renderRules(); syncRun();}; tag.append(x); mt.append(tag);
  }
  const list=$('#lkList'); list.innerHTML='';
  S.lookups.forEach(lk=>{
    const tag=el('div','file-tag');
    tag.append(el('span','nm',lk.name),el('span','meta',lk.rows.length+' rows · '+lk.headers.length+' cols'));
    const x=el('button','x','✕'); x.onclick=()=>{S.lookups=S.lookups.filter(l=>l.id!==lk.id); S.rules.forEach(r=>{if(r.lookupId===lk.id)r.lookupId=null;}); renderFiles(); renderRules(); syncRun();}; tag.append(x); list.append(tag);
  });
}

/* ---- rules ---- */
function mkSelect(opts,val,ph){
  const s=el('select');
  if(ph!=null){const o=el('option','',ph); o.value=''; s.append(o);}
  opts.forEach(o=>{const e=el('option','',o); e.value=o; if(o===val)e.selected=true; s.append(e);});
  if(ph!=null&&!opts.includes(val))s.value='';
  return s;
}
function newStrategy(n){return {id:nid(),label:'Strategy '+n,conditions:[{id:nid(),mainColumn:'',op:'trim',lookupColumn:''}]};}
function newRule(){const lk=S.lookups[0]; return {id:nid(),name:'Rule '+(S.rules.length+1),lookupId:lk?lk.id:null,requireUnique:true,strategies:[newStrategy(1)],flag:{on:true,name:'matched'},method:{on:false,name:'match_method'},copies:[]};}

function renderRules(){
  const host=$('#rulesHost'); host.innerHTML='';
  if(!S.rules.length){host.append(el('div','rules-empty','No rules yet. Add a rule to define how rows should be matched.')); return;}
  S.rules.forEach(rule=>host.append(ruleCard(rule)));
}
function replaceCard(rule,oldCard){oldCard.replaceWith(ruleCard(rule));}

function ruleCard(rule){
  const lk=getLookup(rule.lookupId);
  const card=el('div','rule');
  const top=el('div','rule-top');
  const nm=el('input','rname'); nm.type='text'; nm.value=rule.name; nm.placeholder='Rule name'; nm.oninput=()=>rule.name=nm.value;
  const against=el('div','against'); against.append(el('span','','Match against'));
  const lkSel=mkSelect(S.lookups.map(l=>l.name),lk?lk.name:'',S.lookups.length?'choose a reference file':'no reference file'); lkSel.disabled=!S.lookups.length;
  lkSel.onchange=()=>{const f=S.lookups.find(l=>l.name===lkSel.value); rule.lookupId=f?f.id:null; replaceCard(rule,card);};
  against.append(lkSel);
  const del=el('button','iconbtn del','🗑'); del.title='Delete rule'; del.onclick=()=>{S.rules=S.rules.filter(r=>r.id!==rule.id); renderRules();};
  top.append(nm,against,del); card.append(top);

  const body=el('div','rule-body');

  const sb=el('div','block');
  sb.append(el('p','block-h','Match strategies (tried in order)'));
  sb.append(el('p','hint-row','The first strategy that finds a match wins. Put your most confident match first.'));
  rule.strategies.forEach((st,i)=>{if(i){const o=el('div','or-sep'); o.append(el('span','','OR')); sb.append(o);} sb.append(strategyEl(rule,st,i));});
  const addS=el('button','linkbtn','+ Add strategy'); addS.onclick=()=>{rule.strategies.push(newStrategy(rule.strategies.length+1)); replaceCard(rule,card);}; sb.append(addS);
  body.append(sb);

  const ob=el('div','block');
  const uniq=el('label','chk'); const ucb=el('input'); ucb.type='checkbox'; ucb.checked=rule.requireUnique; ucb.onchange=()=>rule.requireUnique=ucb.checked;
  uniq.append(ucb,el('span','','Only accept a strategy when it matches exactly one reference row (rejects ambiguous matches)')); ob.append(uniq); body.append(ob);

  const outb=el('div','block');
  outb.append(el('p','block-h','On match, add to the output'));
  const fr=el('div','out-row'); const fl=el('label','chk'); const fcb=el('input'); fcb.type='checkbox'; fcb.checked=rule.flag.on;
  const fin=el('input'); fin.type='text'; fin.value=rule.flag.name; fin.placeholder='column name'; fin.disabled=!rule.flag.on;
  fcb.onchange=()=>{rule.flag.on=fcb.checked; fin.disabled=!fcb.checked;}; fin.oninput=()=>rule.flag.name=fin.value;
  fl.append(fcb,el('span','','A TRUE/FALSE flag column named')); fr.append(fl,fin); outb.append(fr);
  const mr=el('div','out-row'); const ml=el('label','chk'); const mcb=el('input'); mcb.type='checkbox'; mcb.checked=rule.method.on;
  const min=el('input'); min.type='text'; min.value=rule.method.name; min.placeholder='column name'; min.disabled=!rule.method.on;
  mcb.onchange=()=>{rule.method.on=mcb.checked; min.disabled=!mcb.checked;}; min.oninput=()=>rule.method.name=min.value;
  ml.append(mcb,el('span','','A column recording which strategy matched, named')); mr.append(ml,min); outb.append(mr);
  outb.append(el('p','block-h','Copy values from the matched reference row'));
  rule.copies.forEach(cp=>outb.append(copyRow(rule,cp,lk)));
  const addCp=el('button','linkbtn','+ Copy a value'); addCp.disabled=!lk; addCp.onclick=()=>{rule.copies.push({id:nid(),lookupColumn:'',newName:''}); replaceCard(rule,card);}; outb.append(addCp);
  body.append(outb);
  card.append(body);
  return card;
}
function strategyEl(rule,st,i){
  const lk=getLookup(rule.lookupId);
  const wrap=el('div','strategy');
  const top=el('div','strategy-top');
  const lbl=el('input','slabel'); lbl.type='text'; lbl.value=st.label; lbl.placeholder='Strategy name'; lbl.oninput=()=>st.label=lbl.value;
  const order=el('div','order');
  const up=el('button','iconbtn','↑'); up.disabled=i===0; up.title='Move up'; up.onclick=()=>{[rule.strategies[i-1],rule.strategies[i]]=[rule.strategies[i],rule.strategies[i-1]]; renderRules();};
  const dn=el('button','iconbtn','↓'); dn.disabled=i===rule.strategies.length-1; dn.title='Move down'; dn.onclick=()=>{[rule.strategies[i+1],rule.strategies[i]]=[rule.strategies[i],rule.strategies[i+1]]; renderRules();};
  const rm=el('button','iconbtn del','✕'); rm.title='Remove strategy'; rm.disabled=rule.strategies.length===1; rm.onclick=()=>{rule.strategies=rule.strategies.filter(s=>s.id!==st.id); renderRules();};
  order.append(up,dn); top.append(lbl,order,rm); wrap.append(top);
  const conds=el('div','conds');
  st.conditions.forEach((c,ci)=>{
    const row=el('div','cond');
    const mSel=mkSelect(S.main?S.main.headers:[],c.mainColumn,'main column'); mSel.disabled=!S.main; mSel.onchange=()=>c.mainColumn=mSel.value;
    const opSel=el('select'); OPS.forEach(o=>{const e=el('option','',o.label); e.value=o.v; if(o.v===c.op)e.selected=true; opSel.append(e);}); opSel.onchange=()=>c.op=opSel.value;
    const lSel=mkSelect(lk?lk.headers:[],c.lookupColumn,lk?'reference column':'pick a file'); lSel.disabled=!lk; lSel.onchange=()=>c.lookupColumn=lSel.value;
    const x=el('button','iconbtn del','✕'); x.title='Remove condition'; x.disabled=st.conditions.length===1; x.onclick=()=>{st.conditions=st.conditions.filter(k=>k.id!==c.id); renderRules();};
    row.append(mSel,opSel,lSel,x); conds.append(row);
    if(ci<st.conditions.length-1){const a=el('div'); a.style.cssText='margin:-2px 0 6px'; a.append(el('span','and-tag','AND')); conds.append(a);}
  });
  const addC=el('button','linkbtn mute','+ condition'); addC.style.marginTop='2px'; addC.onclick=()=>{st.conditions.push({id:nid(),mainColumn:'',op:'trim',lookupColumn:''}); renderRules();}; conds.append(addC);
  wrap.append(conds); return wrap;
}
function copyRow(rule,cp,lk){
  const row=el('div','copy-row');
  const lSel=mkSelect(lk?lk.headers:[],cp.lookupColumn,'reference column'); lSel.disabled=!lk; lSel.onchange=()=>cp.lookupColumn=lSel.value;
  const nameIn=el('input'); nameIn.type='text'; nameIn.value=cp.newName; nameIn.placeholder='new column name'; nameIn.oninput=()=>cp.newName=nameIn.value;
  const x=el('button','iconbtn del','✕'); x.onclick=()=>{rule.copies=rule.copies.filter(k=>k.id!==cp.id); renderRules();};
  row.append(lSel,el('span','arrow','→'),nameIn,x); return row;
}

/* ---- stats + results ---- */
function renderStats(perRule){
  const host=$('#statsHost'); host.innerHTML=''; const wrap=el('div','stats');
  perRule.forEach(({rule,res})=>{
    const total=res.matched+res.unmatched; const pct=total?Math.round(res.matched/total*100):0;
    const s=el('div','stat ok'); s.append(el('div','k',rule.name));
    const v=el('div','v'); v.append(document.createTextNode(res.matched+' ')); v.append(el('small','','/ '+total+' matched · '+pct+'%')); s.append(v); wrap.append(s);
    if(res.unmatched>0){const u=el('div','stat warn'); u.append(el('div','k','Unmatched')); u.append(el('div','v',String(res.unmatched))); wrap.append(u);}
    if(res.ambiguous>0){const a=el('div','stat warn'); a.append(el('div','k','Ambiguous (skipped)')); a.append(el('div','v',String(res.ambiguous))); wrap.append(a);}
  });
  host.append(wrap);
}
function renderViewToggle(){
  const host=$('#viewToggle'); host.innerHTML='';
  const totalUn=S.output.perRule.reduce((a,p)=>a+(p.unmatchedRows?p.unmatchedRows.length:0),0);
  const seg=el('div','seg');
  const b1=el('button','','Output preview'); b1.classList.toggle('active',S.view==='preview'); b1.onclick=()=>{S.view='preview'; renderViewToggle(); renderResults();};
  const b2=el('button','','Unmatched ('+totalUn+')'); b2.classList.toggle('active',S.view==='unmatched'); b2.onclick=()=>{S.view='unmatched'; renderViewToggle(); renderResults();};
  seg.append(b1,b2); host.append(seg);
}
function renderResults(){
  $('#previewHost').innerHTML=''; $('#unmatchedHost').innerHTML='';
  if(!S.output)return;
  if(S.view==='preview')renderPreview(); else renderUnmatched();
}
function renderPreview(){
  const host=$('#previewHost'); const {headers,rows,newCols}=S.output;
  const cap=Math.min(rows.length,200);
  const scroll=el('div','table-scroll'); const tbl=el('table');
  const thead=el('thead'); const htr=el('tr');
  headers.forEach(h=>{const th=el('th','',h); if(newCols.has(h))th.classList.add('new'); htr.append(th);}); thead.append(htr); tbl.append(thead);
  const tb=el('tbody');
  for(let i=0;i<cap;i++){const tr=el('tr'); headers.forEach(h=>{const val=rows[i][h]??''; const td=el('td','',String(val)); if(newCols.has(h)){td.classList.add('new'); if(val==='TRUE')td.classList.add('cell-true'); if(val==='FALSE')td.classList.add('cell-false');} tr.append(td);}); tb.append(tr);}
  tbl.append(tb); scroll.append(tbl); host.append(scroll);
  host.append(el('p','preview-note','Showing '+cap+' of '+rows.length+' rows · new columns highlighted'));
}
function reasonsFor(rule,mainRow){
  const out=[];
  rule.strategies.forEach(s=>{
    if(!s.conditions.length||!s.conditions.every(c=>c.mainColumn&&c.lookupColumn))return;
    const parts=s.conditions.map(c=>({col:c.mainColumn,val:(mainRow[c.mainColumn]==null?'':String(mainRow[c.mainColumn])),op:c.op}));
    const blank=parts.find(p=>norm(p.val,p.op==='numeric'?'numeric':'trim')==='');
    out.push({label:s.label,parts,blankCol:blank?blank.col:null});
  });
  return out;
}
function nearest(rule,mainRow){
  const lk=getLookup(rule.lookupId); if(!lk||lk.rows.length>60000)return null;
  const cands=[];
  rule.strategies.forEach(s=>s.conditions.forEach(c=>{
    if(c.mainColumn&&c.lookupColumn){const mv=(mainRow[c.mainColumn]==null?'':String(mainRow[c.mainColumn])).trim().toLowerCase(); if(mv)cands.push({c,mv,raw:String(mainRow[c.mainColumn])});}
  }));
  if(!cands.length)return null;
  let best=null;
  for(const row of lk.rows){
    for(const cd of cands){
      const rv=(row[cd.c.lookupColumn]==null?'':String(row[cd.c.lookupColumn])).trim().toLowerCase(); if(!rv)continue;
      const d=lev(cd.mv,rv);
      if(!best||d<best.dist)best={dist:d,row,mainCol:cd.c.mainColumn,refCol:cd.c.lookupColumn,mainVal:cd.raw,refVal:String(row[cd.c.lookupColumn]),op:cd.c.op};
      if(d===0)break;
    }
    if(best&&best.dist===0)break;
  }
  if(!best)return null;
  const thresh=Math.max(2,Math.ceil(best.mainVal.length*0.34));
  return best.dist<=thresh?best:null;
}
function renderUnmatched(){
  const host=$('#unmatchedHost');
  const idCols=S.main.headers.slice(0,4);
  let any=false;
  S.output.perRule.forEach(pr=>{
    const list=pr.unmatchedRows||[];
    const sec=el('div','um-section');
    const h=el('div','um-h'); h.append(el('span','',pr.rule.name));
    if(list.length)h.append(el('span','cnt',list.length+' unmatched'));
    sec.append(h);
    if(!list.length){const ok=el('div','um-none'); ok.append(el('span','','✓'),el('span','','Every row matched.')); sec.append(ok); host.append(sec); return;}
    any=true;
    const cap=Math.min(list.length,100);
    for(let k=0;k<cap;k++){
      const {row}=list[k];
      const card=el('div','um-card');
      const idline=el('div','um-id'); idCols.forEach((c,ix)=>{ if(ix)idline.append(document.createTextNode('   ')); idline.append(el('b',null,c+': ')); idline.append(document.createTextNode(row[c]==null||row[c]===''?'—':String(row[c]))); }); card.append(idline);
      const ul=el('ul','um-reasons');
      reasonsFor(pr.rule,row).forEach(r=>{
        const li=el('li');
        li.append(el('span','rlabel',r.label+': '));
        if(r.blankCol){li.append(el('span','blank','“'+r.blankCol+'” is blank — skipped'));}
        else{
          r.parts.forEach((p,pi)=>{ if(pi)li.append(document.createTextNode(' + ')); li.append(el('span','val',p.col+'=“'+p.val+'”')); });
          li.append(el('span','miss',' → not found'));
        }
        ul.append(li);
      });
      card.append(ul);
      const btn=el('button','linkbtn mute','Find closest reference row');
      const slot=el('div');
      btn.onclick=()=>{
        btn.disabled=true; btn.textContent='Searching…';
        setTimeout(()=>{
          const n=nearest(pr.rule,row); slot.innerHTML=''; const box=el('div','near');
          if(!n){box.append(el('span','none','No close reference row found — this looks genuinely absent.'));}
          else if(n.dist===0){box.append(el('span','ok','Values are identical bar case/spacing: '),el('span','diff','“'+n.mainVal+'” vs “'+n.refVal+'”'),el('span','',' — your match condition may be too strict (try “trim + ignore case”), or a second AND condition is failing.'));}
          else{box.append(el('span','',n.dist+(n.dist===1?' character':' characters')+' off on '+n.mainCol+' ↔ '+n.refCol+': '),el('span','diff','“'+n.mainVal+'” vs “'+n.refVal+'”'));}
          slot.append(box); btn.remove();
        },10);
      };
      card.append(btn,slot);
      sec.append(card);
    }
    if(list.length>cap)sec.append(el('p','preview-note','Showing first '+cap+' of '+list.length+' unmatched rows.'));
    host.append(sec);
  });
  if(!any&&!host.children.length)host.append(el('div','um-none','Run matching to see results.'));
}

/* ---- run gating ---- */
function syncRun(){
  const hasRule=S.rules.some(r=>r.lookupId&&r.strategies.some(s=>s.conditions.some(c=>c.mainColumn&&c.lookupColumn)));
  const ok=!!S.main&&hasRule;
  $('#runBtn').disabled=!ok;
  $('#runNote').textContent=!S.main?'Add a main file to run.':(!hasRule?'Add at least one rule with a complete condition.':'Ready · '+S.main.rows.length+' rows.');
  if(!ok){$('#downloadBtn').hidden=true; $('#copyBtn').hidden=true;}
}

/* ---- export ---- */
function outputCSV(){const {headers,rows}=S.output; return Papa.unparse({fields:headers,data:rows.map(r=>headers.map(h=>r[h]??''))});}
function outName(){return (S.main.name||'output').replace(/\.[^.]+$/,'')+'.reconciled.csv';}
async function saveFile(text,filename,mime){
  const useFn=window.claude&&window.claude.use;
  if(useFn){try{const dl=await window.claude.use('downloads'); if(dl){const r=await dl.save({filename,data:text}); if(r&&r.status==='saved')toast('Saved'); return;}}catch(e){if(e&&e.code==='declined'){toast('Cancelled'); return;}}}
  const blob=new Blob([text],{type:mime||'application/octet-stream'}); const a=el('a'); a.href=URL.createObjectURL(blob); a.download=filename; document.body.append(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href),1000); toast('Downloaded');
}
async function copyCSV(){try{await navigator.clipboard.writeText(outputCSV()); toast('Copied to clipboard');}catch(e){toast('Copy failed');}}

/* ---- setups (save workflow) ---- */
function serialize(name){
  return {v:1,name:name||'',savedAt:new Date().toISOString(),rules:S.rules.map(r=>({
    name:r.name, requireUnique:r.requireUnique,
    strategies:r.strategies.map(s=>({label:s.label,conditions:s.conditions.map(c=>({mainColumn:c.mainColumn,op:c.op,lookupColumn:c.lookupColumn}))})),
    flag:{on:r.flag.on,name:r.flag.name}, method:{on:r.method.on,name:r.method.name},
    copies:r.copies.map(c=>({lookupColumn:c.lookupColumn,newName:c.newName}))
  }))};
}
function applyConfig(cfg){
  if(!cfg||!Array.isArray(cfg.rules))return toast('Not a valid setup file');
  const lk=S.lookups[0];
  S.rules=cfg.rules.map(r=>{
    return {id:nid(),name:r.name||'Rule',lookupId:lk?lk.id:null,requireUnique:r.requireUnique!==false,
      strategies:(r.strategies||[]).map((s,si)=>({id:nid(),label:s.label||('Strategy '+(si+1)),conditions:(s.conditions||[]).map(c=>({id:nid(),mainColumn:c.mainColumn||'',op:c.op||'trim',lookupColumn:c.lookupColumn||''}))})),
      flag:Object.assign({on:true,name:'matched'},r.flag||{}),
      method:Object.assign({on:false,name:'match_method'},r.method||{}),
      copies:(r.copies||[]).map(c=>({id:nid(),lookupColumn:c.lookupColumn||'',newName:c.newName||''}))};
  });
  if(!S.rules.length)S.rules=[];
  renderRules(); syncRun();
}
function loadStore(){try{return JSON.parse(localStorage.getItem(STORE_KEY)||'{}');}catch(e){return {};}}
function saveStore(o){try{localStorage.setItem(STORE_KEY,JSON.stringify(o)); return true;}catch(e){return false;}}
function refreshSetupList(sel){
  const store=loadStore(); const dd=$('#setupList'); dd.innerHTML='';
  const ph=el('option','',Object.keys(store).length?'Saved setups…':'No saved setups'); ph.value=''; dd.append(ph);
  Object.keys(store).sort().forEach(n=>{const o=el('option','',n); o.value=n; if(n===sel)o.selected=true; dd.append(o);});
}

/* ---- file wiring ---- */
function wireDrop(drop,input,handler){
  drop.onclick=()=>input.click();
  drop.ondragover=e=>{e.preventDefault(); drop.classList.add('over');};
  drop.ondragleave=()=>drop.classList.remove('over');
  drop.ondrop=e=>{e.preventDefault(); drop.classList.remove('over'); handler(e.dataTransfer.files);};
  input.onchange=()=>{handler(input.files); input.value='';};
}
async function loadMain(files){if(!files||!files[0])return; try{S.main=await parseFile(files[0]); renderFiles(); renderRules(); syncRun();}catch(e){toast(e.message||'Could not read file');}}
async function loadLookups(files){for(const f of files){try{const d=await parseFile(f); S.lookups.push(Object.assign({id:nid()},d));}catch(e){toast(e.message||'Could not read '+f.name);}} const first=S.lookups[0]; if(first)S.rules.forEach(r=>{if(!r.lookupId)r.lookupId=first.id;}); renderFiles(); renderRules(); syncRun();}

/* ---- example ---- */
function loadExample(){
  const main={name:'contacts.csv',headers:['first_name','last_name','email_address','company'],rows:[
    {first_name:'Jack',last_name:'Sparrow',email_address:'jack.sparrow@hns.com',company:'HNS'},
    {first_name:'Elizabeth',last_name:'Swann',email_address:'liz@portroyal.co',company:'Port Royal'},
    {first_name:'Will',last_name:'Turner',email_address:'',company:'Blacksmith Ltd'},
    {first_name:'Hector',last_name:'Barbossa',email_address:'hector@pearl.io',company:'Black Pearl'},
    {first_name:'James',last_name:'Norrington',email_address:'jnorrington@navy.gov',company:'Royal Navy'},
  ]};
  const crm={id:nid(),name:'crm_export.csv',headers:['email','surname','status','account_id'],rows:[
    {email:'JACK.SPARROW@hns.com',surname:'Sparrow',status:'Active',account_id:'A-1001'},
    {email:'unknown@x.com',surname:'Turner',status:'Lead',account_id:'A-1002'},
    {email:'hector@pearl.io',surname:'Barbossa',status:'Churned',account_id:'A-1003'},
    {email:'j.norrington@navy.gov',surname:'Norringtn',status:'Active',account_id:'A-1004'},
  ]};
  S.main=main; S.lookups=[crm];
  S.rules=[{id:nid(),name:'CRM lookup',lookupId:crm.id,requireUnique:true,
    strategies:[
      {id:nid(),label:'Email',conditions:[{id:nid(),mainColumn:'email_address',op:'trim',lookupColumn:'email'}]},
      {id:nid(),label:'Last name',conditions:[{id:nid(),mainColumn:'last_name',op:'trim',lookupColumn:'surname'}]},
    ],
    flag:{on:true,name:'in_crm'}, method:{on:true,name:'matched_on'},
    copies:[{id:nid(),lookupColumn:'status',newName:'crm_status'},{id:nid(),lookupColumn:'account_id',newName:'crm_account'}]}];
  renderFiles(); renderRules(); syncRun(); toast('Example loaded — Run, then check the Unmatched tab');
}

/* ---- init ---- */
wireDrop($('#mainDrop'),$('#mainInput'),loadMain);
wireDrop($('#lkDrop'),$('#lkInput'),loadLookups);
$('#addRuleBtn').onclick=()=>{S.rules.push(newRule()); renderRules(); syncRun();};
$('#runBtn').onclick=()=>{try{process(); syncRun();}catch(e){const er=$('#runError'); er.hidden=false; er.textContent='Error: '+(e.message||e);}};
$('#downloadBtn').onclick=()=>saveFile(outputCSV(),outName(),'text/csv;charset=utf-8');
$('#copyBtn').onclick=copyCSV;
$('#exampleBtn').onclick=loadExample;

$('#saveSetup').onclick=()=>{const name=$('#setupName').value.trim(); if(!name)return toast('Name the setup first'); const store=loadStore(); store[name]=serialize(name); if(saveStore(store)){refreshSetupList(name); toast('Setup “'+name+'” saved');}else toast('Could not save (storage blocked)');};
$('#loadSetup').onclick=()=>{const name=$('#setupList').value; if(!name)return toast('Pick a setup to load'); const store=loadStore(); if(!store[name])return toast('Setup not found'); applyConfig(store[name]); $('#setupName').value=name; toast('Loaded “'+name+'”');};
$('#delSetup').onclick=()=>{const name=$('#setupList').value; if(!name)return toast('Pick a setup to delete'); const store=loadStore(); delete store[name]; saveStore(store); refreshSetupList(''); toast('Deleted “'+name+'”');};
$('#exportSetup').onclick=()=>{const name=$('#setupName').value.trim()||'reconcile-setup'; saveFile(JSON.stringify(serialize(name),null,2),name.replace(/[^a-z0-9_-]+/gi,'-')+'.reconcile.json','application/json');};
$('#importBtn').onclick=()=>$('#importFile').click();
$('#importFile').onchange=e=>{const f=e.target.files[0]; if(!f)return; const r=new FileReader(); r.onload=()=>{try{const cfg=JSON.parse(r.result); applyConfig(cfg); if(cfg.name)$('#setupName').value=cfg.name; toast('Setup imported');}catch(err){toast('Could not read setup file');}}; r.readAsText(f); e.target.value='';};

document.addEventListener('change',syncRun);
refreshSetupList('');
renderFiles(); renderRules(); syncRun();
})();
