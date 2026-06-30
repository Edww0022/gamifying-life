const STORAGE_KEY = 'sidequest-life-rpg-v1';

const DEFAULT_CATEGORIES = [
  { name: 'Wellness', icon: '◒', iconImage: '', color: '#55b792' },
  { name: 'Growth', icon: '↗', iconImage: '', color: '#7767e8' },
  { name: 'Work', icon: '▣', iconImage: '', color: '#4d8fd8' },
  { name: 'Home', icon: '⌂', iconImage: '', color: '#e19762' },
  { name: 'Social', icon: '♡', iconImage: '', color: '#dc7290' },
  { name: 'Creative', icon: '✦', iconImage: '', color: '#9d70c9' }
];

const defaults = {
  profile: {
    name: 'Wanderer',
    avatar: 'W',
    photo: '',
    xpPerLevel: 100,
    slotEveryXp: 100,
    accent: '#7767e8',
    theme: 'light'
  },
  categories: DEFAULT_CATEGORIES,
  totalXp: 0,
  coins: 0,
  quests: [],
  rewards: [],
  history: []
};

let state = loadState();
let activeFilter = 'active';
let pendingPhoto = state.profile.photo || '';
let editingQuestId = null;
let pendingRewardIconImage = '';
const cloudConfig = window.SIDEQUEST_CONFIG || {};
const cloudConfigured = cloudConfig.supabaseUrl?.startsWith('https://') && !cloudConfig.supabaseAnonKey?.startsWith('PASTE_');
const cloudClient = cloudConfigured && window.supabase ? window.supabase.createClient(cloudConfig.supabaseUrl, cloudConfig.supabaseAnonKey) : null;
let currentUser = null;
let cloudSaveTimer = null;

function normalizeQuest(q = {}) {
  const repeat = q.repeat === 'weekly' ? 'custom' : (q.repeat || 'once');
  const created = new Date(`${q.created || today()}T12:00:00`);
  const repeatDays = q.repeat === 'weekly'
    ? [created.getDay()]
    : (Array.isArray(q.repeatDays) ? q.repeatDays.map(Number) : []);
  const xp = Number(q.xp || 25);
  const coins = Number.isFinite(Number(q.coins)) ? Number(q.coins) : defaultCoinsFor(xp, repeat);
  return {
    id: q.id || uid(),
    title: q.title || 'Untitled quest',
    category: q.category || DEFAULT_CATEGORIES[0].name,
    xp,
    coins,
    dailyLimit: Math.max(1, Number(q.dailyLimit || q.maxPerDay || 1)),
    repeat,
    repeatDays,
    today: q.today !== false,
    completed: Boolean(q.completed),
    lastCompleted: q.lastCompleted || null,
    created: q.created || today()
  };
}

function normalizeReward(r = {}, index = 0) {
  return {
    id: r.id || uid(),
    title: r.title || 'Mystery reward',
    description: r.description || '',
    slot: Math.max(1, Number(r.slot || index + 1)),
    coinCost: Number.isFinite(Number(r.coinCost)) ? Number(r.coinCost) : 0,
    icon: r.icon || '🎁',
    iconImage: validImageData(r.iconImage) ? r.iconImage : '',
    owned: Math.max(0, Number(r.owned || r.quantity || (r.purchased ? 1 : 0)))
  };
}

function normalizeCategory(c = {}) {
  return {
    name: c.name || 'Power',
    icon: c.icon || '◇',
    iconImage: validImageData(c.iconImage) ? c.iconImage : '',
    color: c.color || defaults.profile.accent
  };
}

function normalizeState(raw = {}) {
  const base = structuredClone(defaults);
  const categories = Array.isArray(raw.categories) && raw.categories.length
    ? raw.categories.map(normalizeCategory)
    : structuredClone(DEFAULT_CATEGORIES);
  return {
    ...base,
    ...raw,
    profile: { ...base.profile, ...(raw.profile || {}) },
    categories,
    totalXp: Number(raw.totalXp || 0),
    coins: Number(raw.coins || 0),
    quests: Array.isArray(raw.quests) ? raw.quests.map(normalizeQuest) : [],
    rewards: Array.isArray(raw.rewards) ? raw.rewards.map(normalizeReward) : [],
    history: Array.isArray(raw.history) ? raw.history.map(h => ({ ...h, coins: Number(h.coins || 0) })) : []
  };
}

function loadState() {
  try { return normalizeState(JSON.parse(localStorage.getItem(STORAGE_KEY))); }
  catch { return structuredClone(defaults); }
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  render();
  scheduleCloudSave();
}

function uid() { return crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`; }
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function esc(s) { return String(s ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c])); }
function showToast(text) {
  const t = document.querySelector('#toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => t.classList.remove('show'), 2600);
}

function validImageData(value) {
  return typeof value === 'string' && /^data:image\/(?:png|jpeg|webp|gif);base64,[a-z0-9+/=]+$/i.test(value);
}
function renderPhoto(target, photo, fallback) {
  target.innerHTML = '';
  if (validImageData(photo)) {
    const img = document.createElement('img');
    img.src = photo;
    img.alt = 'Profile picture';
    target.appendChild(img);
  } else {
    target.textContent = fallback || 'W';
  }
}
function iconHtml(item, className = 'inline-icon') {
  if (validImageData(item?.iconImage)) return `<span class="${className} image-icon"><img src="${item.iconImage}" alt=""></span>`;
  return `<span class="${className}">${esc(item?.icon || '◇')}</span>`;
}
function plainIcon(item) { return validImageData(item?.iconImage) ? '▣' : (item?.icon || '◇'); }
function resizeImage(file, size = 256, quality = 0.84) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) { reject(new Error('Choose an image file')); return; }
    if (file.size > 8 * 1024 * 1024) { reject(new Error('Choose an image smaller than 8 MB')); return; }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that image'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Could not open that image'));
      img.onload = () => {
        const scale = Math.max(size / img.width, size / img.height);
        const w = img.width * scale, h = img.height * scale;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        canvas.getContext('2d').drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function defaultCoinsFor(xp, repeat) {
  const divisor = repeat === 'once' ? 5 : 10;
  return Math.max(1, Math.round(Number(xp || 0) / divisor));
}
function levelInfo() {
  const per = Number(state.profile.xpPerLevel) || 100;
  const level = Math.floor(state.totalXp / per) + 1;
  return { per, level, inside: state.totalXp % per, remaining: per - (state.totalXp % per) };
}
function unlockedSlots() {
  const every = Math.max(20, Number(state.profile.slotEveryXp) || 100);
  return Math.min(12, Math.max(1, Math.floor(state.totalXp / every) + 1));
}
function nextSlotText() {
  if (unlockedSlots() >= 12) return 'All 12 store slots unlocked';
  const every = Math.max(20, Number(state.profile.slotEveryXp) || 100);
  const next = unlockedSlots() * every;
  return `${Math.max(0, next - state.totalXp)} XP until next store slot`;
}
function streak() {
  const days = new Set(state.history.map(h => h.date));
  let n = 0, d = new Date();
  while (days.has(d.toISOString().slice(0, 10))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}
function weeklyXp() {
  const cutoff = Date.now() - 7 * 86400000;
  return state.history.filter(h => new Date(h.date).getTime() >= cutoff).reduce((n, h) => n + Number(h.xp || 0), 0);
}
function categoryInfo(name) { return state.categories.find(c => c.name === name) || { name, icon: '◇', iconImage: '', color: state.profile.accent }; }
function questDueToday(q) {
  if (q.repeat === 'daily') return true;
  if (q.repeat === 'custom') return (q.repeatDays || []).includes(new Date().getDay());
  return Boolean(q.today);
}
function completionLimit(q) { return Math.max(1, Number(q.dailyLimit || 1)); }
function completionsOn(q, date = today()) { return state.history.filter(h => h.quest === q.id && h.date === date).length; }
function isQuestComplete(q) {
  if (q.repeat === 'once' && q.completed && completionsOn(q) === 0) return true;
  return completionsOn(q) >= completionLimit(q);
}
function completionText(q) {
  const limit = completionLimit(q);
  const count = completionsOn(q);
  return limit > 1 ? ` · Done ${Math.min(count, limit)}/${limit} today` : '';
}
function repeatLabel(q) {
  if (q.repeat === 'daily') return 'Daily';
  if (q.repeat === 'custom') {
    const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return (q.repeatDays || []).map(d => names[d]).join(', ') || 'No days selected';
  }
  return 'One-time';
}
function refreshRecurringQuests() {
  let changed = false;
  const key = today();
  state.quests.forEach(q => {
    if (q.repeat !== 'daily' && q.repeat !== 'custom') return;
    if (!q.lastCompleted) {
      const latest = [...state.history].reverse().find(h => h.quest === q.id);
      if (latest) q.lastCompleted = latest.date;
    }
    if (q.completed && q.lastCompleted !== key && questDueToday(q)) {
      q.completed = false;
      changed = true;
    }
  });
  return changed;
}

function questHtml(q) {
  const cat = categoryInfo(q.category);
  const completed = isQuestComplete(q);
  const count = completionsOn(q);
  return `<article class="quest ${completed ? 'completed' : ''}" data-id="${q.id}" title="Double-click to edit this quest">
    <button class="complete-button" aria-label="${completed ? 'Undo last completion' : 'Complete'} quest">${completed ? '✓' : count ? '+' : ''}</button>
    <div class="quest-main">
      <div class="quest-title">${iconHtml(cat)} ${esc(q.title)}</div>
      <div class="quest-meta">${esc(q.category)} · ${esc(repeatLabel(q))}${completionText(q)}</div>
    </div>
    <span class="xp-pill">+${q.xp} XP</span>
    <span class="coin-pill">+${q.coins} coins</span>
    <button class="more-button" aria-label="Delete quest">×</button>
  </article>`;
}
function renderQuests() {
  const todayQuests = state.quests.filter(q => questDueToday(q) && !isQuestComplete(q));
  document.querySelector('#todayQuestList').innerHTML = todayQuests.map(questHtml).join('');
  document.querySelector('#todayEmpty').hidden = todayQuests.length > 0;
  const list = state.quests.filter(q => activeFilter === 'all' || (activeFilter === 'completed' ? isQuestComplete(q) : !isQuestComplete(q)));
  document.querySelector('#allQuestList').innerHTML = list.map(questHtml).join('') || '<div class="empty-state"><span>◇</span><h3>No quests here</h3><p>Your next chapter is waiting.</p></div>';
}

function renderRewards() {
  const grid = document.querySelector('#rewardGrid');
  const slots = unlockedSlots();
  const maxSlot = 12;
  const cards = [];
  for (let slot = 1; slot <= maxSlot; slot++) {
    const unlocked = slot <= slots;
    const reward = state.rewards.find(r => Number(r.slot) === slot);
    if (!reward) {
      cards.push(`<article class="reward-card empty-slot ${unlocked ? 'unlocked' : 'locked'}">
        <div class="slot-label">Slot ${slot}</div>
        <div class="reward-icon">＋</div>
        <h3>${unlocked ? 'Empty store slot' : 'Locked slot'}</h3>
        <p>${unlocked ? 'Add an item your future self can buy.' : `Unlocks at ${(slot - 1) * (Number(state.profile.slotEveryXp) || 100)} XP`}</p>
        ${unlocked ? `<button class="secondary add-slot-reward" data-slot="${slot}" type="button">Add item here</button>` : ''}
      </article>`);
      continue;
    }
    const canBuy = unlocked && state.coins >= reward.coinCost;
    cards.push(`<article class="reward-card ${unlocked ? 'unlocked' : 'locked'} ${Number(reward.owned || 0) ? 'owned' : ''}" data-id="${reward.id}">
      <button class="delete-reward" aria-label="Delete reward">×</button>
      <div class="slot-label">Slot ${slot}</div>
      <div class="reward-icon">${iconHtml(reward, 'big-icon')}</div>
      <h3>${esc(reward.title)}</h3>
      ${reward.description ? `<p>${esc(reward.description)}</p>` : '<p>A store item for your real-life adventure.</p>'}
      <div class="reward-price"><span>${reward.coinCost} coins</span></div>
      <div class="reward-status">${unlocked ? (canBuy ? 'READY TO REDEEM' : 'SAVE UP TO REDEEM') : `LOCKED UNTIL SLOT ${slot}`} · Owned: ${Number(reward.owned || 0)}</div>
      ${unlocked ? `<button class="primary compact buy-reward" type="button">Redeem +1</button>` : ''}
    </article>`);
  }
  grid.innerHTML = cards.join('');
  document.querySelector('#rewardEmpty').hidden = state.rewards.length > 0 || slots > 0;
  document.querySelector('#storeSlots').textContent = `${slots} / 12`;
  document.querySelector('#nextSlotHint').textContent = nextSlotText();
  document.querySelector('#storeCoinBalance').textContent = state.coins;
  renderInventory();
}

function renderInventory() {
  const list = document.querySelector('#inventoryList');
  const owned = state.rewards.filter(r => Number(r.owned || 0) > 0).sort((a, b) => a.title.localeCompare(b.title));
  list.innerHTML = owned.map(r => `<article class="inventory-item" data-id="${r.id}">
    <div class="inventory-icon">${iconHtml(r, 'big-icon')}</div>
    <div><strong>${esc(r.title)}</strong><small>${r.description ? esc(r.description) : 'Consumable reward'}</small></div>
    <span class="inventory-count">×${Number(r.owned || 0)}</span>
    <button class="secondary use-inventory" type="button">Use one</button>
  </article>`).join('');
  document.querySelector('#inventoryEmpty').hidden = owned.length > 0;
}

function categoryRow(c) {
  return `<div class="category-row" data-original="${esc(c.name)}">
    <div class="icon-preview category-preview">${iconHtml(c, 'big-icon')}</div>
    <input name="icon" maxlength="2" value="${esc(c.icon)}" aria-label="Category text icon">
    <input type="hidden" name="iconImage" value="${esc(c.iconImage || '')}">
    <label class="file-icon-button">Upload<input name="categoryIconFile" type="file" accept="image/png,image/jpeg,image/webp,image/gif"></label>
    <input name="categoryName" maxlength="24" value="${esc(c.name)}" aria-label="Category name">
    <input name="categoryColor" type="color" value="${esc(c.color || state.profile.accent)}" aria-label="Category color">
    <button class="remove-category" type="button" aria-label="Remove category">×</button>
  </div>`;
}
function renderCategoryControls() {
  const select = document.querySelector('#questCategory');
  const previous = select.value;
  select.innerHTML = state.categories.map(c => `<option value="${esc(c.name)}">${esc(plainIcon(c))} ${esc(c.name)}</option>`).join('');
  if ([...select.options].some(o => o.value === previous)) select.value = previous;
  document.querySelector('#categoryEditor').innerHTML = state.categories.map(categoryRow).join('');
}

function canvasContext(id) {
  const canvas = document.querySelector(id);
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w: rect.width, h: rect.height };
}
function historyCategory(h) { return h.category || state.quests.find(q => q.id === h.quest)?.category || 'Uncategorized'; }
function drawTrend() {
  const chart = canvasContext('#trendCanvas'); if (!chart) return;
  const { ctx, w, h } = chart;
  const accent = state.profile.accent;
  const css = getComputedStyle(document.documentElement);
  const muted = css.getPropertyValue('--muted').trim(), line = css.getPropertyValue('--line').trim(), panel = css.getPropertyValue('--panel').trim();
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    days.push({ key, label: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), xp: state.history.filter(x => x.date === key).reduce((n, x) => n + Number(x.xp || 0), 0) });
  }
  document.querySelector('#trendTotal').textContent = `${days.reduce((n, d) => n + d.xp, 0)} XP`;
  const pad = { l: 38, r: 16, t: 18, b: 34 }, cw = w - pad.l - pad.r, ch = h - pad.t - pad.b;
  const max = Math.max(50, Math.ceil(Math.max(...days.map(d => d.xp)) / 50) * 50);
  ctx.clearRect(0, 0, w, h); ctx.font = '11px DM Sans'; ctx.fillStyle = muted; ctx.strokeStyle = line; ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.t + ch * i / 4;
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
    ctx.textAlign = 'right'; ctx.fillText(Math.round(max * (1 - i / 4)), pad.l - 8, y + 4);
  }
  const points = days.map((d, i) => ({ x: pad.l + cw * i / (days.length - 1), y: pad.t + ch * (1 - d.xp / max) }));
  const grad = ctx.createLinearGradient(0, pad.t, 0, h - pad.b);
  grad.addColorStop(0, `${accent}45`); grad.addColorStop(1, `${accent}02`);
  ctx.beginPath(); ctx.moveTo(points[0].x, h - pad.b); points.forEach(p => ctx.lineTo(p.x, p.y)); ctx.lineTo(points.at(-1).x, h - pad.b); ctx.closePath(); ctx.fillStyle = grad; ctx.fill();
  ctx.beginPath(); points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.strokeStyle = accent; ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.stroke();
  points.forEach((p, i) => { if (days[i].xp) { ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); ctx.fillStyle = panel; ctx.fill(); ctx.strokeStyle = accent; ctx.lineWidth = 2; ctx.stroke(); } });
  ctx.fillStyle = muted; ctx.textAlign = 'center'; [0, 4, 9, 13].forEach(i => ctx.fillText(days[i].label, points[i].x, h - 10));
}
function drawPowers() {
  const chart = canvasContext('#powerCanvas'); if (!chart) return;
  const { ctx, w, h } = chart;
  const css = getComputedStyle(document.documentElement);
  const muted = css.getPropertyValue('--muted').trim(), line = css.getPropertyValue('--line').trim();
  const categories = state.categories.slice(0, 8);
  const values = categories.map(c => state.history.filter(x => historyCategory(x) === c.name).reduce((n, x) => n + Number(x.xp || 0), 0));
  const max = Math.max(100, Math.ceil(Math.max(...values, 0) / 50) * 50);
  document.querySelector('#powerNote').textContent = values.some(Boolean) ? `Power scale: 0–${max} XP${state.categories.length > 8 ? ' · Showing your first 8 categories' : ''}` : 'Complete quests to shape your character.';
  ctx.clearRect(0, 0, w, h);
  if (categories.length < 3) {
    ctx.fillStyle = muted; ctx.font = '14px DM Sans'; ctx.textAlign = 'center'; ctx.fillText('Add at least 3 categories to draw your power canvas.', w / 2, h / 2); return;
  }
  const cx = w / 2, cy = h / 2 - 2, r = Math.min(w * .32, h * .34), n = categories.length;
  const angle = i => -Math.PI / 2 + i * Math.PI * 2 / n;
  const point = (i, scale) => ({ x: cx + Math.cos(angle(i)) * r * scale, y: cy + Math.sin(angle(i)) * r * scale });
  ctx.lineWidth = 1;
  for (let ring = 1; ring <= 5; ring++) {
    ctx.beginPath();
    for (let i = 0; i < n; i++) { const p = point(i, ring / 5); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); }
    ctx.closePath(); ctx.strokeStyle = line; ctx.stroke();
  }
  for (let i = 0; i < n; i++) { const p = point(i, 1); ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(p.x, p.y); ctx.strokeStyle = line; ctx.stroke(); }
  ctx.beginPath(); values.forEach((v, i) => { const p = point(i, v / max); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); });
  ctx.closePath(); ctx.fillStyle = `${state.profile.accent}35`; ctx.fill(); ctx.strokeStyle = state.profile.accent; ctx.lineWidth = 2.5; ctx.stroke();
  values.forEach((v, i) => { const p = point(i, v / max); ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fillStyle = state.profile.accent; ctx.fill(); });
  ctx.font = '600 11px DM Sans';
  categories.forEach((c, i) => {
    const p = point(i, 1.2);
    ctx.textAlign = p.x < cx - 8 ? 'right' : p.x > cx + 8 ? 'left' : 'center';
    ctx.fillStyle = c.color || muted;
    ctx.fillText(`${plainIcon(c)} ${c.name}`, p.x, p.y);
    ctx.fillStyle = muted; ctx.font = '10px DM Sans'; ctx.fillText(`${values[i]} XP`, p.x, p.y + 13); ctx.font = '600 11px DM Sans';
  });
}
function drawCharts() { drawTrend(); drawPowers(); }

function render() {
  if (refreshRecurringQuests()) { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); scheduleCloudSave(); }
  document.documentElement.style.setProperty('--accent', state.profile.accent);
  document.documentElement.style.setProperty('--accent-soft', `${state.profile.accent}18`);
  document.documentElement.dataset.theme = state.profile.theme === 'dark' ? 'dark' : 'light';
  const info = levelInfo();
  document.querySelector('#miniName').textContent = state.profile.name;
  document.querySelector('#heroName').textContent = state.profile.name;
  renderPhoto(document.querySelector('#miniAvatar'), state.profile.photo, state.profile.avatar);
  document.querySelector('#miniLevel').textContent = `Level ${info.level}`;
  const themeButton = document.querySelector('#themeToggle');
  themeButton.textContent = state.profile.theme === 'dark' ? '☀' : '☾';
  themeButton.setAttribute('aria-label', state.profile.theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
  document.querySelector('#levelNumber').textContent = info.level;
  document.querySelector('#currentXp').textContent = info.inside;
  document.querySelector('#nextXp').textContent = info.per;
  document.querySelector('#xpRemaining').textContent = `${info.remaining} XP until your next level`;
  document.querySelector('#xpBar').style.width = `${info.inside / info.per * 100}%`;
  document.querySelector('#totalXpStat').textContent = state.totalXp;
  document.querySelector('#coinStat').textContent = state.coins;
  document.querySelector('#doneStat').textContent = state.history.length;
  document.querySelector('#weekStat').textContent = `${weeklyXp()} XP`;
  document.querySelector('#streakCount').textContent = streak();
  renderQuests();
  renderRewards();
  renderCategoryControls();
  renderCloud();
  if (document.querySelector('#progressView').classList.contains('active')) requestAnimationFrame(drawCharts);
}

function setSyncStatus(text, mode = '') {
  const el = document.querySelector('#syncStatus');
  el.textContent = `● ${text}`;
  el.className = `sync-status ${mode}`;
}
function renderCloud() {
  const card = document.querySelector('#cloudCard');
  if (!cloudConfigured) {
    setSyncStatus('Setup needed');
    card.innerHTML = '<div><strong>Cloud sync needs setup</strong><p>Complete the short steps in DEPLOY.md, then sign in on every device.</p></div>';
    return;
  }
  if (currentUser) {
    setSyncStatus('Synced', 'synced');
    card.innerHTML = `<div><strong>Cloud sync is on</strong><p>${esc(currentUser.email)} · Your progress follows you across devices.</p></div><button class="secondary" id="signOutButton">Sign out</button>`;
  } else {
    setSyncStatus('Local only');
    card.innerHTML = '<div><strong>Playing locally</strong><p>Sign in to back up and sync this adventure.</p></div><button class="secondary" id="signInButton">Sign in</button>';
  }
}
function scheduleCloudSave() {
  if (!cloudClient || !currentUser) return;
  setSyncStatus('Syncing…', 'syncing');
  clearTimeout(cloudSaveTimer);
  cloudSaveTimer = setTimeout(pushCloudState, 500);
}
async function pushCloudState() {
  if (!cloudClient || !currentUser) return;
  const { error } = await cloudClient.from('game_states').upsert({ user_id: currentUser.id, state, updated_at: new Date().toISOString() });
  if (error) { setSyncStatus('Sync failed'); showToast('Cloud sync failed — saved safely on this device'); }
  else setSyncStatus('Synced', 'synced');
}
async function loadCloudState() {
  setSyncStatus('Syncing…', 'syncing');
  const { data, error } = await cloudClient.from('game_states').select('state').eq('user_id', currentUser.id).maybeSingle();
  if (error) { setSyncStatus('Sync failed'); showToast('Could not load cloud progress'); return; }
  if (data?.state) {
    state = normalizeState(data.state);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    render();
    showToast('Cloud progress loaded');
  } else await pushCloudState();
}
async function initCloud() {
  if (!cloudClient) { renderCloud(); return; }
  cloudClient.auth.onAuthStateChange((event, session) => {
    const previous = currentUser?.id;
    currentUser = session?.user || null;
    if (event === 'PASSWORD_RECOVERY') setTimeout(() => {
      const auth = document.querySelector('#authDialog');
      if (auth.open) auth.close();
      const reset = document.querySelector('#resetPasswordDialog');
      if (!reset.open) reset.showModal();
    }, 0);
    if (currentUser && currentUser.id !== previous) setTimeout(loadCloudState, 0);
    renderCloud();
  });
  const { data } = await cloudClient.auth.getSession();
  currentUser = data.session?.user || null;
  if (currentUser) await loadCloudState(); else renderCloud();
}

function navigate(view) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelector(`#${view}View`).classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === view));
  document.querySelector('.sidebar').classList.remove('open');
  if (view === 'settings') {
    const f = document.querySelector('#settingsForm');
    f.elements.name.value = state.profile.name;
    f.elements.avatar.value = state.profile.avatar;
    f.elements.xpPerLevel.value = state.profile.xpPerLevel;
    f.elements.slotEveryXp.value = state.profile.slotEveryXp || 100;
    f.elements.accent.value = state.profile.accent;
    f.elements.theme.value = state.profile.theme || 'light';
    pendingPhoto = state.profile.photo || '';
    renderPhoto(document.querySelector('#photoPreview'), pendingPhoto, state.profile.avatar);
    f.elements.photo.value = '';
    renderCategoryControls();
  }
  if (view === 'progress') requestAnimationFrame(drawCharts);
}

function updateQuestCoinSuggestion(force = false) {
  const form = document.querySelector('#questForm');
  const coinInput = form.elements.coins;
  if (!force && coinInput.dataset.touched === 'true') return;
  coinInput.value = defaultCoinsFor(Number(form.elements.xp.value), form.elements.repeat.value);
}
function resetQuestForm() {
  editingQuestId = null;
  const form = document.querySelector('#questForm');
  form.reset();
  form.querySelector('#questDialogTitle').textContent = 'Create a quest';
  form.querySelector('#questDialogEyebrow').textContent = 'NEW ADVENTURE';
  form.querySelector('#questSubmitButton').textContent = 'Add to quest log';
  form.querySelector('#repeatDays').hidden = true;
  form.elements.coins.dataset.touched = 'false';
  updateQuestCoinSuggestion(true);
}
function openQuestDialog(id = null) {
  resetQuestForm();
  const form = document.querySelector('#questForm');
  if (id) {
    const q = state.quests.find(x => x.id === id);
    if (!q) return;
    editingQuestId = id;
    form.elements.title.value = q.title;
    form.elements.category.value = q.category;
    form.elements.xp.value = String(q.xp);
    form.elements.coins.value = String(q.coins);
    form.elements.coins.dataset.touched = 'true';
    form.elements.dailyLimit.value = String(completionLimit(q));
    form.elements.repeat.value = q.repeat;
    form.elements.today.checked = Boolean(q.today);
    document.querySelector('#repeatDays').hidden = q.repeat !== 'custom';
    document.querySelectorAll('[name=repeatDays]').forEach(box => box.checked = (q.repeatDays || []).includes(Number(box.value)));
    form.querySelector('#questDialogTitle').textContent = 'Edit quest';
    form.querySelector('#questDialogEyebrow').textContent = 'TUNE ADVENTURE';
    form.querySelector('#questSubmitButton').textContent = 'Save quest';
  }
  document.querySelector('#questDialog').showModal();
}
function openRewardDialog(slot = null) {
  const form = document.querySelector('#rewardForm');
  form.reset();
  pendingRewardIconImage = '';
  form.elements.slot.value = Math.min(12, slot || firstOpenRewardSlot());
  document.querySelector('#rewardIconPreview').innerHTML = iconHtml({ icon: '🎁', iconImage: '' }, 'big-icon');
  document.querySelector('#rewardDialog').showModal();
}
function firstOpenRewardSlot() {
  const slots = unlockedSlots();
  for (let slot = 1; slot <= slots; slot++) if (!state.rewards.some(r => Number(r.slot) === slot)) return slot;
  return Math.min(12, slots);
}

document.querySelectorAll('.nav-item').forEach(b => b.addEventListener('click', () => navigate(b.dataset.view)));
document.querySelector('#menuButton').addEventListener('click', () => document.querySelector('.sidebar').classList.toggle('open'));
document.querySelector('#themeToggle').addEventListener('click', () => {
  state.profile.theme = state.profile.theme === 'dark' ? 'light' : 'dark';
  save();
  showToast(`${state.profile.theme === 'dark' ? 'Dark' : 'Light'} mode enabled`);
});
document.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => {
  if (b.dataset.open === 'quest') openQuestDialog();
  else if (b.dataset.open === 'reward') openRewardDialog();
  else document.querySelector(`#${b.dataset.open}Dialog`).showModal();
}));
document.querySelectorAll('[data-close-dialog]').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));
document.querySelectorAll('dialog').forEach(d => d.addEventListener('click', e => { if (e.target === d) d.close(); }));
document.querySelector('#questDialog').addEventListener('close', resetQuestForm);
document.querySelector('#syncStatus').addEventListener('click', () => cloudConfigured ? document.querySelector('#authDialog').showModal() : navigate('settings'));
document.querySelector('#cloudCard').addEventListener('click', async e => {
  if (e.target.closest('#signInButton')) document.querySelector('#authDialog').showModal();
  if (e.target.closest('#signOutButton')) { await cloudClient.auth.signOut(); showToast('Signed out — progress remains saved locally'); }
});
document.querySelector('#authForm').addEventListener('submit', async e => {
  e.preventDefault();
  if (e.submitter?.value === 'cancel') { document.querySelector('#authDialog').close(); return; }
  const message = document.querySelector('#authMessage');
  const f = new FormData(e.currentTarget);
  const credentials = { email: f.get('email'), password: f.get('password') };
  message.textContent = 'Connecting…';
  const result = e.submitter?.value === 'signup' ? await cloudClient.auth.signUp(credentials) : await cloudClient.auth.signInWithPassword(credentials);
  if (result.error) { message.textContent = result.error.message; return; }
  if (!result.data.session) { message.textContent = 'Check your email to confirm your account, then sign in.'; return; }
  message.textContent = '';
  e.currentTarget.reset();
  document.querySelector('#authDialog').close();
  showToast('Signed in — cloud sync is on');
});
document.querySelector('#forgotPasswordButton').addEventListener('click', async () => {
  const emailInput = document.querySelector('#authForm [name=email]'), message = document.querySelector('#authMessage');
  if (!emailInput.checkValidity()) { emailInput.reportValidity(); return; }
  message.textContent = 'Sending reset email…';
  const redirectTo = `${window.location.origin}${window.location.pathname}`;
  const { error } = await cloudClient.auth.resetPasswordForEmail(emailInput.value.trim(), { redirectTo });
  message.textContent = error ? error.message : 'Reset link sent. Check your email and open the link on this device.';
});
document.querySelector('#resetPasswordForm').addEventListener('submit', async e => {
  e.preventDefault();
  const form = new FormData(e.currentTarget), password = form.get('password'), confirmPassword = form.get('confirmPassword'), message = document.querySelector('#resetPasswordMessage');
  if (password !== confirmPassword) { message.textContent = 'The passwords do not match.'; return; }
  message.textContent = 'Updating password…';
  const { error } = await cloudClient.auth.updateUser({ password });
  if (error) { message.textContent = error.message; return; }
  message.textContent = '';
  e.currentTarget.reset();
  document.querySelector('#resetPasswordDialog').close();
  showToast('Password updated — you are signed in');
});

document.querySelector('#questRepeat').addEventListener('change', e => {
  const custom = e.target.value === 'custom';
  document.querySelector('#repeatDays').hidden = !custom;
  if (custom && !document.querySelector('[name=repeatDays]:checked')) {
    const todayBox = document.querySelector(`[name=repeatDays][value="${new Date().getDay()}"]`);
    if (todayBox) todayBox.checked = true;
  }
  updateQuestCoinSuggestion();
});
document.querySelector('#questForm [name=xp]').addEventListener('change', () => updateQuestCoinSuggestion());
document.querySelector('#questForm [name=coins]').addEventListener('input', e => e.target.dataset.touched = 'true');
document.querySelector('#questForm').addEventListener('submit', e => {
  e.preventDefault();
  const f = new FormData(e.currentTarget);
  const repeat = f.get('repeat'), repeatDays = f.getAll('repeatDays').map(Number);
  if (repeat === 'custom' && !repeatDays.length) { showToast('Choose at least one repeat day'); return; }
  const data = {
    title: f.get('title').trim(),
    category: f.get('category'),
    xp: Number(f.get('xp')),
    coins: Number(f.get('coins')),
    dailyLimit: Math.max(1, Number(f.get('dailyLimit') || 1)),
    repeat,
    repeatDays,
    today: f.has('today')
  };
  if (editingQuestId) {
    const q = state.quests.find(x => x.id === editingQuestId);
    Object.assign(q, data);
    showToast('Quest updated');
  } else {
    state.quests.unshift({ id: uid(), ...data, completed: false, lastCompleted: null, created: today() });
    showToast('Quest added to your adventure');
  }
  document.querySelector('#questDialog').close();
  save();
});

document.querySelector('#rewardIconFile').addEventListener('change', async e => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    pendingRewardIconImage = await resizeImage(file, 160, .82);
    document.querySelector('#rewardIconPreview').innerHTML = iconHtml({ icon: document.querySelector('#rewardForm [name=icon]').value, iconImage: pendingRewardIconImage }, 'big-icon');
    showToast('Reward icon ready');
  } catch (error) {
    e.target.value = '';
    showToast(error.message);
  }
});
document.querySelector('#rewardForm [name=icon]').addEventListener('input', e => {
  if (!pendingRewardIconImage) document.querySelector('#rewardIconPreview').innerHTML = iconHtml({ icon: e.target.value || '🎁' }, 'big-icon');
});
document.querySelector('#rewardForm').addEventListener('submit', e => {
  e.preventDefault();
  const f = new FormData(e.currentTarget);
  const slot = Number(f.get('slot'));
  if (slot < 1 || slot > 12) { showToast('Store slots go from 1 to 12'); return; }
  if (state.rewards.some(r => Number(r.slot) === slot)) { showToast('That store slot already has an item'); return; }
  state.rewards.push({
    id: uid(),
    title: f.get('title').trim(),
    description: f.get('description').trim(),
    slot,
    coinCost: Number(f.get('coinCost')),
    icon: f.get('icon').trim() || '🎁',
    iconImage: pendingRewardIconImage,
    owned: 0
  });
  document.querySelector('#rewardDialog').close();
  save();
  showToast('Store item added');
});

document.addEventListener('click', e => {
  const quest = e.target.closest('.quest');
  if (quest && e.target.closest('.complete-button')) {
    const q = state.quests.find(x => x.id === quest.dataset.id);
    if (!q) return;
    const before = levelInfo().level;
    if (!isQuestComplete(q)) {
      state.totalXp += q.xp;
      state.coins += q.coins;
      q.lastCompleted = today();
      state.history.push({ date: today(), xp: q.xp, coins: q.coins, quest: q.id, category: q.category });
      q.completed = isQuestComplete(q);
    } else {
      const i = state.history.map(h => h.quest === q.id && h.date === today()).lastIndexOf(true);
      if (i >= 0) {
        const removed = state.history[i];
        state.totalXp = Math.max(0, state.totalXp - Number(removed.xp || q.xp));
        state.coins = Math.max(0, state.coins - Number(removed.coins || q.coins));
        state.history.splice(i, 1);
      } else {
        q.completed = false;
      }
      q.lastCompleted = [...state.history].reverse().find(h => h.quest === q.id)?.date || null;
      if (i >= 0) q.completed = isQuestComplete(q);
    }
    save();
    const after = levelInfo().level;
    const count = completionsOn(q);
    const limit = completionLimit(q);
    showToast(after > before ? `Level up! You reached level ${after} ✦` : isQuestComplete(q) ? `Quest complete! ${count}/${limit} today` : `Progress saved: ${count}/${limit} today`);
  } else if (quest && e.target.closest('.more-button')) {
    if (confirm('Delete this quest?')) {
      state.quests = state.quests.filter(x => x.id !== quest.dataset.id);
      save();
    }
  }

  const addSlot = e.target.closest('.add-slot-reward');
  if (addSlot) openRewardDialog(Number(addSlot.dataset.slot));

  const reward = e.target.closest('.reward-card[data-id]');
  if (reward && e.target.closest('.delete-reward')) {
    state.rewards = state.rewards.filter(x => x.id !== reward.dataset.id);
    save();
  } else if (reward && e.target.closest('.buy-reward')) {
    const r = state.rewards.find(x => x.id === reward.dataset.id);
    if (!r) return;
    if (state.coins < r.coinCost) { showToast('Not enough coins yet'); return; }
    state.coins -= r.coinCost;
    r.owned = Number(r.owned || 0) + 1;
    save();
    showToast(`Redeemed +1 ${r.title}`);
  }

  const inventoryItem = e.target.closest('.inventory-item');
  if (inventoryItem && e.target.closest('.use-inventory')) {
    const r = state.rewards.find(x => x.id === inventoryItem.dataset.id);
    if (!r || Number(r.owned || 0) <= 0) return;
    r.owned = Math.max(0, Number(r.owned || 0) - 1);
    save();
    showToast(`Used one ${r.title}`);
  }
});
document.addEventListener('dblclick', e => {
  const quest = e.target.closest('.quest');
  if (quest && !e.target.closest('button')) openQuestDialog(quest.dataset.id);
});
document.querySelector('#questFilters').addEventListener('click', e => {
  if (!e.target.dataset.filter) return;
  activeFilter = e.target.dataset.filter;
  document.querySelectorAll('#questFilters .chip').forEach(c => c.classList.toggle('active', c === e.target));
  renderQuests();
});

document.querySelector('#photoInput').addEventListener('change', async e => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    pendingPhoto = await resizeImage(file, 256, .84);
    renderPhoto(document.querySelector('#photoPreview'), pendingPhoto, state.profile.avatar);
    showToast('Photo ready — save changes to apply it');
  } catch (error) {
    e.target.value = '';
    showToast(error.message);
  }
});
document.querySelector('#removePhotoButton').addEventListener('click', () => {
  pendingPhoto = '';
  document.querySelector('#photoInput').value = '';
  renderPhoto(document.querySelector('#photoPreview'), '', document.querySelector('#settingsForm').avatar.value || 'W');
});
document.querySelector('#settingsForm').addEventListener('submit', e => {
  e.preventDefault();
  const f = new FormData(e.currentTarget);
  state.profile = {
    ...state.profile,
    name: f.get('name').trim(),
    avatar: f.get('avatar').trim(),
    photo: pendingPhoto,
    xpPerLevel: Number(f.get('xpPerLevel')),
    slotEveryXp: Number(f.get('slotEveryXp')),
    accent: f.get('accent'),
    theme: f.get('theme')
  };
  save();
  showToast('Your LifeOS profile has been updated');
});
document.querySelector('#addCategoryButton').addEventListener('click', () => {
  const count = document.querySelectorAll('.category-row').length;
  document.querySelector('#categoryEditor').insertAdjacentHTML('beforeend', categoryRow({ name: `New power ${count + 1}`, icon: '◇', iconImage: '', color: state.profile.accent }));
});
document.querySelector('#categoryEditor').addEventListener('click', e => {
  if (!e.target.closest('.remove-category')) return;
  if (document.querySelectorAll('.category-row').length <= 1) { showToast('Keep at least one category'); return; }
  e.target.closest('.category-row').remove();
});
document.querySelector('#categoryEditor').addEventListener('change', async e => {
  const fileInput = e.target.closest('[name=categoryIconFile]');
  if (!fileInput) return;
  const file = fileInput.files?.[0];
  if (!file) return;
  const row = fileInput.closest('.category-row');
  try {
    const image = await resizeImage(file, 120, .82);
    row.querySelector('[name=iconImage]').value = image;
    row.querySelector('.category-preview').innerHTML = iconHtml({ icon: row.querySelector('[name=icon]').value, iconImage: image }, 'big-icon');
    showToast('Category icon ready — save categories to apply it');
  } catch (error) {
    fileInput.value = '';
    showToast(error.message);
  }
});
document.querySelector('#categoryEditor').addEventListener('input', e => {
  if (e.target.name !== 'icon') return;
  const row = e.target.closest('.category-row');
  if (!row.querySelector('[name=iconImage]').value) row.querySelector('.category-preview').innerHTML = iconHtml({ icon: e.target.value || '◇' }, 'big-icon');
});
document.querySelector('#saveCategoriesButton').addEventListener('click', () => {
  const rows = [...document.querySelectorAll('.category-row')];
  const categories = rows.map(r => ({
    name: r.querySelector('[name=categoryName]').value.trim(),
    icon: r.querySelector('[name=icon]').value.trim() || '◇',
    iconImage: r.querySelector('[name=iconImage]').value,
    color: r.querySelector('[name=categoryColor]').value,
    original: r.dataset.original
  }));
  if (categories.some(c => !c.name)) { showToast('Every category needs a name'); return; }
  if (new Set(categories.map(c => c.name.toLowerCase())).size !== categories.length) { showToast('Category names must be unique'); return; }
  const rename = new Map(categories.filter(c => c.original).map(c => [c.original, c.name]));
  const names = new Set(categories.map(c => c.name));
  const fallback = categories[0].name;
  state.quests.forEach(q => q.category = rename.get(q.category) || (names.has(q.category) ? q.category : fallback));
  state.history.forEach(h => {
    const old = historyCategory(h);
    h.category = rename.get(old) || (names.has(old) ? old : fallback);
  });
  state.categories = categories.map(({ name, icon, iconImage, color }) => ({ name, icon, iconImage, color }));
  save();
  showToast('Categories and character powers updated');
});
document.querySelector('#resetButton').addEventListener('click', () => {
  if (confirm('Erase all progress and start fresh?')) {
    state = structuredClone(defaults);
    save();
    navigate('today');
    showToast('A fresh adventure begins');
  }
});

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (document.querySelector('#progressView').classList.contains('active')) drawCharts(); }, 120);
});
function enhanceNumberInputs() {
  document.querySelectorAll('label input[type="number"]').forEach(input => {
    const label = input.closest('label');
    if (!label || label.querySelector('.number-stepper')) return;
    label.classList.add('number-field');
    const stepper = document.createElement('span');
    stepper.className = 'number-stepper';
    stepper.innerHTML = '<button type="button" aria-label="Increase value">▲</button><button type="button" aria-label="Decrease value">▼</button>';
    const change = direction => {
      if (direction > 0) input.stepUp();
      else input.stepDown();
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    stepper.firstElementChild.addEventListener('click', () => change(1));
    stepper.lastElementChild.addEventListener('click', () => change(-1));
    label.appendChild(stepper);
  });
}
const now = new Date();
document.querySelector('#dateLabel').textContent = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase();
document.querySelector('#dayPeriod').textContent = now.getHours() < 12 ? 'morning' : now.getHours() < 18 ? 'afternoon' : 'evening';
enhanceNumberInputs();
render();
initCloud();
