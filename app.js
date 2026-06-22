const STORAGE_KEY = 'sidequest-life-rpg-v1';
const DEFAULT_CATEGORIES = [
  {name:'Wellness',icon:'◒',color:'#55b792'},{name:'Growth',icon:'↗',color:'#7767e8'},
  {name:'Work',icon:'▣',color:'#4d8fd8'},{name:'Home',icon:'⌂',color:'#e19762'},
  {name:'Social',icon:'♡',color:'#dc7290'},{name:'Creative',icon:'✦',color:'#9d70c9'}
];
const defaults = { profile:{name:'Wanderer',avatar:'W',xpPerLevel:100,accent:'#7767e8',background:'#f6f4ef'}, categories:DEFAULT_CATEGORIES, totalXp:0, quests:[], rewards:[], history:[] };
let state = loadState();
let activeFilter = 'active';
const cloudConfig = window.SIDEQUEST_CONFIG || {};
const cloudConfigured = cloudConfig.supabaseUrl?.startsWith('https://') && !cloudConfig.supabaseAnonKey?.startsWith('PASTE_');
const cloudClient = cloudConfigured && window.supabase ? window.supabase.createClient(cloudConfig.supabaseUrl, cloudConfig.supabaseAnonKey) : null;
let currentUser = null;
let cloudSaveTimer = null;

function normalizeState(raw={}){const base=structuredClone(defaults);return {...base,...raw,profile:{...base.profile,...(raw.profile||{})},categories:Array.isArray(raw.categories)&&raw.categories.length?raw.categories:structuredClone(DEFAULT_CATEGORIES)}}
function loadState(){try{return normalizeState(JSON.parse(localStorage.getItem(STORAGE_KEY)))}catch{return structuredClone(defaults)}}
function save(){localStorage.setItem(STORAGE_KEY,JSON.stringify(state));render();scheduleCloudSave()}
function uid(){return crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`}
function today(){return new Date().toISOString().slice(0,10)}
function esc(s){return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function showToast(text){const t=document.querySelector('#toast');t.textContent=text;t.classList.add('show');clearTimeout(showToast.timer);showToast.timer=setTimeout(()=>t.classList.remove('show'),2400)}

function levelInfo(){const per=Number(state.profile.xpPerLevel)||100;const level=Math.floor(state.totalXp/per)+1;return {per,level,inside:state.totalXp%per,remaining:per-(state.totalXp%per)}}
function streak(){const days=new Set(state.history.map(h=>h.date));let n=0,d=new Date();while(days.has(d.toISOString().slice(0,10))){n++;d.setDate(d.getDate()-1)}return n}
function weeklyXp(){const cutoff=Date.now()-7*86400000;return state.history.filter(h=>new Date(h.date).getTime()>=cutoff).reduce((n,h)=>n+h.xp,0)}
function categoryInfo(name){return state.categories.find(c=>c.name===name)||{name,icon:'◇',color:state.profile.accent}}
function categoryIcon(name){return categoryInfo(name).icon}

function questHtml(q){return `<article class="quest ${q.completed?'completed':''}" data-id="${q.id}"><button class="complete-button" aria-label="${q.completed?'Undo':'Complete'} quest">${q.completed?'✓':''}</button><div class="quest-main"><div class="quest-title">${esc(q.title)}</div><div class="quest-meta">${categoryIcon(q.category)} ${esc(q.category)}${q.repeat!=='once'?` · ${q.repeat}`:''}</div></div><span class="xp-pill">+${q.xp} XP</span><button class="more-button" aria-label="Delete quest">×</button></article>`}
function renderQuests(){
  const todayQuests=state.quests.filter(q=>q.today && !q.completed);
  document.querySelector('#todayQuestList').innerHTML=todayQuests.map(questHtml).join('');
  document.querySelector('#todayEmpty').hidden=todayQuests.length>0;
  let list=state.quests.filter(q=>activeFilter==='all'||(activeFilter==='completed'?q.completed:!q.completed));
  document.querySelector('#allQuestList').innerHTML=list.map(questHtml).join('') || '<div class="empty-state"><span>◇</span><h3>No quests here</h3><p>Your next chapter is waiting.</p></div>';
}
function renderRewards(){const grid=document.querySelector('#rewardGrid');grid.innerHTML=state.rewards.sort((a,b)=>a.xp-b.xp).map(r=>{const unlocked=state.totalXp>=r.xp;return `<article class="reward-card ${unlocked?'unlocked':'locked'}" data-id="${r.id}"><button class="delete-reward" aria-label="Delete reward">×</button><div class="reward-icon">${esc(r.icon)}</div><h3>${esc(r.title)}</h3><p>Unlocks at ${r.xp} XP</p><div class="reward-status">${unlocked?'✓ UNLOCKED':`${Math.max(0,r.xp-state.totalXp)} XP TO GO`}</div></article>`}).join('');document.querySelector('#rewardEmpty').hidden=state.rewards.length>0}
function categoryRow(c){return `<div class="category-row" data-original="${esc(c.name)}"><input class="category-icon" name="icon" maxlength="2" value="${esc(c.icon)}" aria-label="Category icon"><input name="categoryName" maxlength="24" value="${esc(c.name)}" aria-label="Category name"><input name="categoryColor" type="color" value="${esc(c.color||state.profile.accent)}" aria-label="Category color"><button class="remove-category" type="button" aria-label="Remove category">×</button></div>`}
function renderCategoryControls(){
  const select=document.querySelector('#questCategory');const previous=select.value;select.innerHTML=state.categories.map(c=>`<option value="${esc(c.name)}">${esc(c.icon)} ${esc(c.name)}</option>`).join('');if([...select.options].some(o=>o.value===previous))select.value=previous;
  document.querySelector('#categoryEditor').innerHTML=state.categories.map(categoryRow).join('');
}
function canvasContext(id){const canvas=document.querySelector(id);const rect=canvas.getBoundingClientRect();if(!rect.width||!rect.height)return null;const dpr=Math.min(window.devicePixelRatio||1,2);canvas.width=Math.round(rect.width*dpr);canvas.height=Math.round(rect.height*dpr);const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);return {ctx,w:rect.width,h:rect.height}}
function historyCategory(h){return h.category||state.quests.find(q=>q.id===h.quest)?.category||'Uncategorized'}
function drawTrend(){
  const chart=canvasContext('#trendCanvas');if(!chart)return;const {ctx,w,h}=chart;const accent=state.profile.accent;const days=[];
  for(let i=13;i>=0;i--){const d=new Date();d.setHours(12,0,0,0);d.setDate(d.getDate()-i);const key=d.toISOString().slice(0,10);days.push({key,label:d.toLocaleDateString(undefined,{month:'short',day:'numeric'}),xp:state.history.filter(x=>x.date===key).reduce((n,x)=>n+Number(x.xp||0),0)})}
  document.querySelector('#trendTotal').textContent=`${days.reduce((n,d)=>n+d.xp,0)} XP`;const pad={l:38,r:16,t:18,b:34};const cw=w-pad.l-pad.r,ch=h-pad.t-pad.b;const max=Math.max(50,Math.ceil(Math.max(...days.map(d=>d.xp))/50)*50);
  ctx.clearRect(0,0,w,h);ctx.font='11px DM Sans';ctx.fillStyle='#8a867f';ctx.strokeStyle='#e8e3da';ctx.lineWidth=1;
  for(let i=0;i<=4;i++){const y=pad.t+ch*i/4;ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(w-pad.r,y);ctx.stroke();ctx.textAlign='right';ctx.fillText(Math.round(max*(1-i/4)),pad.l-8,y+4)}
  const points=days.map((d,i)=>({x:pad.l+cw*i/(days.length-1),y:pad.t+ch*(1-d.xp/max)}));const grad=ctx.createLinearGradient(0,pad.t,0,h-pad.b);grad.addColorStop(0,`${accent}45`);grad.addColorStop(1,`${accent}02`);
  ctx.beginPath();ctx.moveTo(points[0].x,h-pad.b);points.forEach(p=>ctx.lineTo(p.x,p.y));ctx.lineTo(points.at(-1).x,h-pad.b);ctx.closePath();ctx.fillStyle=grad;ctx.fill();ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.strokeStyle=accent;ctx.lineWidth=3;ctx.lineJoin='round';ctx.stroke();
  points.forEach((p,i)=>{if(days[i].xp){ctx.beginPath();ctx.arc(p.x,p.y,4,0,Math.PI*2);ctx.fillStyle='#fff';ctx.fill();ctx.strokeStyle=accent;ctx.lineWidth=2;ctx.stroke()}});ctx.fillStyle='#8a867f';ctx.textAlign='center';[0,4,9,13].forEach(i=>ctx.fillText(days[i].label,points[i].x,h-10));
}
function drawPowers(){
  const chart=canvasContext('#powerCanvas');if(!chart)return;const {ctx,w,h}=chart;const categories=state.categories.slice(0,8);const values=categories.map(c=>state.history.filter(x=>historyCategory(x)===c.name).reduce((n,x)=>n+Number(x.xp||0),0));const max=Math.max(100,Math.ceil(Math.max(...values,0)/50)*50);document.querySelector('#powerNote').textContent=values.some(Boolean)?`Power scale: 0–${max} XP${state.categories.length>8?' · Showing your first 8 categories':''}`:'Complete quests to shape your character.';
  ctx.clearRect(0,0,w,h);if(categories.length<3){ctx.fillStyle='#77736c';ctx.font='14px DM Sans';ctx.textAlign='center';ctx.fillText('Add at least 3 categories to draw your power canvas.',w/2,h/2);return}
  const cx=w/2,cy=h/2-2,r=Math.min(w*.32,h*.34),n=categories.length,angle=i=>-Math.PI/2+i*Math.PI*2/n,point=(i,scale)=>({x:cx+Math.cos(angle(i))*r*scale,y:cy+Math.sin(angle(i))*r*scale});ctx.lineWidth=1;
  for(let ring=1;ring<=5;ring++){ctx.beginPath();for(let i=0;i<n;i++){const p=point(i,ring/5);i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y)}ctx.closePath();ctx.strokeStyle='#ded9d0';ctx.stroke()}
  for(let i=0;i<n;i++){const p=point(i,1);ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(p.x,p.y);ctx.strokeStyle='#e5e0d7';ctx.stroke()}
  ctx.beginPath();values.forEach((v,i)=>{const p=point(i,v/max);i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y)});ctx.closePath();ctx.fillStyle=`${state.profile.accent}35`;ctx.fill();ctx.strokeStyle=state.profile.accent;ctx.lineWidth=2.5;ctx.stroke();values.forEach((v,i)=>{const p=point(i,v/max);ctx.beginPath();ctx.arc(p.x,p.y,3,0,Math.PI*2);ctx.fillStyle=state.profile.accent;ctx.fill()});
  ctx.font='600 11px DM Sans';categories.forEach((c,i)=>{const p=point(i,1.2);ctx.textAlign=p.x<cx-8?'right':p.x>cx+8?'left':'center';ctx.fillStyle=c.color||'#57534e';ctx.fillText(`${c.icon} ${c.name}`,p.x,p.y);ctx.fillStyle='#8a867f';ctx.font='10px DM Sans';ctx.fillText(`${values[i]} XP`,p.x,p.y+13);ctx.font='600 11px DM Sans'});
}
function drawCharts(){drawTrend();drawPowers()}
function render(){
  document.documentElement.style.setProperty('--accent',state.profile.accent);document.documentElement.style.setProperty('--accent-soft',`${state.profile.accent}18`);document.documentElement.style.setProperty('--bg',state.profile.background||defaults.profile.background);
  const info=levelInfo();
  document.querySelector('#miniName').textContent=state.profile.name;document.querySelector('#heroName').textContent=state.profile.name;document.querySelector('#miniAvatar').textContent=state.profile.avatar;document.querySelector('#miniLevel').textContent=`Level ${info.level}`;
  document.querySelector('#levelNumber').textContent=info.level;document.querySelector('#currentXp').textContent=info.inside;document.querySelector('#nextXp').textContent=info.per;document.querySelector('#xpRemaining').textContent=`${info.remaining} XP until your next level`;document.querySelector('#xpBar').style.width=`${info.inside/info.per*100}%`;
  document.querySelector('#totalXpStat').textContent=state.totalXp;document.querySelector('#doneStat').textContent=state.quests.filter(q=>q.completed).length;document.querySelector('#weekStat').textContent=`${weeklyXp()} XP`;document.querySelector('#streakCount').textContent=streak();
  renderQuests();renderRewards();renderCategoryControls();renderCloud();if(document.querySelector('#progressView').classList.contains('active'))requestAnimationFrame(drawCharts);
}
function setSyncStatus(text,mode=''){const el=document.querySelector('#syncStatus');el.textContent=`● ${text}`;el.className=`sync-status ${mode}`}
function renderCloud(){
  const card=document.querySelector('#cloudCard');
  if(!cloudConfigured){setSyncStatus('Setup needed');card.innerHTML='<div><strong>Cloud sync needs setup</strong><p>Complete the short steps in DEPLOY.md, then sign in on every device.</p></div>';return}
  if(currentUser){setSyncStatus('Synced','synced');card.innerHTML=`<div><strong>Cloud sync is on</strong><p>${esc(currentUser.email)} · Your progress follows you across devices.</p></div><button class="secondary" id="signOutButton">Sign out</button>`}
  else{setSyncStatus('Local only');card.innerHTML='<div><strong>Playing locally</strong><p>Sign in to back up and sync this adventure.</p></div><button class="secondary" id="signInButton">Sign in</button>'}
}
function scheduleCloudSave(){if(!cloudClient||!currentUser)return;setSyncStatus('Syncing…','syncing');clearTimeout(cloudSaveTimer);cloudSaveTimer=setTimeout(pushCloudState,500)}
async function pushCloudState(){
  if(!cloudClient||!currentUser)return;
  const {error}=await cloudClient.from('game_states').upsert({user_id:currentUser.id,state,updated_at:new Date().toISOString()});
  if(error){setSyncStatus('Sync failed');showToast('Cloud sync failed — saved safely on this device')}else setSyncStatus('Synced','synced');
}
async function loadCloudState(){
  setSyncStatus('Syncing…','syncing');
  const {data,error}=await cloudClient.from('game_states').select('state').eq('user_id',currentUser.id).maybeSingle();
  if(error){setSyncStatus('Sync failed');showToast('Could not load cloud progress');return}
  if(data?.state){state=normalizeState(data.state);localStorage.setItem(STORAGE_KEY,JSON.stringify(state));render();showToast('Cloud progress loaded')}
  else await pushCloudState();
}
async function initCloud(){
  if(!cloudClient){renderCloud();return}
  const {data}=await cloudClient.auth.getSession();currentUser=data.session?.user||null;
  if(currentUser)await loadCloudState();else renderCloud();
  cloudClient.auth.onAuthStateChange((_event,session)=>{const previous=currentUser?.id;currentUser=session?.user||null;if(currentUser&&currentUser.id!==previous)setTimeout(loadCloudState,0);renderCloud()});
}
function navigate(view){document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));document.querySelector(`#${view}View`).classList.add('active');document.querySelectorAll('.nav-item').forEach(n=>n.classList.toggle('active',n.dataset.view===view));document.querySelector('.sidebar').classList.remove('open');if(view==='settings'){const f=document.querySelector('#settingsForm');f.name.value=state.profile.name;f.avatar.value=state.profile.avatar;f.xpPerLevel.value=state.profile.xpPerLevel;f.accent.value=state.profile.accent;f.background.value=state.profile.background||defaults.profile.background;renderCategoryControls()}if(view==='progress')requestAnimationFrame(drawCharts)}

document.querySelectorAll('.nav-item').forEach(b=>b.addEventListener('click',()=>navigate(b.dataset.view)));
document.querySelector('#menuButton').addEventListener('click',()=>document.querySelector('.sidebar').classList.toggle('open'));
document.querySelectorAll('[data-open]').forEach(b=>b.addEventListener('click',()=>document.querySelector(`#${b.dataset.open}Dialog`).showModal()));
document.querySelectorAll('[data-close-dialog]').forEach(b=>b.addEventListener('click',()=>b.closest('dialog').close()));
document.querySelectorAll('dialog').forEach(d=>d.addEventListener('click',e=>{if(e.target===d)d.close()}));
document.querySelector('#syncStatus').addEventListener('click',()=>cloudConfigured?document.querySelector('#authDialog').showModal():navigate('settings'));
document.querySelector('#cloudCard').addEventListener('click',async e=>{if(e.target.closest('#signInButton'))document.querySelector('#authDialog').showModal();if(e.target.closest('#signOutButton')){await cloudClient.auth.signOut();showToast('Signed out — progress remains saved locally')}});
document.querySelector('#authForm').addEventListener('submit',async e=>{
  e.preventDefault();
  if(e.submitter?.value==='cancel'){document.querySelector('#authDialog').close();return}
  const message=document.querySelector('#authMessage');const f=new FormData(e.currentTarget);const credentials={email:f.get('email'),password:f.get('password')};
  message.textContent='Connecting…';
  const result=e.submitter?.value==='signup'?await cloudClient.auth.signUp(credentials):await cloudClient.auth.signInWithPassword(credentials);
  if(result.error){message.textContent=result.error.message;return}
  if(!result.data.session){message.textContent='Check your email to confirm your account, then sign in.';return}
  message.textContent='';e.currentTarget.reset();document.querySelector('#authDialog').close();showToast('Signed in — cloud sync is on');
});
document.querySelector('#questForm').addEventListener('submit',e=>{if(e.submitter?.value==='cancel')return;const f=new FormData(e.currentTarget);state.quests.unshift({id:uid(),title:f.get('title'),category:f.get('category'),xp:Number(f.get('xp')),repeat:f.get('repeat'),today:f.has('today'),completed:false,created:today()});e.currentTarget.reset();save();showToast('Quest added to your adventure')});
document.querySelector('#rewardForm').addEventListener('submit',e=>{if(e.submitter?.value==='cancel')return;const f=new FormData(e.currentTarget);state.rewards.push({id:uid(),title:f.get('title'),xp:Number(f.get('xp')),icon:f.get('icon')});e.currentTarget.reset();save();showToast('New reward added')});
document.addEventListener('click',e=>{const quest=e.target.closest('.quest');if(quest&&e.target.closest('.complete-button')){const q=state.quests.find(x=>x.id===quest.dataset.id);if(!q)return;const before=levelInfo().level;q.completed=!q.completed;if(q.completed){state.totalXp+=q.xp;state.history.push({date:today(),xp:q.xp,quest:q.id,category:q.category})}else{state.totalXp=Math.max(0,state.totalXp-q.xp);const i=state.history.map(h=>h.quest).lastIndexOf(q.id);if(i>=0)state.history.splice(i,1)}save();const after=levelInfo().level;showToast(after>before?`Level up! You reached level ${after} ✦`:q.completed?`Quest complete! +${q.xp} XP`:'Quest restored')}else if(quest&&e.target.closest('.more-button')){if(confirm('Delete this quest?')){state.quests=state.quests.filter(x=>x.id!==quest.dataset.id);save()}}const reward=e.target.closest('.reward-card');if(reward&&e.target.closest('.delete-reward')){state.rewards=state.rewards.filter(x=>x.id!==reward.dataset.id);save()}});
document.querySelector('#questFilters').addEventListener('click',e=>{if(!e.target.dataset.filter)return;activeFilter=e.target.dataset.filter;document.querySelectorAll('#questFilters .chip').forEach(c=>c.classList.toggle('active',c===e.target));renderQuests()});
document.querySelector('#settingsForm').addEventListener('submit',e=>{e.preventDefault();const f=new FormData(e.currentTarget);state.profile={...state.profile,name:f.get('name').trim(),avatar:f.get('avatar').trim(),xpPerLevel:Number(f.get('xpPerLevel')),accent:f.get('accent'),background:f.get('background')};save();showToast('Your world has been updated')});
document.querySelector('#addCategoryButton').addEventListener('click',()=>{const count=document.querySelectorAll('.category-row').length;document.querySelector('#categoryEditor').insertAdjacentHTML('beforeend',categoryRow({name:`New power ${count+1}`,icon:'◇',color:state.profile.accent}))});
document.querySelector('#categoryEditor').addEventListener('click',e=>{if(!e.target.closest('.remove-category'))return;if(document.querySelectorAll('.category-row').length<=1){showToast('Keep at least one category');return}e.target.closest('.category-row').remove()});
document.querySelector('#saveCategoriesButton').addEventListener('click',()=>{
  const rows=[...document.querySelectorAll('.category-row')];const categories=rows.map(r=>({name:r.querySelector('[name=categoryName]').value.trim(),icon:r.querySelector('[name=icon]').value.trim()||'◇',color:r.querySelector('[name=categoryColor]').value,original:r.dataset.original}));
  if(categories.some(c=>!c.name)){showToast('Every category needs a name');return}if(new Set(categories.map(c=>c.name.toLowerCase())).size!==categories.length){showToast('Category names must be unique');return}
  const rename=new Map(categories.filter(c=>c.original).map(c=>[c.original,c.name]));const names=new Set(categories.map(c=>c.name));const fallback=categories[0].name;state.quests.forEach(q=>q.category=rename.get(q.category)||(names.has(q.category)?q.category:fallback));state.history.forEach(h=>{const old=historyCategory(h);h.category=rename.get(old)||(names.has(old)?old:fallback)});state.categories=categories.map(({name,icon,color})=>({name,icon,color}));save();showToast('Categories and character powers updated');
});
document.querySelector('#resetButton').addEventListener('click',()=>{if(confirm('Erase all progress and start fresh?')){state=structuredClone(defaults);save();navigate('today');showToast('A fresh adventure begins')}});

let resizeTimer;window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{if(document.querySelector('#progressView').classList.contains('active'))drawCharts()},120)});
const now=new Date();document.querySelector('#dateLabel').textContent=now.toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'}).toUpperCase();document.querySelector('#dayPeriod').textContent=now.getHours()<12?'morning':now.getHours()<18?'afternoon':'evening';render();initCloud();
