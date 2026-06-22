const STORAGE_KEY = 'sidequest-life-rpg-v1';
const defaults = { profile:{name:'Wanderer',avatar:'W',xpPerLevel:100,accent:'#7767e8'}, totalXp:0, quests:[], rewards:[], history:[] };
let state = loadState();
let activeFilter = 'active';
const cloudConfig = window.SIDEQUEST_CONFIG || {};
const cloudConfigured = cloudConfig.supabaseUrl?.startsWith('https://') && !cloudConfig.supabaseAnonKey?.startsWith('PASTE_');
const cloudClient = cloudConfigured && window.supabase ? window.supabase.createClient(cloudConfig.supabaseUrl, cloudConfig.supabaseAnonKey) : null;
let currentUser = null;
let cloudSaveTimer = null;

function loadState(){try{return {...structuredClone(defaults),...JSON.parse(localStorage.getItem(STORAGE_KEY))}}catch{return structuredClone(defaults)}}
function save(){localStorage.setItem(STORAGE_KEY,JSON.stringify(state));render();scheduleCloudSave()}
function uid(){return crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`}
function today(){return new Date().toISOString().slice(0,10)}
function esc(s){return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function showToast(text){const t=document.querySelector('#toast');t.textContent=text;t.classList.add('show');clearTimeout(showToast.timer);showToast.timer=setTimeout(()=>t.classList.remove('show'),2400)}

function levelInfo(){const per=Number(state.profile.xpPerLevel)||100;const level=Math.floor(state.totalXp/per)+1;return {per,level,inside:state.totalXp%per,remaining:per-(state.totalXp%per)}}
function streak(){const days=new Set(state.history.map(h=>h.date));let n=0,d=new Date();while(days.has(d.toISOString().slice(0,10))){n++;d.setDate(d.getDate()-1)}return n}
function weeklyXp(){const cutoff=Date.now()-7*86400000;return state.history.filter(h=>new Date(h.date).getTime()>=cutoff).reduce((n,h)=>n+h.xp,0)}
function categoryIcon(c){return {Wellness:'◒',Growth:'↗',Work:'▣',Home:'⌂',Social:'♡',Creative:'✦'}[c]||'◇'}

function questHtml(q){return `<article class="quest ${q.completed?'completed':''}" data-id="${q.id}"><button class="complete-button" aria-label="${q.completed?'Undo':'Complete'} quest">${q.completed?'✓':''}</button><div class="quest-main"><div class="quest-title">${esc(q.title)}</div><div class="quest-meta">${categoryIcon(q.category)} ${esc(q.category)}${q.repeat!=='once'?` · ${q.repeat}`:''}</div></div><span class="xp-pill">+${q.xp} XP</span><button class="more-button" aria-label="Delete quest">×</button></article>`}
function renderQuests(){
  const todayQuests=state.quests.filter(q=>q.today && !q.completed);
  document.querySelector('#todayQuestList').innerHTML=todayQuests.map(questHtml).join('');
  document.querySelector('#todayEmpty').hidden=todayQuests.length>0;
  let list=state.quests.filter(q=>activeFilter==='all'||(activeFilter==='completed'?q.completed:!q.completed));
  document.querySelector('#allQuestList').innerHTML=list.map(questHtml).join('') || '<div class="empty-state"><span>◇</span><h3>No quests here</h3><p>Your next chapter is waiting.</p></div>';
}
function renderRewards(){const grid=document.querySelector('#rewardGrid');grid.innerHTML=state.rewards.sort((a,b)=>a.xp-b.xp).map(r=>{const unlocked=state.totalXp>=r.xp;return `<article class="reward-card ${unlocked?'unlocked':'locked'}" data-id="${r.id}"><button class="delete-reward" aria-label="Delete reward">×</button><div class="reward-icon">${esc(r.icon)}</div><h3>${esc(r.title)}</h3><p>Unlocks at ${r.xp} XP</p><div class="reward-status">${unlocked?'✓ UNLOCKED':`${Math.max(0,r.xp-state.totalXp)} XP TO GO`}</div></article>`}).join('');document.querySelector('#rewardEmpty').hidden=state.rewards.length>0}
function render(){
  document.documentElement.style.setProperty('--accent',state.profile.accent);document.documentElement.style.setProperty('--accent-soft',`${state.profile.accent}18`);
  const info=levelInfo();
  document.querySelector('#miniName').textContent=state.profile.name;document.querySelector('#heroName').textContent=state.profile.name;document.querySelector('#miniAvatar').textContent=state.profile.avatar;document.querySelector('#miniLevel').textContent=`Level ${info.level}`;
  document.querySelector('#levelNumber').textContent=info.level;document.querySelector('#currentXp').textContent=info.inside;document.querySelector('#nextXp').textContent=info.per;document.querySelector('#xpRemaining').textContent=`${info.remaining} XP until your next level`;document.querySelector('#xpBar').style.width=`${info.inside/info.per*100}%`;
  document.querySelector('#totalXpStat').textContent=state.totalXp;document.querySelector('#doneStat').textContent=state.quests.filter(q=>q.completed).length;document.querySelector('#weekStat').textContent=`${weeklyXp()} XP`;document.querySelector('#streakCount').textContent=streak();
  renderQuests();renderRewards();renderCloud();
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
  if(data?.state){state={...structuredClone(defaults),...data.state};localStorage.setItem(STORAGE_KEY,JSON.stringify(state));render();showToast('Cloud progress loaded')}
  else await pushCloudState();
}
async function initCloud(){
  if(!cloudClient){renderCloud();return}
  const {data}=await cloudClient.auth.getSession();currentUser=data.session?.user||null;
  if(currentUser)await loadCloudState();else renderCloud();
  cloudClient.auth.onAuthStateChange((_event,session)=>{const previous=currentUser?.id;currentUser=session?.user||null;if(currentUser&&currentUser.id!==previous)setTimeout(loadCloudState,0);renderCloud()});
}
function navigate(view){document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));document.querySelector(`#${view}View`).classList.add('active');document.querySelectorAll('.nav-item').forEach(n=>n.classList.toggle('active',n.dataset.view===view));document.querySelector('.sidebar').classList.remove('open');if(view==='settings'){const f=document.querySelector('#settingsForm');f.name.value=state.profile.name;f.avatar.value=state.profile.avatar;f.xpPerLevel.value=state.profile.xpPerLevel;f.accent.value=state.profile.accent}}

document.querySelectorAll('.nav-item').forEach(b=>b.addEventListener('click',()=>navigate(b.dataset.view)));
document.querySelector('#menuButton').addEventListener('click',()=>document.querySelector('.sidebar').classList.toggle('open'));
document.querySelectorAll('[data-open]').forEach(b=>b.addEventListener('click',()=>document.querySelector(`#${b.dataset.open}Dialog`).showModal()));
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
document.addEventListener('click',e=>{const quest=e.target.closest('.quest');if(quest&&e.target.closest('.complete-button')){const q=state.quests.find(x=>x.id===quest.dataset.id);if(!q)return;const before=levelInfo().level;q.completed=!q.completed;if(q.completed){state.totalXp+=q.xp;state.history.push({date:today(),xp:q.xp,quest:q.id})}else{state.totalXp=Math.max(0,state.totalXp-q.xp);const i=state.history.map(h=>h.quest).lastIndexOf(q.id);if(i>=0)state.history.splice(i,1)}save();const after=levelInfo().level;showToast(after>before?`Level up! You reached level ${after} ✦`:q.completed?`Quest complete! +${q.xp} XP`:'Quest restored')}else if(quest&&e.target.closest('.more-button')){if(confirm('Delete this quest?')){state.quests=state.quests.filter(x=>x.id!==quest.dataset.id);save()}}const reward=e.target.closest('.reward-card');if(reward&&e.target.closest('.delete-reward')){state.rewards=state.rewards.filter(x=>x.id!==reward.dataset.id);save()}});
document.querySelector('#questFilters').addEventListener('click',e=>{if(!e.target.dataset.filter)return;activeFilter=e.target.dataset.filter;document.querySelectorAll('#questFilters .chip').forEach(c=>c.classList.toggle('active',c===e.target));renderQuests()});
document.querySelector('#settingsForm').addEventListener('submit',e=>{e.preventDefault();const f=new FormData(e.currentTarget);state.profile={name:f.get('name').trim(),avatar:f.get('avatar').trim(),xpPerLevel:Number(f.get('xpPerLevel')),accent:f.get('accent')};save();showToast('Your world has been updated')});
document.querySelector('#resetButton').addEventListener('click',()=>{if(confirm('Erase all progress and start fresh?')){state=structuredClone(defaults);save();navigate('today');showToast('A fresh adventure begins')}});

const now=new Date();document.querySelector('#dateLabel').textContent=now.toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'}).toUpperCase();document.querySelector('#dayPeriod').textContent=now.getHours()<12?'morning':now.getHours()<18?'afternoon':'evening';render();initCloud();
