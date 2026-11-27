/* ===== CONFIGURATION : collez vos valeurs ici ===== */
const SUPABASE_URL = 'https://rzopyxmyazzvokpkaabl.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_MGFI1UB-daHCevroNB60mg_wz1UMbFT';
const VAPID_PUBLIC_KEY = 'BNiN0c-DMxoS4O9_vGLZ5cuyTqDTvbo0CXvvLHfXU8o2wEk0Rs56_-SHIqGb3zXBMcImpJDvT7Koi5YbFWoGTNI';
/* ================================================== */
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const CATS = ['Céréales & Féculents','Huiles & Condiments','Produits laitiers','Conserves','Produits frais','Épicerie sèche'];
const UNITS = ['sac','carton','kg','litre','bouteille','paquet','unité'];
const TYPES = {entree:'Entrée livraison',vente:'Vente',perte:'Perte / Péremption',inventaire:'Inventaire'};
let me=null, products=[], moves=[], cat='Tous', q='', view='stock', flt='', loginTab='owner', deferred=null, timer;
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=n=>new Intl.NumberFormat('fr-FR').format(n);
const days=d=>d?Math.ceil((new Date(d)-new Date().setHours(0,0,0,0))/864e5):null;
const isOwner=()=>me?.role==='owner';
const logo='<img src="./logo.png" class="h-10 w-10 rounded-lg bg-white object-contain" alt="Charifat">';

async function boot(){
 if('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js');
 window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferred=e;if(me)render()});
 const {data:{session}}=await sb.auth.getSession();
 if(session) await loadProfile(); 
 me ? start() : loginView();
}
async function loadProfile(){
 const {data:{user}}=await sb.auth.getUser(); if(!user) return;
 const {data}=await sb.from('app_users').select('*').eq('user_id',user.id).maybeSingle(); me=data;
}
function loginView(err=''){
 $('#app').innerHTML=`<div class="p-6 pt-12 text-center">
 <img src="./logo.png" class="h-28 mx-auto" alt="Charifat Boutique">
 <h1 class="text-2xl font-bold mt-3" style="color:var(--o)">CHARIFAT BOUTIQUE</h1>
 <div class="flex mt-6"><button class="tab ${loginTab=='owner'?'on':''}" onclick="loginTab='owner';loginView()">Propriétaire</button>
 <button class="tab ${loginTab=='manager'?'on':''}" onclick="loginTab='manager';loginView()">Connexion Gérant</button></div>
 <div class="card mt-4 space-y-3 text-left">
 ${loginTab=='owner'?`<input id="l1" type="email" placeholder="E-mail" class="inp"><input id="l2" type="password" placeholder="Mot de passe" class="inp">`
 :`<input id="l1" placeholder="Prénom / nom (ex: Moussa)" class="inp"><input id="l2" type="password" placeholder="Code Propriétaire" class="inp">`}
 <p class="text-red-600 text-sm">${esc(err)}</p>
 <button class="btn w-full" onclick="login()">Se connecter</button></div></div>`;
}
async function login(){
 const a=$('#l1').value.trim(), b=$('#l2').value;
 if(loginTab=='owner'){
  const {error}=await sb.auth.signInWithPassword({email:a,password:b}); if(error) return loginView('Identifiants incorrects');
  const r=await sb.rpc('claim_owner'); if(r.error) return loginView(r.error.message);
 } else {
  const {error}=await sb.auth.signInAnonymously(); if(error) return loginView(error.message);
  const {data}=await sb.rpc('manager_login',{p_name:a,p_code:b});
  if(!data){await sb.auth.signOut();return loginView('Nom ou code incorrect');}
 }
 await loadProfile(); start();
}
async function logout(){await sb.auth.signOut();me=null;loginView()}

async function start(){
 await load(); render();
 const ch=()=>{clearTimeout(timer);timer=setTimeout(async()=>{await load();render()},300)};
 sb.channel('live').on('postgres_changes',{event:'*',schema:'public',table:'products'},ch)
  .on('postgres_changes',{event:'*',schema:'public',table:'stock_movements'},ch).subscribe();
}
async function load(){
 const [p,m]=await Promise.all([sb.from('products').select('*').order('name'),
  sb.from('stock_movements').select('*').order('created_at',{ascending:false}).limit(1000)]);
 products=p.data||[]; moves=m.data||[];
}
function render(){
 const tabs=[['stock','📦 Stock'],['graph','📊 Graphiques'],['hist','🕘 Historique'],['set','⚙️ Réglages']];
 $('#app').innerHTML=`<header class="sticky top-0 z-10 flex items-center gap-3 p-3 text-white" style="background:var(--o)">${logo}
 <div class="flex-1"><b>CHARIFAT BOUTIQUE</b><div class="text-xs opacity-90">${esc(me.name)} · ${isOwner()?'Propriétaire':'Gérant'}</div></div>
 <button onclick="logout()" class="text-sm underline">Quitter</button></header>
 <nav class="flex bg-white shadow-sm">${tabs.map(t=>`<button class="tab ${view==t[0]?'on':''}" onclick="view='${t[0]}';render()">${t[1]}</button>`).join('')}</nav>
 <main class="p-3 pb-24">${view=='stock'?stockView():view=='hist'?histView():view=='graph'?graphView():setView()}</main>`;
 if(view=='stock') renderList();
 if(view=='graph') drawCharts();
}
function stockView(){
 const rup=products.filter(p=>p.quantity<=0).length;
 const bas=products.filter(p=>p.quantity>0&&p.quantity<=p.alert_threshold).length;
 const ring=f=>flt==f?'outline:3px solid #1B5E20':'';
 const val=products.reduce((s,p)=>s+p.quantity*p.price,0);
 return `<div class="grid grid-cols-2 gap-2">
 <div class="card"><div class="text-xs text-gray-500">Références</div><b class="text-2xl">${products.length}</b></div>
 <div class="card cursor-pointer" style="${ring('rupture')}" onclick="flt=flt=='rupture'?'':'rupture';render()"><div class="text-xs text-gray-500">🔴 Ruptures</div><b class="text-2xl text-red-600">${rup}</b></div>
 <div class="card cursor-pointer" style="${ring('seuil')}" onclick="flt=flt=='seuil'?'':'seuil';render()"><div class="text-xs text-gray-500">🟠 Bas de seuil</div><b class="text-2xl text-orange-500">${bas}</b></div>
 ${isOwner()?`<div class="card"><div class="text-xs text-gray-500">Valeur du stock</div><b class="text-xl" style="color:var(--g)">${fmt(val)}</b></div>`:''}</div>
 <input class="inp mt-3" placeholder="🔍 Rechercher un produit" value="${esc(q)}" oninput="q=this.value;renderList()">
 <div class="flex gap-2 overflow-x-auto py-3">${['Tous',...CATS].map(c=>`<button class="chip ${cat==c?'on':''}" onclick="cat='${c.replace(/'/g,"\\'")}';render()">${c}</button>`).join('')}</div>
 ${isOwner()?`<button class="btn w-full mb-3" onclick="productModal()">+ Nouveau produit</button>`:''}<div id="list" class="space-y-2"></div>`;
}
function renderList(){
 const l=products.filter(p=>(cat=='Tous'||p.category==cat)&&p.name.toLowerCase().includes(q.toLowerCase())&&(flt=='rupture'?p.quantity<=0:flt=='seuil'?p.quantity>0&&p.quantity<=p.alert_threshold:true));
 $('#list').innerHTML=l.map(p=>{const d=days(p.expiry_date),low=p.quantity<=p.alert_threshold;
 return `<div class="card flex items-center gap-2 ${low?'border-l-4 border-red-500':''}">
 <div class="flex-1 min-w-0"><b>${esc(p.name)}</b><div class="text-xs text-gray-500">${esc(p.category)}</div>
 <div class="text-sm"><b class="${low?'text-red-600':''}">${fmt(p.quantity)}</b> ${esc(p.unit)} ${p.quantity<=0?'<span class="text-red-600">· RUPTURE</span>':low?'<span class="text-orange-600">· bas de seuil</span>':''}
 ${d!==null&&d<15?`<span class="text-orange-600"> · DLC ${d<0?'dépassée':d+' j'}</span>`:''}</div></div>
 <button class="btn2 text-xl" onclick="quick('${p.id}','vente')">−</button>
 <button class="btn text-xl" onclick="quick('${p.id}','entree')">+</button>
 <button class="btn2" onclick="adjustModal('${p.id}')">⋯</button>
 <button class="btn2" onclick="productModal('${p.id}')">✎</button></div>`}).join('')||'<p class="text-center text-gray-500 py-8">Aucun produit</p>';
}
function histView(){
 return `<div class="space-y-2">${moves.slice(0,200).map(m=>`<div class="card text-sm"><div class="flex justify-between"><b>${esc(m.product_name)}</b>
 <b class="${m.qty_change<0?'text-red-600':'text-green-700'}">${m.qty_change>0?'+':''}${fmt(m.qty_change)}</b></div>
 <div>${TYPES[m.type]} · ${fmt(m.stock_before)} → ${fmt(m.stock_after)}</div>${m.note?`<div class="text-gray-500">${esc(m.note)}</div>`:''}
 <div class="text-xs text-gray-400">${esc(m.user_name)} (${m.user_role=='owner'?'propriétaire':'gérant'}) · ${new Date(m.created_at).toLocaleString('fr-FR')}</div>
 ${isOwner()?`<button class="text-xs text-red-600" onclick="delMove('${m.id}')">Supprimer</button>`:''}</div>`).join('')||'<p class="text-center text-gray-500">Aucun mouvement</p>'}</div>`;
}
let charts=[];
function graphView(){
 const c=(id,t,h=220)=>`<div class="card"><b>${t}</b><div class="mt-2"><canvas id="${id}" height="${h}"></canvas></div></div>`;
 return `<div class="space-y-3">${c('c1','Références par catégorie')}${c('c2','Activité des 14 derniers jours (nombre de mouvements)')}
 ${c('c3','Top 5 des produits les plus vendus')}${c('c4','Stock le plus bas vs seuil d\'alerte',260)}
 ${isOwner()?c('c5','Valeur du stock par catégorie'):''}</div>`;
}
function drawCharts(){
 if(typeof Chart==='undefined') return;
 charts.forEach(x=>x.destroy()); charts=[];
 const O='#F57C00',G='#1B5E20',R='#D32F2F',pal=['#F57C00','#1B5E20','#FBC02D','#0288D1','#8E24AA','#6D4C41'];
 const mk=(id,cfg)=>{const e=$('#'+id);if(e)charts.push(new Chart(e,cfg))};
 mk('c1',{type:'doughnut',data:{labels:CATS,datasets:[{data:CATS.map(c=>products.filter(p=>p.category==c).length),backgroundColor:pal}]},options:{plugins:{legend:{position:'bottom'}}}});
 const key=d=>new Date(d).toLocaleDateString('sv-SE');
 const dd=[...Array(14)].map((_,i)=>{const d=new Date();d.setDate(d.getDate()-13+i);return key(d)});
 const cnt=t=>dd.map(d=>moves.filter(m=>m.type==t&&key(m.created_at)==d).length);
 mk('c2',{type:'bar',data:{labels:dd.map(d=>d.slice(8)+'/'+d.slice(5,7)),datasets:[{label:'Entrées',data:cnt('entree'),backgroundColor:G},{label:'Ventes',data:cnt('vente'),backgroundColor:O},{label:'Pertes',data:cnt('perte'),backgroundColor:R}]},
  options:{scales:{x:{stacked:true},y:{stacked:true,beginAtZero:true,ticks:{precision:0}}},plugins:{legend:{position:'bottom'}}}});
 const sold={};moves.filter(m=>m.type=='vente').forEach(m=>sold[m.product_name]=(sold[m.product_name]||0)-m.qty_change);
 const top=Object.entries(sold).sort((a,b)=>b[1]-a[1]).slice(0,5);
 mk('c3',{type:'bar',data:{labels:top.map(t=>t[0]),datasets:[{label:'Quantité vendue',data:top.map(t=>t[1]),backgroundColor:O}]},options:{indexAxis:'y',plugins:{legend:{display:false}}}});
 const low=[...products].sort((a,b)=>(a.quantity-a.alert_threshold)-(b.quantity-b.alert_threshold)).slice(0,8);
 mk('c4',{type:'bar',data:{labels:low.map(p=>p.name),datasets:[{label:'Stock',data:low.map(p=>p.quantity),backgroundColor:low.map(p=>p.quantity<=p.alert_threshold?R:G)},{label:'Seuil',data:low.map(p=>p.alert_threshold),backgroundColor:'#BDBDBD'}]},options:{indexAxis:'y',plugins:{legend:{position:'bottom'}}}});
 mk('c5',{type:'bar',data:{labels:CATS,datasets:[{label:'Valeur',data:CATS.map(c=>products.filter(p=>p.category==c).reduce((s,p)=>s+p.quantity*p.price,0)),backgroundColor:pal}]},options:{plugins:{legend:{display:false}}}});
}
function setView(){
 return `<div class="space-y-3"><div class="card"><b>🔔 Notifications</b><p class="text-sm text-gray-500 my-2">Alertes même téléphone verrouillé.</p>
 <button class="btn w-full" onclick="enablePush()">Activer les notifications</button></div>
 <div class="card"><b>📲 Installer l'application</b><button class="btn w-full mt-2" onclick="installApp()">Installer l'application</button></div>
 ${isOwner()?`<div class="card"><b>🔑 Code Propriétaire (connexion gérants)</b><div class="flex gap-2 mt-2"><input id="code" class="inp" placeholder="Chargement…"><button class="btn" onclick="saveCode()">OK</button></div></div>`:''}</div>`;
}
async function fillCode(){const {data}=await sb.from('shop_settings').select('owner_code').eq('id',1).single();if($('#code'))$('#code').value=data?.owner_code||''}
const _r=render; render=function(){_r();if(view=='set'&&isOwner())fillCode()};
async function saveCode(){const v=$('#code').value.trim();if(v.length<4)return alert('Minimum 4 caractères');
 const {error}=await sb.from('shop_settings').update({owner_code:v}).eq('id',1);alert(error?error.message:'Code mis à jour ✅')}

function modal(h){$('#modal').innerHTML=`<div class="card w-full max-w-md space-y-3 max-h-[90vh] overflow-auto">${h}</div>`;$('#modal').classList.remove('hidden')}
function closeModal(){$('#modal').classList.add('hidden')}
async function move(id,type,v,note){const {error}=await sb.rpc('apply_movement',{p_product:id,p_type:type,p_value:v,p_note:note||null});
 if(error) return alert(error.message); await load(); render()}
function quick(id,type){move(id,type,1,'Ajustement rapide')}
function adjustModal(id){const p=products.find(x=>x.id==id);
 modal(`<b>${esc(p.name)}</b> <span class="text-sm text-gray-500">(stock : ${p.quantity} ${p.unit})</span>
 <select id="t" class="inp">${Object.entries(TYPES).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select>
 <input id="v" type="number" min="0" step="any" class="inp" placeholder="Quantité (${p.unit})"><input id="n" class="inp" placeholder="Note (facultatif)">
 <div class="flex gap-2"><button class="btn2 flex-1" onclick="closeModal()">Annuler</button>
 <button class="btn flex-1" onclick="move('${id}',$('#t').value,parseFloat($('#v').value),$('#n').value).then(closeModal)">Valider</button></div>`)}
function productModal(id){const p=products.find(x=>x.id==id)||{name:'',category:CATS[5],unit:'unité',quantity:0,alert_threshold:5,price:0,expiry_date:''};
 const o=(a,s)=>a.map(x=>`<option ${x==s?'selected':''}>${x}</option>`).join('');
 modal(`<b>${id?'Modifier':'Nouveau'} produit</b><input id="pn" class="inp" placeholder="Nom" value="${esc(p.name)}">
 <select id="pc" class="inp">${o(CATS,p.category)}</select><select id="pu" class="inp">${o(UNITS,p.unit)}</select>
 ${id?'':`<input id="pq" type="number" class="inp" placeholder="Quantité initiale" value="${p.quantity}">`}
 ${isOwner()?`<input id="pt" type="number" class="inp" placeholder="Seuil d'alerte" value="${p.alert_threshold}">`:''}
 <input id="pp" type="number" min="0" step="any" class="inp" placeholder="Prix unitaire" value="${p.price}">
 ${isOwner()?`<label class="text-xs">Date de péremption</label><input id="pe" type="date" class="inp" value="${p.expiry_date||''}">`:''}
 <div class="flex gap-2"><button class="btn2 flex-1" onclick="closeModal()">Annuler</button>
 <button class="btn flex-1" onclick="saveProduct('${id||''}')">Enregistrer</button></div>
 ${id&&isOwner()?`<button class="text-red-600 text-sm w-full" onclick="delProduct('${id}')">Supprimer ce produit</button>`:''}`)}
async function saveProduct(id){
 const r={name:$('#pn').value.trim(),category:$('#pc').value,unit:$('#pu').value,price:+$('#pp').value||0};
 if(!r.name) return alert('Nom requis');
 if(!isOwner()){const {error}=await sb.rpc('update_product_info',{p_id:id,p_name:r.name,p_category:r.category,p_unit:r.unit,p_price:r.price});
  if(error) return alert(error.message); closeModal(); await load(); return render();}
 r.alert_threshold=+$('#pt').value||0; r.expiry_date=$('#pe').value||null; if(!id) r.quantity=+$('#pq').value||0;
 const {error}=id?await sb.from('products').update(r).eq('id',id):await sb.from('products').insert(r);
 if(error) return alert(error.message); closeModal(); await load(); render()}
async function delProduct(id){if(!confirm('Supprimer définitivement ?'))return;await sb.from('products').delete().eq('id',id);closeModal();await load();render()}
async function delMove(id){if(!confirm('Supprimer cette ligne ?'))return;await sb.from('stock_movements').delete().eq('id',id);await load();render()}

/* ===== PWA : installation & Push ===== */
const isIOS=/iphone|ipad|ipod/i.test(navigator.userAgent);
const standalone=()=>window.navigator.standalone||matchMedia('(display-mode: standalone)').matches;
async function installApp(){
 if(deferred){deferred.prompt();deferred=null;return}
 if(standalone()) return alert('Application déjà installée ✅');
 if(isIOS) return modal(`<b>Installer sur iPhone</b><p>1️⃣ Dans Safari, touchez <b>Partager</b> (carré avec flèche ⬆️).</p>
 <p>2️⃣ Choisissez <b>« Sur l'écran d'accueil »</b> puis <b>Ajouter</b>.</p><button class="btn w-full" onclick="closeModal()">Compris</button>`);
 alert("Utilisez le menu du navigateur (⋮) > Installer l'application.");
}
const b64=s=>{const p='='.repeat((4-s.length%4)%4),r=atob((s+p).replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from([...r].map(c=>c.charCodeAt(0)))};
async function enablePush(){
 if(isIOS&&!window.navigator.standalone) return modal(`<b>Ajoutez d'abord l'app à l'écran d'accueil</b>
 <p>Sur iPhone, les notifications ne fonctionnent qu'après installation : Partager ⬆️ > « Sur l'écran d'accueil », puis ouvrez l'app depuis l'icône.</p><button class="btn w-full" onclick="closeModal()">OK</button>`);
 if(!('PushManager' in window)) return alert('Notifications non supportées sur ce navigateur');
 if(await Notification.requestPermission()!=='granted') return alert('Permission refusée');
 try{const reg=await navigator.serviceWorker.ready;
  const sub=await reg.pushManager.getSubscription()||await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:b64(VAPID_PUBLIC_KEY)});
  const j=sub.toJSON();
  const {error}=await sb.from('push_subscriptions').upsert({endpoint:j.endpoint,p256dh:j.keys.p256dh,auth:j.keys.auth,user_role:me.role,user_name:me.name},{onConflict:'endpoint'});
  alert(error?error.message:'Notifications activées ✅');
 }catch(e){alert('Erreur : '+e.message)}
}
boot();
