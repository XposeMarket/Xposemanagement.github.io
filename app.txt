const LS={users:"xm_users",session:"xm_session",data:"xm_data",seeded:"xm_seeded",shops:"xm_shops"};
function readLS(k,f){try{const v=localStorage.getItem(k);return v?JSON.parse(v):(f??null);}catch(e){return f??null;}}
function writeLS(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch(e){}}
function byId(id){return document.getElementById(id);} function todayISO(){return new Date().toISOString().slice(0,10);} function fmtMoney(n){return Number(n||0).toFixed(2);}
/* === EDIT #7: Auto-invoice helper (create-or-reuse by appointment_id) === */
function ensureInvoiceForAppt(apptId){
  try{
    const d = readLS(LS.data,{appointments:[],invoices:[]});
    if(!d) return null;
    // reuse existing (open or paid)
    let inv = (d.invoices||[]).find(i => i.appointment_id === apptId);
    if(inv) return inv;

    const appt = (d.appointments||[]).find(a => a.id === apptId) || null;
    const next = (d.invoices||[]).reduce((mx,i)=>Math.max(mx, Number(i.number||0)||0), 1000) + 1;
    inv = {
      id: "inv"+Date.now(),
      number: String(next),
      customer: appt ? (`${appt.customer_first||""} ${appt.customer_last||""}`.trim() || "Walk-in") : "Walk-in",
      appointment_id: apptId,
      status: "open",
      due: todayISO(),
      tax_rate: 6,
      discount: 0,
      items: [{ name: "Item", qty: 1, price: 0 }]
    };
    d.invoices = d.invoices || [];
    d.invoices.push(inv);
    writeLS(LS.data, d);
    return inv;
  }catch(_e){ return null; }
}
/* === /EDIT #7 === */
/* === EDIT #8: Labor presets + service snapshot + picker === */

// Ensure settings structure exists
function __shopSettings(){
  const d = readLS(LS.data, { settings:{} });
  d.settings = d.settings || {};
  d.settings.shop = d.settings.shop || {};
  d.settings.services = d.settings.services || [];       // [{name, parts_price, labor_rate, hours}]
  d.settings.shop.labor_rates = d.settings.shop.labor_rates || []; // [{id,name,rate,starred}]
  return d;
}
function __saveShopSettings(d){ writeLS(LS.data, d); }

function getLaborRates(){ return __shopSettings().settings.shop.labor_rates.slice(); }
function setLaborRates(list){ const d=__shopSettings(); d.settings.shop.labor_rates = list||[]; __saveShopSettings(d); }

function defaultLaborRate(){ const l=getLaborRates(); const s=l.find(r=>r.starred); return (s && Number(s.rate)) || 0; }

function serviceItemsFor(name, parts_price, labor_rate, hours){
  const items=[];
  if(Number(parts_price)>0) items.push({ name:`Parts – ${name}`, qty:1, price:Number(parts_price) });
  if(Number(labor_rate)>0 && Number(hours)>0) items.push({ name:`Labor – ${name}`, qty:Number(hours), price:Number(labor_rate) });
  return items.length ? items : [{ name:"Item", qty:1, price:0 }];
}

// Small, self-contained picker
function openRatePicker(opts){
  const onSelect = (opts && opts.onSelect) || function(){};
  const host = document.createElement("div");
  host.className = "rate-picker";

  function readRates(){ return getLaborRates().slice(); }
  function writeRates(list){ setLaborRates(list); }

  function draw(){
    const list = readRates();
    host.innerHTML = `
      <div class="toolbar" style="justify-content:space-between">
        <b>Labor Rates</b><button class="btn" id="rpClose">Close</button>
      </div>
    `;

    const wrap = document.createElement("div");
    list.forEach((r,i)=>{
      const row = document.createElement("div");
      row.className = "rate-row";
      row.innerHTML = `
        <div>${r.name} ${r.starred?'· <span class="rate-small">default</span>':''}</div>
        <div class="rate-actions">
          <b>$${Number(r.rate||0).toFixed(2)}/hr</b>
          <button class="btn rp-star">⭐</button>
          <button class="btn rp-edit">Edit</button>
          <button class="btn danger rp-del">Delete</button>
          <button class="btn rp-use">Select</button>
        </div>`;
      row.querySelector(".rp-use").addEventListener("click", ()=>{ onSelect(Number(r.rate||0), r); document.body.removeChild(host); });
      row.querySelector(".rp-star").addEventListener("click", ()=>{ const copy=readRates().map((x,j)=>({...x,starred:(j===i)})); writeRates(copy); draw(); });
      row.querySelector(".rp-edit").addEventListener("click", ()=>{ const name=prompt("Rate name:", r.name||"")||r.name; const rate=parseFloat(prompt("$/hr:", String(r.rate||0))); const copy=readRates(); copy[i]={...copy[i], name, rate:isNaN(rate)?r.rate:rate}; writeRates(copy); draw(); });
      row.querySelector(".rp-del").addEventListener("click", ()=>{ const copy=readRates(); copy.splice(i,1); writeRates(copy); draw(); });
      wrap.appendChild(row);
    });

    const add = document.createElement("div");
    add.className = "toolbar"; add.style.marginTop="8px";
    add.innerHTML = `<button class="btn" id="rpAdd">➕ New Rate</button>`;
    wrap.appendChild(add);

    host.appendChild(wrap);
    host.querySelector("#rpAdd").addEventListener("click", ()=>{
      const name = prompt("New rate name:");
      if(!name) return;
      const rate = parseFloat(prompt("$/hr:","0"))||0;
      const copy = readRates(); copy.push({ id:"lr"+Date.now(), name, rate, starred:(!copy.length) });
      writeRates(copy); draw();
    });
    host.querySelector("#rpClose").addEventListener("click", ()=> document.body.removeChild(host));
  }

  draw();
  document.body.appendChild(host);
}

const ROLE_PAGES={admin:["dashboard","invoice","appointments","jobs","messages","invoices","settings","profile"],service_writer:["dashboard","invoice","appointments","messages","invoices","profile"],receptionist:["dashboard","messages","appointments","profile"],staff:["dashboard","appointments","jobs","profile"]};
function currentUser(){const s=readLS(LS.session,null);if(!s)return null;return readLS(LS.users,[]).find(x=>x.email===s.email)||null;}
function currentShop(){const u=currentUser();const shops=readLS(LS.shops,[])||[];return u?shops.find(s=>s.id===u.shop_id)||shops[0]||null:shops[0]||null;}
async function __ensureSeedBase(){if(readLS(LS.seeded,false))return;writeLS(LS.users,[{id:"u1",first:"Owner",last:"User",email:"owner@gr.test",password:"admin123",role:"admin",shop_id:"s1"}]);writeLS(LS.shops,[{id:"s1",name:"GR Automotive",type:"Mechanic",join_code:"ABCD12",staff_limit:3}]);writeLS(LS.data,{settings:{shop:{name:"GR Automotive",phone:"301-937-0026",email:"contact@grauto.test"}},appointments:[{id:"a1",created_at:new Date().toISOString(),customer_first:"Evan",customer_last:"Ramos",email:"evan.ramos@example.com",phone:"(301) 555-0182",vehicle:"2014 BMW 335i",service:"Brake inspection",preferred_date:todayISO(),preferred_time:"10:00",status:"scheduled",source:"inquiry",shop_id:"s1"}],jobs:[{id:"J1001",appointment_id:"a1",status:"scheduled",shop_id:"s1"}],threads:[{id:"t1",type:"inquiry",title:"New Inquiry · Evan Ramos",meta:{name:"Evan Ramos",phone:"(301) 555-0182",email:"evan.ramos@example.com",vehicle:"2014 BMW 335i",service:"Brake inspection",date:todayISO(),time:"10:00",notes:"Grinding noise on front left."},messages:[{from:"system",body:"New inquiry submitted from website.",created_at:new Date().toISOString()}],shop_id:"s1"}],invoices:[{id:"inv1001",number:"1001",customer:"Evan Ramos",appointment_id:"a1",status:"open",due:todayISO(),tax_rate:6,discount:0,items:[{name:"Labor",qty:1,price:120},{name:"Parts",qty:1,price:45}],shop_id:"s1"}]});writeLS(LS.seeded,true);}
function setThemeFromUser(){const u=currentUser();const t=(u&&u.theme)||"light";document.documentElement.classList.toggle("dark",t==="dark");}
function toggleTheme(){const html=document.documentElement;html.classList.toggle("dark");const dark=html.classList.contains("dark");const u=currentUser();if(!u)return;const users=readLS(LS.users,[]);const i=users.findIndex(x=>x.id===u.id);if(i>=0){users[i].theme=dark?"dark":"light";writeLS(LS.users,users);}}
function pageName(){const p=(location.pathname.split("/").pop()||"index.html").toLowerCase();return p.replace(".html","");}
function applyNavPermissions(){const u=currentUser();if(!u)return;const allowed=ROLE_PAGES[u.role]||[];document.querySelectorAll("header nav a").forEach(a=>{const href=(a.getAttribute("href")||"").toLowerCase();const pn=href.replace(".html","").replace("./","");if(href&&pn&&!allowed.includes(pn)){a.style.display="none";}});}
function enforcePageAccess(){const u=currentUser();if(!u)return;const allowed=ROLE_PAGES[u.role]||[];const pn=pageName();const open=["index","signup","create-shop"];if(!allowed.includes(pn)&&!open.includes(pn)){if(allowed.includes("dashboard"))location.href="dashboard.html";else location.href="index.html";}}
function requireAuth(){const u=currentUser();const pn=pageName();const open=["index","signup","create-shop",""];if(!u&&!open.includes(pn))location.href="index.html";if(u){applyNavPermissions();enforcePageAccess();}}
function logout(){localStorage.removeItem(LS.session);location.href="index.html";}
async function ensureSeed(){await __ensureSeedBase();}
async function __mainBase(){await ensureSeed();setThemeFromUser();if(byId("themeToggle"))byId("themeToggle").addEventListener("click",toggleTheme);if(byId("logoutBtn"))byId("logoutBtn").addEventListener("click",logout);const p=pageName();if(p==="index"||p==="")setupLogin();else{requireAuth();if(p==="dashboard")setupDashboard();if(p==="appointments")setupAppointments();if(p==="jobs")setupJobs();if(p==="messages")setupMessages();if(p==="invoices")setupInvoices();if(p==="profile")setupProfile();if(p==="settings")setupSettings();}}
function makeSortable(table,rowBuilder){if(!table)return;const thead=table.querySelector("thead");const tbody=table.querySelector("tbody");let sortKey=null,sortDir=1;if(!thead)return;thead.querySelectorAll("th").forEach(th=>{th.style.cursor="pointer";th.addEventListener("click",()=>{const key=th.getAttribute("data-key")||th.textContent.toLowerCase().trim();sortDir=(sortKey===key)?-sortDir:1;sortKey=key;const rows=rowBuilder();rows.sort((a,b)=>{const va=a[key],vb=b[key];const na=!isNaN(parseFloat(va))&&isFinite(va);const nb=!isNaN(parseFloat(vb))&&isFinite(vb);if(na&&nb)return(parseFloat(va)-parseFloat(vb))*sortDir;if(/^\\d{4}-\\d{2}-\\d{2}$/.test(va||"")&&/^\\d{4}-\\d{2}-\\d{2}$/.test(vb||""))return(va.localeCompare(vb))*sortDir;return String(va||"").localeCompare(String(vb||""))*sortDir;});tbody.innerHTML="";rows.forEach(r=>tbody.appendChild(r.__tr));});});}
function setupLogin(){const form=byId("loginForm");if(!form)return;form.addEventListener("submit",(e)=>{e.preventDefault();const email=byId("loginEmail").value.trim().toLowerCase();const pass=byId("loginPass").value;const u=readLS(LS.users,[]).find(x=>x.email===email&&x.password===pass);if(!u){byId("loginErr").textContent="Invalid credentials.";return;}writeLS(LS.session,{email:u.email,at:Date.now()});location.href="dashboard.html";});}
function setupDashboard(){const data=readLS(LS.data,{appointments:[],jobs:[],invoices:[]});const ref=new Date();function kpis(){const ym=ref.toISOString().slice(0,7);const appts=data.appointments.filter(a=>(a.preferred_date||"").startsWith(ym));const leads=data.appointments.filter(a=>(a.created_at||"").slice(0,7)===ym);const jobs=data.jobs.filter(j=>j.status!=="completed");const openInv=data.invoices.filter(i=>i.status!=="paid");byId("kpiLeads").textContent=leads.length;byId("kpiAppts").textContent=appts.length;byId("kpiJobs").textContent=jobs.length;byId("kpiInv").textContent=openInv.length;}function renderCal(){byId("monthLabel").textContent=ref.toLocaleString(undefined,{month:"long",year:"numeric"});const grid=byId("calGrid");grid.innerHTML="";const y=ref.getFullYear(),m=ref.getMonth();const first=new Date(y,m,1),start=first.getDay();const days=new Date(y,m+1,0).getDate();for(let i=0;i<start;i++){const d=document.createElement("div");grid.appendChild(d);}for(let d=1;d<=days;d++){const cell=document.createElement("div");cell.className="day";const iso=new Date(y,m,d).toISOString().slice(0,10);const appts=data.appointments.filter(a=>a.preferred_date===iso&&a.status!=="completed");const counts={new:0,scheduled:0,in_progress:0,awaiting_parts:0,completed:0};appts.forEach(a=>counts[a.status]=(counts[a.status]||0)+1);cell.innerHTML=`<div class="date">${d}</div>
<div class="dotRow">
  ${counts.new?'<span class="chip"><span class="dot big open"></span><span>New</span></span>':''}
  ${counts.scheduled?'<span class="chip"><span class="dot big scheduled"></span><span>Sch</span></span>':''}
  ${counts.in_progress?'<span class="chip"><span class="dot big progress"></span><span>Prog</span></span>':''}
  ${counts.awaiting_parts?'<span class="chip"><span class="dot big progress"></span><span>Parts</span></span>':''}
  ${counts.completed?'<span class="chip"><span class="dot big done"></span><span>Done</span></span>':''}
</div>
<div class="tooltip" role="tooltip" aria-hidden="true">New:${counts.new||0} · Sch:${counts.scheduled||0} · Prog:${counts.in_progress||0} · Parts:${counts.awaiting_parts||0} · Done:${counts.completed||0}</div>`;cell.setAttribute('tabindex','0');
cell.setAttribute('role','button');
cell.addEventListener("click",()=>{
  renderDay(appts);
  const tip = cell.querySelector('.tooltip');
  if(tip){
    const open = document.querySelector('.day .tooltip.show');
    if(open && open!==tip){ open.classList.remove('show'); open.setAttribute('aria-hidden','true'); }
    const now = tip.classList.toggle('show');
    tip.setAttribute('aria-hidden', now ? 'false' : 'true');
  }
});
cell.addEventListener('keydown',(ev)=>{
  if(ev.key==='Enter' || ev.key===' '){
    ev.preventDefault();
    const tip = cell.querySelector('.tooltip');
    if(tip){
      const open = document.querySelector('.day .tooltip.show');
      if(open && open!==tip){ open.classList.remove('show'); open.setAttribute('aria-hidden','true'); }
      const now = tip.classList.toggle('show');
      tip.setAttribute('aria-hidden', now ? 'false' : 'true');
    }
  }
});grid.appendChild(cell);}}function badge(st){const map={new:"open",scheduled:"scheduled",in_progress:"progress",awaiting_parts:"parts",completed:"done"};const c=map[st]||"";return `<span class="badge ${c}">${st}</span>`;}function renderDay(appts){const tb=document.querySelector("#dayTable tbody");tb.innerHTML="";const empty=byId("dayEmpty");if(!appts.length){empty.textContent="No appointments for this day.";return;}empty.textContent="";appts.forEach(a=>{const tr=document.createElement("tr");tr.innerHTML=`<td>${a.preferred_time||""}</td><td>${a.customer_first||""} ${a.customer_last||""}</td><td>${a.vehicle||""}</td><td>${a.service||""}</td><td>${badge(a.status)}</td><td><a class="btn" href="messages.html?appt=${a.id}">Message</a> <a class="btn" href="invoices.html?appt=${a.id}">Invoice</a></td>`;tb.appendChild(tr);});}kpis();renderCal();}

// EDIT #6: Close open calendar tooltip on outside click / ESC
document.addEventListener('click', (ev)=>{
  const open = document.querySelector('.day .tooltip.show');
  if(!open) return;
  const day = open.closest('.day');
  if(day && day.contains(ev.target)) return;
  open.classList.remove('show'); open.setAttribute('aria-hidden','true');
});
document.addEventListener('keydown', (ev)=>{
  if(ev.key==='Escape'){
    const open = document.querySelector('.day .tooltip.show');
    if(open){ open.classList.remove('show'); open.setAttribute('aria-hidden','true'); }
  }
});
function openEditService(apptId){
  const d = readLS(LS.data, { appointments:[], settings:{} });
  const a = (d.appointments||[]).find(x=>x.id===apptId);
  if(!a) return;

  const modal = byId("editSvcModal");
  if(!modal) return alert("Edit Service modal missing.");

  const svcI   = byId("esService");
  const partsI = byId("esParts");
  const laborI = byId("esLabor");
  const hoursI = byId("esHours");

  // Prefill from snapshot if present; otherwise from default rate
  svcI.value   = a.service || "";
  partsI.value = Number(a.parts_price||0);
  laborI.value = Number( (a.labor_rate!=null?a.labor_rate:defaultLaborRate()) ).toFixed(2);
  hoursI.value = Number(a.hours||0);

  const pickBtn = byId("esPickRate");
  pickBtn && pickBtn.addEventListener("click", ()=> openRatePicker({ onSelect:(rate)=>{ laborI.value = Number(rate||0).toFixed(2); } }), { once:true });

  byId("saveEditSvc")?.addEventListener("click", ()=>{
    a.service     = (svcI.value||a.service||"Service").trim();
    a.parts_price = Number(partsI.value||0);
    a.labor_rate  = Number(laborI.value||0);
    a.hours       = Number(hoursI.value||0);
    writeLS(LS.data, d);
    modal.classList.add("hidden");
    // redraw the table
    setupAppointments && setupAppointments();
  }, { once:true });

  byId("closeEditSvc")?.addEventListener("click", ()=> modal.classList.add("hidden"), { once:true });

  modal.classList.remove("hidden");
}

// /EDIT #6
function setupAppointments(){const modal=byId("apptModal");const openBtn=byId("newAppt");const closeBtn=byId("closeAppt");const saveBtn=byId("saveAppt");if(openBtn)openBtn.onclick=()=>modal.classList.remove("hidden");if(closeBtn)closeBtn.onclick=()=>modal.classList.add("hidden");if(saveBtn)saveBtn.onclick=()=>{const store=readLS(LS.data,{appointments:[]});const first=(byId("naFirst")||{}).value?.trim()||"";const last=(byId("naLast")||{}).value?.trim()||"";const phone=(byId("naPhone")||{}).value?.trim()||"";const vehicle=(byId("naVehicle")||{}).value?.trim()||"";const service=(byId("naService")||{}).value?.trim()||"";const date=(byId("naDate")||{}).value||"";const time=(byId("naTime")||{}).value||"";const email=(byId("naEmail")||{}).value?.trim()||"";if(!first||!last||!phone||!vehicle||!service){alert("Please fill required fields.");return;}store.appointments.push({id:"a"+Date.now(),created_at:new Date().toISOString(),customer_first:first,customer_last:last,email,phone,vehicle,service,preferred_date:date,preferred_time:time,status:"new",source:"walk-in"});writeLS(LS.data,store);modal.classList.add("hidden");draw();};function badge(st){const map={new:"open",scheduled:"scheduled",in_progress:"progress",awaiting_parts:"parts",completed:"done"};const c=map[st]||"";return `<span class="badge ${c}">${st}</span>`;}function draw(){const store=readLS(LS.data,{appointments:[]});const q=(byId("apptSearch")||{}).value?.toLowerCase()||"";const status=(byId("apptStatus")||{}).value||"";const rows=(store.appointments||[]).filter(a=>{const hay=`${a.customer_first} ${a.customer_last} ${a.vehicle} ${a.service}`.toLowerCase();const okQ=!q||hay.includes(q);const okS=(!status? a.status!=="completed":a.status===status);return okQ&&okS;});const tbody=document.querySelector("#apptTable tbody");tbody.innerHTML="";if(!rows.length){byId("apptEmpty").textContent="No appointments match.";return;}byId("apptEmpty").textContent="";const rowObjs=rows.map(a=>{const tr=document.createElement("tr");tr.innerHTML=`<td>${(a.created_at||"").slice(0,10)}</td><td>${a.customer_first} ${a.customer_last}</td><td>${a.vehicle}</td><td>${a.service}</td><td>${a.preferred_date||""}</td><td>${a.preferred_time||""}</td><td><select class="statusSel"><option value="new"${a.status==='new'?' selected':''}>new</option><option value="scheduled"${a.status==='scheduled'?' selected':''}>scheduled</option><option value="in_progress"${a.status==='in_progress'?' selected':''}>in_progress</option><option value="awaiting_parts"${a.status==='awaiting_parts'?' selected':''}>awaiting_parts</option><option value="completed"${a.status==='completed'?' selected':''}>completed</option></select></td>
<button class="btn" data-editsvc="${a.id}">Edit Service</button>


<td><a class="btn" href="messages.html?appt=${a.id}">Message</a> <a class="btn" href="invoices.html?appt=${a.id}">Invoice</a> <button class="btn danger" data-remove="${a.id}">Remove</button></td>`;const sel=tr.querySelector(".statusSel");sel.addEventListener("change",()=>{const st=readLS(LS.data,{appointments:[],jobs:[]});const i=st.appointments.findIndex(x=>x.id===a.id);if(i>=0){st.appointments[i].status=sel.value;}if(sel.value==="in_progress"){if(!(st.jobs||[]).some(j=>j.appointment_id===a.id)){(st.jobs=st.jobs||[]).push({id:"J"+Date.now(),appointment_id:a.id,status:"in_progress"});} }const ji=(st.jobs||[]).findIndex(j=>j.appointment_id===a.id);if(ji>=0){st.jobs[ji].status=sel.value;}/* INJECT: auto-invoice + merge-safe write */let __inv = null; if (sel.value === "completed") { try { __inv = ensureInvoiceForAppt(a.id); } catch(_e) {} } const __latestA = readLS(LS.data,{appointments:[],jobs:[],threads:[],invoices:[]}); __latestA.appointments = st.appointments; __latestA.jobs = st.jobs; writeLS(LS.data, __latestA); draw();});tr.querySelector('button[data-remove]').addEventListener('click',()=>{const st=readLS(LS.data,{appointments:[]});st.appointments=(st.appointments||[]).filter(x=>x.id!==a.id);writeLS(LS.data,st);draw();});tbody.appendChild(tr);return {__tr:tr,created:(a.created_at||"").slice(0,10),customer:`${a.customer_first} 
const esBtn = tr.querySelector('[data-editsvc]');
if(esBtn){ esBtn.addEventListener('click', ()=> openEditService(a.id)); }

${a.customer_last}`,vehicle:a.vehicle,service:a.service,date:a.preferred_date||"",time:a.preferred_time||"",status:a.status||"new"};});document.querySelectorAll("#apptTable thead th").forEach((th,i)=>{const map=["created","customer","vehicle","service","date","time","status","actions"];th.setAttribute("data-key",map[i]||"");});makeSortable(document.getElementById("apptTable"),()=>rowObjs);}if(byId("apptFilter"))byId("apptFilter").onclick=draw;draw();}

/* ====== REVISED: setupJobs() for clean staff split (Active vs Awaiting Parts) ====== */
function setupJobs(){
  const me=currentUser()||{};
  const shop=currentShop();
  const canAssign=(me.role==="admin"||me.role==="service_writer");
  const users=(readLS(LS.users,[])||[]).filter(u=>u.shop_id===(shop&&shop.id));
  const staffOptions=users.filter(u=>u.role!=="admin").map(u=>({id:u.id,label:`${u.first||""} ${u.last||""}`.trim()||u.email}));
  const store=readLS(LS.data,{appointments:[],jobs:[]});
  const rows=(store.jobs||[]).map(j=>({...j,a:(store.appointments||[]).find(x=>x.id===j.appointment_id)||{}}));

  const tb=document.querySelector("#jobsTable tbody");
  if(!tb) return;

  const awaitTbody=document.querySelector("#awaitTable tbody");
  const awaitEmpty=byId("awaitEmpty");
  const jobsEmpty=byId("jobsEmpty");

  const badge=(st)=>{const map={new:"open",scheduled:"scheduled",in_progress:"progress",awaiting_parts:"parts",completed:"done"};const c=map[st]||"";return `<span class="badge ${c}">${st}</span>`;};

  // STAFF — split view (keep UI clean; no duplicate headers)
  if(me.role==="staff"){
    const mine=rows.filter(r=>r.assigned_to===me.id);
    const active=mine.filter(r=>r.status==="in_progress" || r.status==="scheduled");
    const awaiting=mine.filter(r=>r.status==="awaiting_parts");

    function renderStaffRow(r){
      const tr=document.createElement("tr");
      const who=users.find(u=>u.id===r.assigned_to);
      const actions=document.createElement("td");

      const sel=document.createElement("select");
      sel.className="cx-status";
      sel.setAttribute("data-job", r.id);
      ["in_progress","awaiting_parts","completed"].forEach(st=>{
        const op=document.createElement("option");
        op.value=st; op.textContent=st; if(r.status===st) op.selected=true;
        sel.appendChild(op);
      });
      sel.addEventListener("change", ()=>{
        const d=readLS(LS.data,{appointments:[],jobs:[]});
        const i=(d.jobs||[]).findIndex(j=>j.id===r.id);
        if(i>=0){
          d.jobs[i].status=sel.value;
          // Keep appointment status in sync with job
          const ai=(d.appointments||[]).findIndex(a=>a.id===r.appointment_id);
          if(ai>=0){ d.appointments[ai].status = sel.value; }
          // EDIT #7: when staff marks completed, create/reuse invoice by appointment_id
          if(sel.value==="completed"){
            try{ ensureInvoiceForAppt(r.appointment_id); }catch(_e){}
          }
          // Merge-safe write to avoid clobbering invoices created by ensureInvoiceForAppt
          const __latestJ = readLS(LS.data,{appointments:[],jobs:[],threads:[],invoices:[]});
          __latestJ.jobs = d.jobs;
          __latestJ.appointments = d.appointments || (__latestJ.appointments||[]);
          writeLS(LS.data,__latestJ);
        }
        location.reload();
      });

      const rm=document.createElement("button");
      rm.className="btn danger";
      rm.textContent="Remove";
      rm.addEventListener("click", ()=>{
        const ok=confirm("Remove this job? OK=Delete · Cancel=Unassign");
        const d=readLS(LS.data,{jobs:[]});
        const i=(d.jobs||[]).findIndex(j=>j.id===r.id);
        if(i<0) return;
        if(ok){ d.jobs.splice(i,1); }
        else { d.jobs[i].assigned_to=null; if(d.jobs[i].status!=="completed") d.jobs[i].status="unassigned"; }
        writeLS(LS.data,d); location.reload();
      });

      tr.innerHTML=`<td>${r.id}</td>
        <td>${(r.a.customer_first||"?")} ${(r.a.customer_last||"")}</td>
        <td>${r.a.vehicle||""}</td>
        <td>${r.a.service||""}</td>
        <td>${badge(r.status)}</td>
        <td>${who?`${who.first||""} ${who.last||""}`.trim():"-"}</td>`;
      actions.appendChild(sel); actions.appendChild(rm);
      tr.appendChild(actions);

      return {__tr:tr,id:r.id,customer:`${r.a.customer_first||""} ${r.a.customer_last||""}`,vehicle:r.a.vehicle||"",service:r.a.service||"",status:r.status||"new"};
    }

    // Active table
    tb.innerHTML="";
    const activeRows=active.map(renderStaffRow);
    activeRows.forEach(r=>tb.appendChild(r.__tr));
    if(jobsEmpty) jobsEmpty.textContent = activeRows.length ? "" : "No active jobs.";

    // Awaiting Parts table
    if(awaitTbody){
      awaitTbody.innerHTML="";
      const awaitingRows=awaiting.map(renderStaffRow);
      awaitingRows.forEach(r=>awaitTbody.appendChild(r.__tr));
      if(awaitEmpty) awaitEmpty.textContent = awaitingRows.length ? "" : "No awaiting parts jobs.";
      document.querySelectorAll("#awaitTable thead th").forEach((th,i)=>{
        const map=["id","customer","vehicle","service","status","assigned","actions"]; th.setAttribute("data-key",map[i]||"");
      });
      makeSortable(document.getElementById("awaitTable"),()=>awaitingRows);
    }

    // Sorting for Active
    document.querySelectorAll("#jobsTable thead th").forEach((th,i)=>{
      const map=["id","customer","vehicle","service","status","assigned","actions"]; th.setAttribute("data-key",map[i]||"");
    });
    makeSortable(document.getElementById("jobsTable"),()=>activeRows);
    return;
  }

  // NON-STAFF (unchanged layout/behavior)
  tb.innerHTML="";
  // EDIT #7: Admin/Service Writer visibility filter
  const today = todayISO();
  const visibleRows = rows.filter(r => (
    r.status==="in_progress" ||
    r.status==="awaiting_parts" ||
    (r.status==="scheduled" && (r.a && r.a.preferred_date===today))
  ));

  if(!rows.length){ if(jobsEmpty) jobsEmpty.textContent="No jobs available."; return; }
  if(jobsEmpty) jobsEmpty.textContent="";

  const canClaimForMe=(r)=>(!r.assigned_to)&&(me.role!=="receptionist");
  const rowObjs=visibleRows.map(r=>{
    const tr=document.createElement("tr");
    const assignedUser=users.find(u=>u.id===r.assigned_to);
    let assignCell="";
    if(canAssign){
      const opts=['<option value="">Unassigned</option>'].concat(staffOptions.map(o=>`<option value="${o.id}" ${r.assigned_to===o.id?'selected':''}>${o.label}</option>`)).join("");
      assignCell=`<select class="assSel" data-job="${r.id}">${opts}</select>`;
    } else {
      assignCell=assignedUser?`${assignedUser.first||""} ${assignedUser.last||""}`.trim():"-";
    }
    const canClaim=canClaimForMe(r);
    const isMine=r.assigned_to===me.id;
    let actions=`<a class="btn" href="messages.html?appt=${r.a.id||""}">Message</a>`;
    if(canClaim)actions+=` <button class="btn" data-claim="${r.id}">Claim</button>`;
    if(isMine)actions+=` <button class="btn" data-unassign="${r.id}">Unassign</button>`;
    if(me.role==="admin")actions+=` <button class="btn danger" data-remove="${r.id}">Remove</button>`;
    tr.innerHTML=`<td>${r.id}</td><td>${(r.a.customer_first||"?")} ${(r.a.customer_last||"")}</td><td>${r.a.vehicle||""}</td><td>${r.a.service||""}</td><td>${badge(r.status)}</td><td>${assignCell}</td><td>${actions}</td>`;

    if(canAssign){
      const sel=tr.querySelector(".assSel");
      sel.addEventListener("change",()=>{
        const d=readLS(LS.data,{jobs:[]});
        const i=(d.jobs||[]).findIndex(j=>j.id===r.id);
        if(i>=0){ d.jobs[i].assigned_to=sel.value||null; writeLS(LS.data,d); }
      });
    }
    const claimBtn=tr.querySelector("[data-claim]");
    if(claimBtn){
      claimBtn.addEventListener("click",()=>{
        const d=readLS(LS.data,{jobs:[]});
        const i=(d.jobs||[]).findIndex(j=>j.id===r.id);
        if(i<0)return;
        if(d.jobs[i].assigned_to){ alert("Someone already claimed this job."); return; }
        d.jobs[i].assigned_to=me.id; writeLS(LS.data,d); location.reload();
      });
    }
    const unBtn=tr.querySelector("[data-unassign]");
    if(unBtn){
      unBtn.addEventListener("click",()=>{
        const d=readLS(LS.data,{jobs:[]});
        const i=(d.jobs||[]).findIndex(j=>j.id===r.id);
        if(i<0)return;
        d.jobs[i].assigned_to=null; writeLS(LS.data,d); location.reload();
      });
    }
    const rmBtn=tr.querySelector("[data-remove]");
    if(rmBtn){
      rmBtn.addEventListener("click",()=>{
        const d=readLS(LS.data,{jobs:[]});
        d.jobs=(d.jobs||[]).filter(x=>x.id!==r.id);
        writeLS(LS.data,d); location.reload();
      });
    }

    tb.appendChild(tr);
    return {__tr:tr,id:r.id,customer:`${r.a.customer_first||""} ${r.a.customer_last||""}`,vehicle:r.a.vehicle,service:r.a.service,status:r.status||"new"};
  });

  document.querySelectorAll("#jobsTable thead th").forEach((th,i)=>{
    const map=["id","customer","vehicle","service","status","assigned","actions"]; th.setAttribute("data-key",map[i]||"");
  });
  makeSortable(document.getElementById("jobsTable"),()=>rowObjs);
}
/* ====== /REVISED setupJobs() ====== */

/* ===== NEW: setupProfile() ===== */
function setupProfile(){
  const u=currentUser();
  if(!u) return;

  // Prefill
  const f=byId("pfFirst"), l=byId("pfLast"), e=byId("pfEmail"), r=byId("pfRole");
  if(f) f.value = u.first || "";
  if(l) l.value = u.last  || "";
  if(e) e.value = u.email || "";
  if(r) r.value = u.role  || "";

  // Buttons / modals
  const emailModal = byId("emailModal");
  const passModal  = byId("passModal");
  const emailBtn   = byId("changeEmailBtn");
  const passBtn    = byId("changePassBtn");
  const closeEmail = byId("closeEmail");
  const closePass  = byId("closePass");
  const saveEmail  = byId("saveEmail");
  const savePass   = byId("savePass");

  function show(el){ el && el.classList.remove("hidden"); }
  function hide(el){ el && el.classList.add("hidden"); }

  emailBtn && emailBtn.addEventListener("click", ()=>show(emailModal));
  passBtn  && passBtn.addEventListener("click",  ()=>show(passModal));
  closeEmail && closeEmail.addEventListener("click", ()=>hide(emailModal));
  closePass  && closePass.addEventListener("click",  ()=>hide(passModal));

  // Change Email flow
  saveEmail && saveEmail.addEventListener("click", ()=>{
    const newEmail = (byId("newEmail")||{}).value?.trim().toLowerCase();
    const curPass  = (byId("curPassForEmail")||{}).value || "";
    const note = byId("emailNotice");
    if(note) note.textContent = "";

    if(!newEmail || !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(newEmail)){
      if(note) note.textContent = "Enter a valid email address.";
      return;
    }
    const users=readLS(LS.users,[])||[];
    if(users.some(x=>x.email===newEmail)){
      if(note) note.textContent = "That email is already in use.";
      return;
    }
    // re-auth
    if((u.password||"")!==curPass){
      if(note) note.textContent = "Current password is incorrect.";
      return;
    }
    // update user
    const i=users.findIndex(x=>x.id===u.id);
    if(i>=0){
      users[i].email=newEmail;
      writeLS(LS.users,users);
      // keep session in sync
      writeLS(LS.session,{email:newEmail,at:Date.now()});
      if(byId("pfEmail")) byId("pfEmail").value=newEmail;
      if(note) note.textContent = "Email updated successfully.";
      setTimeout(()=>hide(emailModal), 600);
    }
  });

  // Change Password flow
  savePass && savePass.addEventListener("click", ()=>{
    const cur = (byId("curPass")||{}).value || "";
    const npw = (byId("newPass")||{}).value || "";
    const cfm = (byId("confPass")||{}).value || "";
    const note = byId("passNotice");
    if(note) note.textContent = "";

    if((u.password||"")!==cur){
      if(note) note.textContent = "Current password is incorrect.";
      return;
    }
    if(!npw || npw.length<6){
      if(note) note.textContent = "New password must be at least 6 characters.";
      return;
    }
    if(npw===cur){
      if(note) note.textContent = "New password must be different from current.";
      return;
    }
    if(npw!==cfm){
      if(note) note.textContent = "New password and confirm do not match.";
      return;
    }
    const users=readLS(LS.users,[])||[];
    const i=users.findIndex(x=>x.id===u.id);
    if(i>=0){
      users[i].password=npw;
      writeLS(LS.users,users);
      if(note) note.textContent = "Password updated successfully.";
      setTimeout(()=>hide(passModal), 600);
    }
  });
}

function setupMessages(){const store=readLS(LS.data,{threads:[],appointments:[]});if(!(readLS("xm_inquiry_seeded",false))){const hasInquiry=(store.threads||[]).some(t=>t.type==="inquiry");if(!hasInquiry){(store.threads=store.threads||[]).push({id:"t"+Date.now(),type:"inquiry",title:"New Inquiry · Evan Ramos",meta:{name:"Evan Ramos",phone:"(301) 555-0182",email:"evan.ramos@example.com",vehicle:"2014 BMW 335i",service:"Brake inspection",date:todayISO(),time:"10:00",notes:"Grinding noise on front left."},messages:[{from:"system",body:"New inquiry submitted from website.",created_at:new Date().toISOString()}]});writeLS("xm_inquiry_seeded",true);writeLS(LS.data,store);}}const data=readLS(LS.data,{threads:[],appointments:[]});const list=byId("threadList");const chat=byId("chatBox");const title=byId("threadTitle");const form=byId("sendForm");const inp=byId("msgInput");function renderList(){if(!list)return;list.innerHTML="";(data.threads||[]).slice().reverse().forEach(t=>{const li=document.createElement("li");li.style.padding="8px";li.style.borderBottom="1px solid var(--line)";li.tabIndex=0;const badge=t.type==="inquiry"?'<span class="badge open" style="margin-left:8px">New Inquiry</span>':"";const last=(t.messages||[])[(t.messages||[]).length-1]||{body:""};li.innerHTML=`<b>${t.title||("Appt "+(t.appointment_id||""))}</b> ${badge}<div class="notice">${last.body||""}</div>`;li.addEventListener("click",()=>select(t.id));list.appendChild(li);});}function renderMessages(t){return `<div style="margin-top:10px">${(t.messages||[]).map(m=>`<div style="margin:6px 0"><span class="badge ${m.from==='staff'?'scheduled':'open'}">${m.from}</span> ${m.body}</div>`).join("")}</div>`;}let cur=null;function select(id){const t=(data.threads||[]).find(x=>x.id===id);if(!t)return;title.textContent=t.title||("Appt "+(t.appointment_id||""));chat.innerHTML=renderMessages(t);chat.scrollTop=chat.scrollHeight;cur=t;}renderList();if(form)form.addEventListener("submit",(e)=>{e.preventDefault();const body=inp.value.trim();if(!body||!cur)return;cur.messages=cur.messages||[];cur.messages.push({from:"staff",body,created_at:new Date().toISOString()});const d=readLS(LS.data,{});const i=(d.threads||[]).findIndex(x=>x.id===cur.id);if(i>=0){d.threads[i]=cur;writeLS(LS.data,d);}inp.value="";select(cur.id);});}
function setupSettings(){
  const data = readLS(LS.data, { settings:{} });
  data.settings = data.settings || {};
  data.settings.services = data.settings.services || [];
  writeLS(LS.data, data);

  const svcList = byId("svcList"),
        nameI   = byId("svcName"),
        partsI  = byId("svcPrice"),
        laborI  = byId("svcLabor"),
        hoursI  = byId("svcHours"),
        addBtn  = byId("svcAdd"),
        manage  = byId("manageRates");

  function render(){
    if(!svcList) return;
    svcList.innerHTML = "";
    (data.settings.services||[]).forEach((s,idx)=>{
      const chip = document.createElement("div");
      chip.className = "chip";
      chip.style.margin = "6px 6px 0 0";
      chip.title = "Click to remove";
      chip.innerHTML = `${s.name} · Parts $${fmtMoney(s.parts_price||0)} · Labor $${fmtMoney(s.labor_rate||0)} × ${Number(s.hours||0)}h`;
      chip.addEventListener("click", ()=>{
        if(confirm("Remove this service?")){
          data.settings.services.splice(idx,1);
          writeLS(LS.data, data); render();
        }
      });
      svcList.appendChild(chip);
    });
  }
  render();

  addBtn && addBtn.addEventListener("click", ()=>{
    const name  = (nameI?.value||"").trim();
    const parts = Number(partsI?.value||0);
    const rate  = Number(laborI?.value||0);
    const hours = Number(hoursI?.value||0);
    if(!name){ alert("Enter a service name."); return; }
    (data.settings.services=data.settings.services||[]).push({ name, parts_price:parts, labor_rate:rate, hours });
    writeLS(LS.data, data);
    if(nameI) nameI.value=""; if(partsI) partsI.value=""; if(laborI) laborI.value=""; if(hoursI) hoursI.value="";
    render();
  });

  manage && manage.addEventListener("click", ()=> openRatePicker({}));
}


function setupInvoices(){
  const data=readLS(LS.data,{invoices:[],appointments:[]});
  const tb=document.querySelector("#invTable tbody");
  const empty=document.getElementById("invEmpty");
  const pbody=document.querySelector("#prevTable tbody");
  const pempty=document.getElementById("prevEmpty");

  const modal=document.getElementById("invModal");
  const openBtn=document.getElementById("newInvoice");
  const closeBtn=document.getElementById("closeInv");
  const addBtn=document.getElementById("addItem");
  const saveBtn=document.getElementById("saveInv");

  const itemsDiv=document.getElementById("items");
  const taxI=document.getElementById("invTax");
  const discI=document.getElementById("invDisc");
  const dueI=document.getElementById("invDue");
  const subEl=document.getElementById("subTotal");
  const grandEl=document.getElementById("grandTotal");
  const custI=document.getElementById("invCustomer");
  const apptI=document.getElementById("invAppt");

  // track edit state
  let invEditingId = null;

  function fmt(n){return Number(n||0).toFixed(2);}
  function total(inv){
    const sub=(inv.items||[]).reduce((s,x)=>s+(Number(x.qty)||0)*(Number(x.price)||0),0);
    const tax=sub*((Number(inv.tax_rate)||0)/100);
    const disc=sub*((Number(inv.discount)||0)/100);
    return {sub,total:sub+tax-disc};
  }
  function badge(st){
    const map={open:"open",paid:"done",new:"open",scheduled:"scheduled",in_progress:"progress",awaiting_parts:"parts",completed:"done"};
    const c=map[st]||"";
    return `<span class="badge ${c}">${st}</span>`;
  }

  function render(){
    const q=(document.getElementById("invSearch")?.value||"").toLowerCase().trim();
    const opens=(data.invoices||[]).filter(i=>(i.status||"open")!=="paid");
    tb.innerHTML="";
    const openRows=opens
      .filter(inv=>{
        const hay=`${inv.number||inv.id} ${inv.customer||""} ${inv.appointment_id||""}`.toLowerCase();
        return !q||hay.includes(q);
      })
      .map(inv=>{
        const t=total(inv);
        const tr=document.createElement("tr");
        tr.innerHTML=`
          <td><a href="invoice.html?id=${inv.number||inv.id}" class="btn">${inv.number||inv.id}</a></td>
          <td>${inv.customer||"-"}</td>
          <td>$${fmt(t.total)}</td>
          <td>${badge(inv.status||"open")}</td>
          <td>${inv.due||""}</td>
          <td>
            <button class="btn edit-inv">Edit</button>
            <button class="btn mark-paid">Mark Paid</button>
            <button class="btn danger" data-remove="${inv.id}">Remove</button>
          </td>`;

        tr.querySelector(".edit-inv").addEventListener("click",()=>editInvoice(inv.id));
        tr.querySelector(".mark-paid").addEventListener("click",()=>{
          inv.status="paid"; writeLS(LS.data,data); render();
        });
        tr.querySelector('[data-remove]').addEventListener('click',()=>{
          const idx=data.invoices.findIndex(x=>x.id===inv.id);
          if(idx>-1){ data.invoices.splice(idx,1); writeLS(LS.data,data); render(); }
        });

        tb.appendChild(tr);
        return {__tr:tr,num:(inv.number||inv.id),customer:(inv.customer||"-"),total:t.total,status:(inv.status||"open"),due:(inv.due||"")};
      });

    const pq=(document.getElementById("prevSearch")?.value||"").toLowerCase().trim();
    const paids=(data.invoices||[]).filter(i=>(i.status||"open")==="paid");
    pbody.innerHTML="";
    const paidRows=paids
      .filter(inv=>{
        const hay=`${inv.number||inv.id} ${inv.customer||""} ${inv.appointment_id||""}`.toLowerCase();
        return !pq||hay.includes(pq);
      })
      .map(inv=>{
        const t=total(inv);
        const tr=document.createElement("tr");
        tr.innerHTML=`
          <td><a href="invoice.html?id=${inv.number||inv.id}" class="btn">${inv.number||inv.id}</a></td>
          <td>${inv.customer||"-"}</td>
          <td>$${fmt(t.total)}</td>
          <td>${badge("paid")}</td>
          <td>${inv.due||""}</td>
          <td>
            <button class="btn edit-inv">Edit</button>
            <button class="btn danger" data-remove="${inv.id}">Remove</button>
          </td>`;

        tr.querySelector(".edit-inv").addEventListener("click",()=>editInvoice(inv.id));
        tr.querySelector('[data-remove]').addEventListener('click',()=>{
          const idx=data.invoices.findIndex(x=>x.id===inv.id);
          if(idx>-1){ data.invoices.splice(idx,1); writeLS(LS.data,data); render(); }
        });

        pbody.appendChild(tr);
        return {__tr:tr,num:(inv.number||inv.id),customer:(inv.customer||"-"),total:t.total,status:"paid",due:(inv.due||"")};
      });

    document.querySelectorAll("#invTable thead th").forEach((th,i)=>{
      const map=["num","customer","total","status","due","actions"];
      th.setAttribute("data-key",map[i]||"");
    });
    makeSortable(document.getElementById("invTable"),()=>openRows);

    document.querySelectorAll("#prevTable thead th").forEach((th,i)=>{
      const map=["num","customer","total","status","due","actions"];
      th.setAttribute("data-key",map[i]||"");
    });
    makeSortable(document.getElementById("prevTable"),()=>paidRows);

    empty&&(empty.textContent=openRows.length?"":"No open/unpaid invoices.");
    pempty&&(pempty.textContent=paidRows.length?"":"No paid invoices yet.");
  }

  function openModal(newMode=true){
    modal?.classList.remove("hidden");
    if(newMode){
      invEditingId = null;
      itemsDiv&&(itemsDiv.innerHTML="");
      if(taxI)taxI.value=6;
      if(discI)discI.value=0;
      if(dueI)dueI.value=todayISO();
      if(custI)custI.value="";
      if(apptI)apptI.value="";
      addItem();
      calc();
      const title=document.getElementById("invTitle"); if(title) title.textContent="New Invoice";
    }
  }
  function closeModal(){ modal?.classList.add("hidden"); }

  function addItem(){
    const wrap=document.createElement("div");
    wrap.className="grid cols-3";
    wrap.style.marginTop="6px";
    wrap.innerHTML=`
      <input placeholder="Name" class="itm-name">
      <input type="number" placeholder="Qty" value="1" class="itm-qty">
      <input type="number" placeholder="Price" value="0" class="itm-price">`;
    itemsDiv.appendChild(wrap);
  }
  function collect(){
    return Array.from(itemsDiv.querySelectorAll(".grid")).map(r=>({
      name:r.querySelector(".itm-name").value||"Item",
      qty:Number(r.querySelector(".itm-qty").value||0),
      price:Number(r.querySelector(".itm-price").value||0)
    }));
  }
  function calc(){
    const items=collect();
    const sub=items.reduce((s,x)=>s+(x.qty||0)*(x.price||0),0);
    const tax=sub*((Number(taxI?.value)||0)/100);
    const disc=sub*((Number(discI?.value)||0)/100);
    subEl&&(subEl.textContent=Number(sub).toFixed(2));
    grandEl&&(grandEl.textContent=Number(sub+tax-disc).toFixed(2));
  }

  function editInvoice(id){
    const inv=(data.invoices||[]).find(i=>i.id===id);
    if(!inv) return;
    invEditingId = id;
    // Prefill
    if(custI) custI.value = inv.customer || "";
    if(apptI) apptI.value = inv.appointment_id || "";
    if(taxI) taxI.value = Number(inv.tax_rate||0);
    if(discI) discI.value = Number(inv.discount||0);
    if(dueI) dueI.value = inv.due || todayISO();
    if(itemsDiv){
      itemsDiv.innerHTML="";
      (inv.items||[]).forEach(it=>{
        addItem();
        const last = itemsDiv.querySelectorAll(".grid").item(itemsDiv.querySelectorAll(".grid").length-1);
        last.querySelector(".itm-name").value = it.name || "Item";
        last.querySelector(".itm-qty").value = Number(it.qty||0);
        last.querySelector(".itm-price").value = Number(it.price||0);
      });
    }
    calc();
    const title=document.getElementById("invTitle"); if(title) title.textContent="Edit Invoice";
    openModal(false);
  }

  openBtn&&openBtn.addEventListener("click",()=>openModal(true));
  closeBtn&&closeBtn.addEventListener("click",closeModal);
  addBtn&&addBtn.addEventListener("click",()=>{ addItem(); calc(); });
  itemsDiv&&itemsDiv.addEventListener("input",calc);
  taxI&&taxI.addEventListener("input",calc);
  discI&&discI.addEventListener("input",calc);

  function validateBeforeSave(items){
    // must have at least one item with qty>0
    const validItem = items.some(it => (Number(it.qty)||0) > 0);
    if(!validItem){ alert("Invoice must have at least one item with quantity > 0."); return false; }
    return true;
  }

  const saveBtnHandler=()=>{
    const items=collect();
    if(!validateBeforeSave(items)) return;

    if(invEditingId){
      // update existing
      const idx=(data.invoices||[]).findIndex(i=>i.id===invEditingId);
      if(idx>=0){
        const inv=data.invoices[idx];
        inv.customer = custI?(custI.value||"Walk-in"):"Walk-in";
        inv.appointment_id = apptI?(apptI.value||null):null;
        inv.tax_rate = Number(taxI?.value||0)||0;
        inv.discount = Number(discI?.value||0)||0;
        inv.due = dueI?(dueI.value||todayISO()):todayISO();
        inv.items = items;
        // number & status remain as-is (edited elsewhere)
        writeLS(LS.data,data);
      }
      closeModal();
      render();
      invEditingId=null;
      return;
    }

    // create new
    const next=(data.invoices||[]).reduce((mx,i)=>Math.max(mx,Number(i.number||0)||0),1000)+1;
    const inv={
      id:"inv"+Date.now(),
      number:String(next),
      customer:custI?(custI.value||"Walk-in"):"Walk-in",
      appointment_id:apptI?(apptI.value||null):null,
      status:"open",
      due:dueI?(dueI.value||todayISO()):todayISO(),
      tax_rate:Number(taxI?.value||0)||0,
      discount:Number(discI?.value||0)||0,
      items
    };
    data.invoices.push(inv);
    writeLS(LS.data,data);
    closeModal();
    render();
  };

  // Rebind save each render
  if(saveBtn){
    const clone = saveBtn.cloneNode(true);
    saveBtn.parentNode.replaceChild(clone, saveBtn);
    clone.id = "saveInv"; // keep same id
    clone.addEventListener("click", saveBtnHandler);
  }

  const apptQ=new URLSearchParams(location.search).get("appt");
  if(apptQ){
    let inv=(data.invoices||[]).find(i=>i.appointment_id===apptQ);
    if(!inv){
      const appt=(data.appointments||[]).find(a=>a.id===apptQ);
      const next=(data.invoices||[]).reduce((mx,i)=>Math.max(mx,Number(i.number||0)||0),1000)+1;
      inv={id:"inv"+Date.now(),number:String(next),customer:appt?`${appt.customer_first||""} ${appt.customer_last||""}`.trim()||"Walk-in":"Walk-in",appointment_id:apptQ,status:"open",due:todayISO(),tax_rate:6,discount:0,items:[{name:"Item",qty:1,price:0}]};
      data.invoices.push(inv); writeLS(LS.data,data);
    }
    location.replace(`invoice.html?id=${inv.number||inv.id}`);
    return;
  }

  document.getElementById("invSearch")?.addEventListener("input",render);
  document.getElementById("prevSearch")?.addEventListener("input",render);
  render();
}

document.addEventListener("click",(e)=>{if(e.target&&e.target.id==="pfSave"){const u=currentUser();if(!u)return;const users=readLS(LS.users,[]);const i=users.findIndex(x=>x.id===u.id);if(i>=0){users[i].first=(byId("pfFirst")||{}).value||users[i].first;users[i].last=(byId("pfLast")||{}).value||users[i].last;writeLS(LS.users,users);const note=byId("pfSaved");if(note)note.textContent="Saved.";}}});

/* ===== Existing non-invasive Job Claim enhancer (kept 1:1) ===== */
(async function(){await (async function(){if(readLS(LS.seeded,false))return;writeLS(LS.users,[{id:"u1",first:"Owner",last:"User",email:"owner@gr.test",password:"admin123",role:"admin",shop_id:"s1"}]);writeLS(LS.shops,[{id:"s1",name:"GR Automotive",type:"Mechanic",join_code:"ABCD12",staff_limit:3}]);writeLS(LS.data,{settings:{shop:{name:"GR Automotive",phone:"301-937-0026",email:"contact@grauto.test"}},appointments:[{id:"a1",created_at:new Date().toISOString(),customer_first:"Evan",customer_last:"Ramos",email:"evan.ramos@example.com",phone:"(301) 555-0182",vehicle:"2014 BMW 335i",service:"Brake inspection",preferred_date:todayISO(),preferred_time:"10:00",status:"scheduled",source:"inquiry",shop_id:"s1"}],jobs:[{id:"J1001",appointment_id:"a1",status:"scheduled",shop_id:"s1"}],threads:[{id:"t1",type:"inquiry",title:"New Inquiry · Evan Ramos",meta:{name:"Evan Ramos",phone:"(301) 555-0182",email:"evan.ramos@example.com",vehicle:"2014 BMW 335i",service:"Brake inspection",date:todayISO(),time:"10:00",notes:"Grinding noise on front left."},messages:[{from:"system",body:"New inquiry submitted from website.",created_at:new Date().toISOString()}],shop_id:"s1"}],invoices:[{id:"inv1001",number:"1001",customer:"Evan Ramos",appointment_id:"a1",status:"open",due:todayISO(),tax_rate:6,discount:0,items:[{name:"Labor",qty:1,price:120},{name:"Parts",qty:1,price:45}],shop_id:"s1"}]});writeLS(LS.seeded,true);})();setThemeFromUser();if(byId("themeToggle"))byId("themeToggle").addEventListener("click",toggleTheme);if(byId("logoutBtn"))byId("logoutBtn").addEventListener("click",logout);const p=pageName();if(p==="index"||p==="")setupLogin();else{requireAuth();if(p==="dashboard")setupDashboard();if(p==="appointments")setupAppointments();if(p==="jobs")setupJobs();if(p==="messages")setupMessages();if(p==="invoices")setupInvoices();if(p==="profile")setupProfile();}
/* ===== EDIT: Job Claim flow (non-invasive, additive) ===== */
// Tiny helpers (reuse your LS + data shapes)
function __data(){ return readLS(LS.data,{appointments:[],jobs:[],threads:[],invoices:[]}); }
function __save(d){ writeLS(LS.data,d); }
function __jobForAppt(apptId){
  const d=__data();
  let j=(d.jobs||[]).find(x=>x.appointment_id===apptId);
  if(!j){ j={id:"J"+Date.now(), appointment_id:apptId, status:"unassigned"}; d.jobs=d.jobs||[]; d.jobs.push(j); __save(d); }
  return j;
}
function __assign(jobId, userId){
  const d=__data(); const i=(d.jobs||[]).findIndex(x=>x.id===jobId);
  if(i<0) return false;
  if(d.jobs[i].assigned_to && d.jobs[i].assigned_to!==userId) return false;
  d.jobs[i].assigned_to=userId;
  if(d.jobs[i].status!=='completed') d.jobs[i].status='in_progress';
  __save(d); return true;
}
function __unassign(jobId){
  const d=__data(); const i=(d.jobs||[]).findIndex(x=>x.id===jobId);
  if(i<0) return;
  d.jobs[i].assigned_to=null;
  if(d.jobs[i].status!=='completed') d.jobs[i].status='unassigned';
  __save(d);
}
function __delJob(jobId){
  const d=__data(); d.jobs=(d.jobs||[]).filter(x=>x.id!==jobId); __save(d);
}
function __setStatus(jobId, status){
  const d=__data(); const i=(d.jobs||[]).findIndex(x=>x.id===jobId);
  if(i<0) return; d.jobs[i].status=status; __save(d);
}

// Enhance rendered tables without touching your templates
function __claimEnhance(){
  try{
    if (typeof currentUser !== "function") return;
    const me = currentUser();
    if(!me) return;

    // DASHBOARD: Day table (find appt id from action links)
    const dayTbody = document.querySelector("#dayTable tbody");
    if(dayTbody){
      dayTbody.querySelectorAll("tr").forEach(tr=>{
        const actions = tr.querySelector("td:last-child");
        if(!actions || actions.querySelector(".cx-claim")) return;
        const link = actions.querySelector('a[href*="messages.html?appt="], a[href*="invoices.html?appt="]');
        if(!link) return;
        let apptId = null;
        try { apptId = new URL(link.getAttribute("href"), location.href).searchParams.get("appt"); } catch(_e){}
        if(!apptId) return;
        const d=__data(); const j=(d.jobs||[]).find(x=>x.appointment_id===apptId);
        const claimable = (!j || !j.assigned_to);
        if(me.role==='staff' && claimable){
          const btn=document.createElement("button");
          btn.className="btn cx-claim";
          btn.textContent="Claim";
          btn.addEventListener("click", ()=>{
            const jj=__jobForAppt(apptId);
            if(jj.assigned_to && jj.assigned_to!==me.id){ alert("This job is already assigned."); return; }
            __assign(jj.id, me.id);
            location.reload();
          });
          actions.appendChild(btn);
        }
      });
    }

    // APPOINTMENTS: add Claim before Remove
    const apptTable = document.getElementById("apptTable") || document.querySelector('[data-app-table="appointments"]');
    const apptBody = apptTable && apptTable.querySelector("tbody");
    if(apptBody){
      apptBody.querySelectorAll("tr").forEach(tr=>{
        const actions = tr.querySelector("td:last-child");
        if(!actions || actions.querySelector(".cx-claim-appt")) return;
        const link = actions.querySelector('a[href*="messages.html?appt="], a[href*="invoices.html?appt="]');
        if(!link) return;
        let apptId = null;
        try { apptId = new URL(link.getAttribute("href"), location.href).searchParams.get("appt"); } catch(_e){}
        if(!apptId) return;
        const d=__data(); const j=(d.jobs||[]).find(x=>x.appointment_id===apptId);
        const claimable = (!j || !j.assigned_to);
        if(me.role==='staff' && claimable){
          const btn=document.createElement("button");
          btn.className="btn cx-claim-appt";
          btn.textContent="Claim";
          btn.addEventListener("click", ()=>{
            const jj=__jobForAppt(apptId);
            if(jj.assigned_to && jj.assigned_to!==me.id){ alert("This job is already assigned."); return; }
            __assign(jj.id, me.id);
            location.reload();
          });
          const removeBtn = actions.querySelector("button.btn.danger");
          actions.insertBefore(btn, removeBtn || null);
        }
      });
    }

    // JOBS: hide Claim; for staff on own jobs provide limited controls
    const jobsTable = document.getElementById("jobsTable");
    if(jobsTable){
      // remove any claim buttons
      jobsTable.querySelectorAll("[data-claim]").forEach(el=> el.remove());

      if(me.role==='staff'){
        jobsTable.querySelectorAll("tr").forEach(tr=>{
          const actions = tr.querySelector("td:last-child");
          if(!actions || actions.querySelector(".cx-status")) return;
          const unBtn = actions.querySelector("[data-unassign]");
          const jobId = (unBtn && unBtn.getAttribute("data-unassign")) || null;
          // hide unassign if present; we'll replace with status+remove
          if(unBtn) unBtn.remove();
          if(!jobId) return; // only on own jobs
          const sel = document.createElement("select");
          sel.className="cx-status";
          sel.setAttribute("data-job", jobId);
          ["in_progress","awaiting_parts","completed"].forEach(st=>{
            const op=document.createElement("option"); op.value=st; op.textContent=st; sel.appendChild(op);
          });
          sel.addEventListener("change", ()=>{ __setStatus(jobId, sel.value); location.reload(); });

          const rm=document.createElement("button");
          rm.className="btn danger cx-remove-job";
          rm.textContent="Remove";
          rm.addEventListener("click", ()=>{
            const ok = confirm("Remove this job? Press OK to DELETE, Cancel to UNASSIGN.");
            if(ok){ __delJob(jobId); } else { __unassign(jobId); }
            location.reload();
          });
          actions.appendChild(sel);
          actions.appendChild(rm);
        });
      }
    }
  }catch(e){ /* safe no-op */ }
}
// Run after the page renders (and again when user interacts) without touching existing init
document.addEventListener("DOMContentLoaded", ()=> { setTimeout(__claimEnhance, 0); });
document.addEventListener("click", ()=> { setTimeout(__claimEnhance, 0); });
/* ===== /EDIT ===== */
})();
