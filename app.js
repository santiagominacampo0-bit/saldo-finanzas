const { categories: CATEGORIES, normalize: normalizeState, merge: mergeStates, equal: sameState, validDate, positiveAmount } = window.SaldoState;
const CATEGORY_COLORS = ['#87ad89', '#d5a45f', '#8caec0', '#c78e78', '#a895bd', '#77a99c', '#d18778', '#b8a66e', '#8c9ca7'];
const STORE_KEY = 'saldo-personal-v1';
const cloudConfig = window.SALDO_CONFIG || {};
const supabaseClient = window.supabase?.createClient && cloudConfig.supabaseUrl && cloudConfig.publishableKey
  ? window.supabase.createClient(cloudConfig.supabaseUrl, cloudConfig.publishableKey, {
      auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true },
    })
  : null;
const NAV = [
  { id: 'home', label: 'Inicio', icon: 'home' },
  { id: 'movements', label: 'Movimientos', icon: 'arrows' },
  { id: 'budgets', label: 'Presupuestos', icon: 'wallet' },
  { id: 'reports', label: 'Reportes', icon: 'chart' },
  { id: 'account', label: 'Cuenta', icon: 'user' },
];

const ICONS = {
  home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z"/>',
  arrows: '<path d="M7 7h12l-3-3M17 17H5l3 3"/><path d="M19 7a7 7 0 0 1 0 10M5 17A7 7 0 0 1 5 7"/>',
  wallet: '<path d="M4 6.5A2.5 2.5 0 0 1 6.5 4H20v15H6.5A2.5 2.5 0 0 1 4 16.5Z"/><path d="M4 7h14a2 2 0 0 1 2 2v5h-5a2 2 0 0 1 0-4h5"/><path d="M15 12h.01"/>',
  chart: '<path d="M4 19V5M4 19h17"/><path d="m7 15 4-4 3 2 6-7"/><path d="M16 6h4v4"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M5 21v-1a7 7 0 0 1 14 0v1"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  left: '<path d="m15 18-6-6 6-6"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
  up: '<path d="m7 14 5-5 5 5"/>',
  down: '<path d="m7 10 5 5 5-5"/>',
  income: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  expense: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  search: '<circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 4.5 4.5"/>',
  edit: '<path d="m4 16.5-.8 4.3 4.3-.8L19 8.5 15.5 5Z"/><path d="m13.8 6.7 3.5 3.5"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 20h14"/>',
  shield: '<path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z"/><path d="m9 12 2 2 4-4"/>',
  close: '<path d="m18 6-12 12M6 6l12 12"/>',
  dots: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  receipt: '<path d="M5 3h14v18l-3-2-4 2-4-2-3 2Z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
};

const root = document.getElementById('app');
let storageKey = STORE_KEY;
let localWriteFailed = false;
let state = readState(STORE_KEY);
let activeTab = 'home';
let plannerView = 'budgets';
let dataPanelOpen = false;
let deletePanelOpen = false;
let cloudSavedAt = '';
let viewMonth = currentMonth();
let transactionFilter = 'all';
let walletFilter = 'all';
let categoryFilter = 'all';
let calendarRange = 7;
let searchTerm = '';
let modal = null;
let installPrompt = null;
let authUser = null;
let cloudStatus = supabaseClient ? 'local' : 'not-configured';
let devicePushEnabled = false;
let pushPublicKey = '';
let pushConfigPromise = null;
let pushChangePending = false;
let cloudSaveChain = Promise.resolve();
let cloudSaveTimer = null;
let cloudBase = null;
let cloudDirty = false;
let syncConflicts = [];
let cloudReset = false;
let cloudEpoch = 0;
let authBooting = Boolean(supabaseClient);
let guestMode = false;
let authMode = 'signin';
let authEmail = '';
let authMessage = '';
let authBusy = false;
let lastView = '';
let adminStatus = null;
let adminFactor = null;
let adminSummary = null;
let adminLoad = 0;

const blankState = () => normalizeState();
function readLocal(key) {
  try { return JSON.parse(localStorage.getItem(key) || 'null'); }
  catch { return null; }
}

function readState(key) {
  return normalizeState(readLocal(key));
}

function storeState() {
  const payload = authUser ? { state, base: cloudBase, dirty: cloudDirty, reset: cloudReset, lastSave: cloudSavedAt } : state;
  try { localStorage.setItem(storageKey, JSON.stringify(payload)); localWriteFailed = false; return true; }
  catch { localWriteFailed = true; return false; }
}

function persist({ cloud = true } = {}) {
  if (authUser && cloud) cloudDirty = true;
  const saved = storeState();
  if (!saved) toast('El navegador no pudo guardar una copia en este dispositivo.', 'error');
  if (authUser && cloud) queueCloudSave();
  return saved;
}

async function synchronizeUser(userId, epoch) {
  const current = () => authUser?.id === userId && cloudEpoch === epoch;
  if (!current()) return false;
  cloudStatus = 'saving';
  updateCloudStatus();
  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const remoteResult = await supabaseClient.from('saldo_data')
        .select('payload,version,updated_at').eq('user_id', userId).maybeSingle();
      if (!current()) return false;
      if (remoteResult.error) throw remoteResult.error;
      const row = remoteResult.data;
      const remote = normalizeState(row?.payload);
      const local = normalizeState(state);
      const resetting = cloudReset;
      syncConflicts = cloudDirty && !resetting && cloudBase ? window.SaldoState.transactionConflicts(cloudBase, local, remote) : [];
      if (syncConflicts.length) {
        cloudStatus = 'conflict';
        renderAfterSync();
        return false;
      }
      const next = resetting ? local : cloudDirty ? mergeStates(cloudBase || blankState(), local, remote) : remote;

      let savedAt = row?.updated_at || '';
      if ((!row && cloudDirty) || (row && !sameState(next, remote))) {
        const payload = { payload: next, version: (row?.version || 0) + 1, updated_at: new Date().toISOString() };
        if (row) {
          const saved = await supabaseClient.from('saldo_data').update(payload)
            .eq('user_id', userId).eq('version', row.version).select('version').maybeSingle();
          if (saved.error) throw saved.error;
          if (!saved.data) continue;
        } else {
          const saved = await supabaseClient.from('saldo_data').insert({ user_id: userId, ...payload });
          if (saved.error?.code === '23505') continue;
          if (saved.error) throw saved.error;
        }
        savedAt = payload.updated_at;
      }

      if (!current()) return false;
      const latestLocal = normalizeState(state);
      const resetDuringWrite = cloudReset && !resetting;
      const merged = resetDuringWrite ? latestLocal : mergeStates(local, latestLocal, next);
      const changed = !sameState(merged, latestLocal);
      state = merged;
      cloudBase = next;
      cloudSavedAt = savedAt;
      cloudReset = resetDuringWrite;
      cloudDirty = cloudReset || !sameState(merged, next);
      cloudStatus = cloudDirty ? 'pending' : 'synced';
      storeState();
      if (cloudDirty) queueCloudSave();
      if (changed) renderAfterSync();
      else updateCloudStatus();
      return true;
    }
  } catch {
    // Keep the local edits for the next refresh or retry.
  }
  if (current()) { cloudStatus = 'error'; updateCloudStatus(); }
  return false;
}

function renderAfterSync() {
  if (modal || document.activeElement?.matches('input, select, textarea')) {
    updateCloudStatus();
    return;
  }
  render();
}

function saveCloudNow() {
  if (!authUser || !supabaseClient) return Promise.resolve(false);
  window.clearTimeout(cloudSaveTimer);
  const { id } = authUser;
  const epoch = cloudEpoch;
  cloudSaveChain = cloudSaveChain.catch(() => false).then(() => synchronizeUser(id, epoch));
  return cloudSaveChain;
}

function queueCloudSave() {
  if (!authUser || !supabaseClient) return;
  cloudStatus = 'pending';
  updateCloudStatus();
  window.clearTimeout(cloudSaveTimer);
  cloudSaveTimer = window.setTimeout(() => void saveCloudNow(), 400);
}

function handleSignedIn(user) {
  if (!user) return;
  if (authUser?.id === user.id) { authUser = user; return; }
  syncConflicts = [];
  cloudEpoch += 1;
  authUser = user;
  guestMode = false;
  cloudStatus = 'loading';
  localWriteFailed = false;
  storageKey = STORE_KEY + ':user:' + user.id;
  const stored = readLocal(storageKey);
  state = normalizeState(stored?.state ?? stored);
  cloudBase = stored?.base ? normalizeState(stored.base) : null;
  cloudDirty = Boolean(stored?.dirty || (stored && !stored.state));
  cloudReset = Boolean(stored?.reset);
  cloudSavedAt = typeof stored?.lastSave === 'string' ? stored.lastSave : '';
  plannerView = 'budgets';
  walletFilter = categoryFilter = transactionFilter = 'all';
  searchTerm = '';
  calendarRange = 7;
  dataPanelOpen = deletePanelOpen = false;
  activeTab = 'home';
  modal = null;
  render();
  void saveCloudNow();
  void checkAdminAccess();
  void preparePushForDevice();

}

function handleSignedOut() {
  window.clearTimeout(cloudSaveTimer);
  syncConflicts = [];
  cloudEpoch += 1;
  authUser = null;
  devicePushEnabled = false;
  pushPublicKey = '';
  pushConfigPromise = null;
  pushChangePending = false;
  cloudBase = null;
  cloudDirty = false;
  cloudReset = false;
  cloudSavedAt = '';
  plannerView = 'budgets';
  walletFilter = categoryFilter = transactionFilter = 'all';
  searchTerm = '';
  calendarRange = 7;
  dataPanelOpen = deletePanelOpen = false;
  guestMode = false;
  authBooting = false;
  authMode = 'signin';
  authBusy = false;
  adminStatus = adminFactor = adminSummary = null;
  localWriteFailed = false;
  storageKey = STORE_KEY;
  state = readState(STORE_KEY);
  authMessage = '';
  cloudStatus = supabaseClient ? 'local' : 'not-configured';
  activeTab = 'home';
  modal = null;
  render();
}

function initializeCloud() {
  if (!supabaseClient) return;
  const fragment = new URLSearchParams(location.hash.slice(1));
  const authError = fragment.get('error_code') || new URLSearchParams(location.search).get('error_code');
  if (authError) {
    authMessage = 'El enlace de acceso caducó o ya fue utilizado. Puedes solicitar otro.';
    history.replaceState(history.state, '', location.pathname);
  }
  supabaseClient.auth.onAuthStateChange((event, session) => {
    window.setTimeout(() => {
      authBooting = false;
      if (event === 'SIGNED_OUT') { handleSignedOut(); return; }
      if (event === 'PASSWORD_RECOVERY' && session?.user) authMode = 'new-password';
      if (session?.user) {
        handleSignedIn(session.user);
        if (authMode === 'new-password') render();
      } else if (event === 'INITIAL_SESSION') render();
    }, 0);
  });
}

function svg(name, className = '') {
  return `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

function escapeHTML(value = '') {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function currentMonth(date) {
  if (!date) return todayString().slice(0, 7);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function monthDate(month) {
  const [year, number] = month.split('-').map(Number);
  return new Date(year, number - 1, 1, 12);
}

function shiftMonth(month, delta) {
  const date = monthDate(month);
  date.setMonth(date.getMonth() + delta);
  return currentMonth(date);
}

function monthName(month, year = true) {
  return new Intl.DateTimeFormat('es-CO', { month: 'long', ...(year ? { year: 'numeric' } : {}) }).format(monthDate(month));
}

const copFormat = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
function formatMoney(value) {
  return copFormat.format(Number(value) || 0);
}

function formatDate(value, options = { day: 'numeric', month: 'short' }) {
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? 'Fecha sin definir' : new Intl.DateTimeFormat('es-CO', options).format(date);
}

function todayString() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const date = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return date.year + '-' + date.month + '-' + date.day;
}

function transactionsIn(month, type) {
  return state.transactions.filter(tx => tx.date?.slice(0, 7) === month && (!type || tx.type === type));
}

function totalFor(month, type) {
  return transactionsIn(month, type).reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
}

function monthBudgets(month = viewMonth) {
  return state.budgets[month] || {};
}

function spentByCategory(month = viewMonth) {
  const totals = {};
  transactionsIn(month, 'expense').forEach(tx => { totals[tx.category] = (totals[tx.category] || 0) + Number(tx.amount || 0); });
  return totals;
}

function percent(used, total) {
  return total > 0 ? Math.round(used / total * 100) : 0;
}

function progressClass(used, total) {
  if (total <= 0) return '';
  const ratio = used / total;
  return ratio >= 1 ? 'over' : ratio >= .8 ? 'warn' : '';
}

function categoryIcon(category) {
  const map = {
    'Salario': 'income', 'Ventas': 'income', 'Freelance': 'income', 'Inversiones': 'chart',
    'Alimentación': 'receipt', 'Transporte': 'arrows', 'Hogar': 'home', 'Salud': 'shield',
    'Educación': 'receipt', 'Ocio': 'chart', 'Servicios': 'wallet', 'Deudas': 'wallet',
  };
  return map[category] || 'receipt';
}

function navButton(item, mobile = false) {
  const selected = activeTab === item.id || (activeTab === 'admin' && item.id === 'account') || (activeTab === 'rules' && item.id === 'movements');
  return `<button class="nav-button ${selected ? 'active' : ''}" data-tab="${item.id}" aria-label="${item.label}" ${selected ? 'aria-current="page"' : ''}><span class="nav-icon">${svg(item.icon)}</span><span>${item.label}</span></button>`;
}

function shell() {
  const name = state.profile.name.trim();
  const initial = name ? escapeHTML(name[0].toUpperCase()) : 'S';
  const greeting = name ? `Hola, ${escapeHTML(name)}` : 'Hola, ¿cómo vas?';
  const topTitle = activeTab === 'admin' ? 'Panel del dueño' : activeTab === 'rules' ? 'Reglas' : NAV.find(item => item.id === activeTab)?.label || 'Inicio';
  const profileCaption = authUser ? cloudStatusLabel() : 'Este dispositivo';
  const privacyTitle = authUser ? 'Cuenta protegida' : 'Tu información es privada';
  const privacyCopy = authUser ? 'Tus datos se guardan en este dispositivo y se sincronizan con tu cuenta.' : 'Los movimientos permanecen en este dispositivo hasta que inicies sesión.';
  const dateLine = new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
  return `<div class="app-shell">
    <aside class="sidebar">
      <div class="brand"><span class="brand-mark">${brandMark()}</span><span class="brand-word">saldo</span></div>
      <div class="nav-label">Menú</div>
      <nav class="nav-list" aria-label="Principal">${NAV.map(item => navButton(item)).join('')}</nav>
      <div class="sidebar-bottom">
        <div class="privacy-note"><strong>${privacyTitle}</strong>${privacyCopy}</div>
        <div class="profile-chip"><span class="avatar">${initial}</span><span class="profile-info"><span class="profile-name">${escapeHTML(name) || 'Mi perfil'}</span><span class="profile-caption" ${authUser ? 'data-cloud-status' : ''}>${profileCaption}</span></span></div>
      </div>
    </aside>
    <main class="main-area">
      <header class="topbar">
        <div class="topbar-greeting"><p class="eyebrow">${escapeHTML(dateLine)}</p><h1>${activeTab === 'home' ? greeting : topTitle}</h1></div>
        <div class="topbar-actions">
          ${(['home', 'movements', 'reports'].includes(activeTab) || (activeTab === 'budgets' && plannerView === 'budgets')) ? `<div class="month-picker" aria-label="Mes"><button class="icon-button" data-action="prev-month" aria-label="Mes anterior">${svg('left')}</button><span>${escapeHTML(monthName(viewMonth))}</span><button class="icon-button" data-action="next-month" aria-label="Mes siguiente">${svg('right')}</button></div>` : ''}
          <button class="primary-button" data-action="new-transaction">${svg('plus')}<span>Nuevo movimiento</span></button>
        </div>
      </header>
      ${localWriteFailed ? '<section role="alert" class="panel panel-pad"><strong>No se pudo guardar en este dispositivo.</strong><p>Descarga una copia de tus cambios antes de cerrar Saldo.</p><button class="secondary-button" data-action="export-json">Descargar copia</button> <button class="text-button" data-action="retry-local">Reintentar guardado</button></section>' : ''}
      <section class="content ${lastView !== activeTab ? 'view-arrive' : ''}">${renderView()}</section>
    </main>
    <nav class="mobile-nav" aria-label="Principal">${NAV.map(item => navButton(item, true)).join('')}</nav>
    <div class="toast-region" aria-live="polite" aria-atomic="true"></div>
    <div class="install-banner" id="install-banner"><span class="brand-mark">${brandMark()}</span><div class="install-copy"><strong>Instala Saldo</strong><span>Ábrela desde tu pantalla de inicio</span></div><button class="secondary-button" data-action="install-app">Instalar</button><button class="icon-button" data-action="dismiss-install" aria-label="Cerrar">${svg('close')}</button></div>
    ${modal ? renderModal() : ''}
  </div>`;
}

function renderView() {
  if (activeTab === 'movements') return renderMovements();
  if (activeTab === 'rules') return renderCategoryRules();
  if (activeTab === 'budgets') return renderPlanning();
  if (activeTab === 'reports') return renderReports();
  if (activeTab === 'account') return renderAccount();
  if (activeTab === 'admin' && authUser) return renderAdmin();
  return renderHome();
}

function renderHome() {
  const incomes = totalFor(viewMonth, 'income');
  const expenses = totalFor(viewMonth, 'expense');
  const balance = incomes - expenses;
  const today = todayString();
  const expensesPct = percent(expenses, incomes);
  const activity = [
    ...transactionsIn(viewMonth).map(tx => ({ date: tx.date, tx })),
    ...Object.values(state.transfers).filter(tr => tr.date.startsWith(viewMonth)).map(tr => ({ date: tr.date, tr })),
  ].sort((a,b) => b.date.localeCompare(a.date));
  const todayCount = activity.filter(item => item.date === today).length;
  const budgets = monthBudgets();
  const spent = spentByCategory();
  const visibleBudgets = Object.entries(budgets).filter(([, value]) => Number(value) > 0).slice(0, 4);
  const mainGoal = Object.values(state.goals).find(goal => goal.saved < goal.target);
  return `<section class="panel panel-pad home-activity">
    <div class="section-heading"><div><h2>Actividad reciente</h2><p>${viewMonth === today.slice(0,7) ? todayCount + (todayCount === 1 ? ' registro hoy' : ' registros hoy') : escapeHTML(monthName(viewMonth))}</p></div><button class="text-button" data-tab="movements">Ver movimientos</button></div>
    ${activity.length ? activity.slice(0,3).map(item => item.tx ? transactionRow(item.tx) : `<div class="transaction-row"><span class="transaction-symbol">${svg('arrows')}</span><span class="transaction-copy"><span class="transaction-title">${escapeHTML(walletLabel(item.tr.fromId))} → ${escapeHTML(walletLabel(item.tr.toId))}</span><span class="transaction-meta">Transferencia · ${formatDate(item.date)}</span></span><strong>${formatMoney(item.tr.amount)}</strong></div>`).join('') : emptyTransactions('Aún no hay actividad este mes','Registra tu primer ingreso o gasto para empezar.', true)}
  </section><section class="hero-grid">
    <article class="balance-card">
      <div class="balance-top"><span class="balance-label">Balance del mes</span><span class="private-pill">${svg('lock')} <span ${authUser ? 'data-cloud-status' : ''}>${authUser ? cloudStatusLabel() : 'Solo en este dispositivo'}</span></span></div>
      <div class="balance-amount">${formatMoney(balance)}</div>
      <div class="balance-foot"><span>Ingresos menos gastos de ${escapeHTML(monthName(viewMonth))}</span></div>
    </article>
    <div class="month-summary">
      <article class="stat-card"><div class="stat-copy"><div class="stat-label">Ingresos del mes</div><div class="stat-value">${formatMoney(incomes)}</div><div class="stat-meta">${transactionsIn(viewMonth, 'income').length} ${transactionsIn(viewMonth, 'income').length === 1 ? 'registro' : 'registros'}</div></div><span class="stat-icon income">${svg('income')}</span></article>
      <article class="stat-card"><div class="stat-copy"><div class="stat-label">Gastos del mes</div><div class="stat-value">${formatMoney(expenses)}</div><div class="stat-meta">${incomes ? `${expensesPct}% de tus ingresos` : `${transactionsIn(viewMonth, 'expense').length} registros`}</div></div><span class="stat-icon expense">${svg('expense')}</span></article>
    </div>
  </section>
  ${renderForecast()}
  <section class="section-grid">
    <article class="panel panel-pad">
      <div class="section-heading"><div><h2>Metas de ahorro</h2></div><button class="text-button" data-action="planner-view" data-view="goals">Ver metas</button></div>
      ${mainGoal ? `<h3>${escapeHTML(mainGoal.name)}</h3><p>${formatMoney(mainGoal.saved)} de ${formatMoney(mainGoal.target)}</p><progress class="goal-progress" aria-label="Avance de la meta" max="100" value="${window.SaldoPlanning.goalProgress(mainGoal).barPercent}"></progress>` : `<p>${Object.keys(state.goals).length ? 'Alcanzaste tus metas de ahorro.' : 'Define cuánto quieres ahorrar y registra tus aportes.'}</p>`}
    </article>
    <article class="panel panel-pad">
      <div class="section-heading"><div><h2>Presupuestos</h2><p>${escapeHTML(monthName(viewMonth))}</p></div><button class="text-button" data-tab="budgets">Ver todos</button></div>
      ${visibleBudgets.length ? `<div class="budget-mini">${visibleBudgets.map(([category, amount]) => budgetRow(category, amount, spent[category] || 0)).join('')}</div>` : `<div class="empty-state"><span class="empty-icon">${svg('wallet')}</span><h3>Empieza con un presupuesto</h3><p>Define límites por categoría para entender mejor tus gastos.</p><button class="secondary-button" data-tab="budgets">Crear presupuesto</button></div>`}
    </article>
  </section>
  <section class="panel panel-pad"><div class="section-heading"><div><h2>Gastos del mes</h2><p>${Object.keys(spent).length ? 'Mayor categoría · ' + escapeHTML(Object.keys(spent).sort((a,b)=>spent[b]-spent[a])[0]) : 'Los gastos registrados aparecerán aquí.'}</p></div><button class="text-button" data-tab="reports">Ver reportes</button></div>${incomes ? `<p>${expensesPct}% de los ingresos destinado a gastos</p><progress aria-label="Gastos frente a ingresos" max="100" value="${Math.min(100,expensesPct)}"></progress>` : ''}</section>`;
}

function budgetRow(category, amount, used) {
  const ratio = percent(used, amount);
  return `<div class="budget-row"><div class="budget-row-top"><span class="budget-category"><span class="category-dot"></span>${escapeHTML(category)}</span><span class="budget-amount">${formatMoney(used)} de ${formatMoney(amount)}</span></div><div class="progress"><div class="progress-fill ${progressClass(used, amount)}" style="width:${Math.min(100, ratio)}%"></div></div></div>`;
}

function transactionRow(tx, full = false) {
  const isIncome = tx.type === 'income';
  const details = [formatDate(tx.date), tx.merchant, tx.walletId ? walletLabel(tx.walletId) : '', tx.note || (!full ? tx.category : '')].filter(Boolean).join(' · ');
  return `<div class="transaction-row">
    <span class="transaction-symbol ${isIncome ? 'income' : ''}">${svg(categoryIcon(tx.category))}</span>
    <span class="transaction-copy"><span class="transaction-title">${escapeHTML(tx.title || tx.category)}</span><span class="transaction-meta">${escapeHTML(details)}</span></span>
    ${full ? `<span class="row-category">${escapeHTML(tx.category)}</span>` : ''}
    <span class="transaction-amount ${isIncome ? 'income' : ''}">${isIncome ? '+' : '−'}${formatMoney(tx.amount)}<span class="transaction-date">${escapeHTML(formatDate(tx.date))}</span></span>
    ${full ? `<button class="more-button" data-action="edit-transaction" data-id="${escapeHTML(tx.id)}" aria-label="Editar ${escapeHTML(tx.title)}">${svg('dots')}</button>` : ''}
  </div>`;
}

function emptyTransactions(title, message, withButton = false) {
  return `<div class="empty-state"><span class="empty-icon">${svg('receipt')}</span><h3>${escapeHTML(title)}</h3><p>${escapeHTML(message)}</p>${withButton ? `<button class="secondary-button" data-action="new-transaction">${svg('plus')} Añadir movimiento</button>` : ''}</div>`;
}

function renderMovements() {
  const filtered = visibleMovements();
  const total = filtered.reduce((sum, tx) => sum + (tx.type === 'income' ? 1 : -1) * Number(tx.amount), 0);
  return `<div class="page-title-row"><div><h2>Todos tus movimientos</h2><p>Revisa y organiza lo que entra y sale de tu bolsillo.</p></div><div class="movement-actions"><button class="secondary-button" data-action="category-rules">Reglas de categorías</button><button class="secondary-button" data-action="export-csv">${svg('download')} Exportar CSV</button></div></div>
    <div class="toolbar"><div class="filter-group">${[['all', 'Todos'], ['income', 'Ingresos'], ['expense', 'Gastos']].map(([id, label]) => `<button class="filter-chip ${transactionFilter === id ? 'active' : ''}" data-action="filter-transactions" data-filter="${id}">${label}</button>`).join('')}</div><label class="search-wrap">${svg('search')}<input id="movement-search" aria-label="Buscar movimiento" placeholder="Buscar movimiento" value="${escapeHTML(searchTerm)}" /></label></div>
    ${renderMovementFilters()}
    <div class="panel"><div class="table-head"><span>Movimiento</span><span>Categoría</span><span>Valor</span><span></span></div><div class="movement-list">${filtered.length ? filtered.map(tx => transactionRow(tx, true)).join('') : emptyTransactions('No hay resultados', searchTerm || walletFilter !== 'all' || categoryFilter !== 'all' || transactionFilter !== 'all' ? 'Prueba con otra búsqueda o cambia los filtros.' : 'Registra tu primer movimiento para verlo aquí.', !searchTerm && walletFilter === 'all' && categoryFilter === 'all')}</div>${filtered.length ? `<div class="movement-total"><span>Balance de la lista</span><strong>${formatMoney(total)}</strong></div>` : ''}</div>`;
}

function renderBudgets() {
  const budgets = monthBudgets();
  const spent = spentByCategory();
  const allCats = CATEGORIES.expense;
  const totalBudget = Object.values(budgets).reduce((sum, value) => sum + Number(value || 0), 0);
  const totalSpent = Object.keys(budgets).reduce((sum, category) => sum + (spent[category] || 0), 0);
  const unbudgeted = totalFor(viewMonth, 'expense') - totalSpent;
  const remaining = totalBudget - totalSpent;
  return `<div class="page-title-row"><div><h2>Presupuestos por categoría</h2><p>Define un límite mensual para cada categoría.</p></div></div>
    <article class="budget-total-card"><div><div class="budget-total-label">Límite definido para ${escapeHTML(monthName(viewMonth))}</div><div class="budget-total-value">${formatMoney(totalBudget)}</div></div><div class="budget-total-right"><span>Gastado con presupuesto</span><strong>${formatMoney(totalSpent)}</strong><span style="margin-top:5px">${totalBudget ? `${formatMoney(Math.abs(remaining))} ${remaining >= 0 ? 'disponibles' : 'por encima'}` : 'Define tus límites'}</span></div></article>
    ${unbudgeted > 0 ? `<p class="plan-context">Gastos sin presupuesto: <strong>${formatMoney(unbudgeted)}</strong></p>` : ''}
    <div class="budget-cards">${allCats.map((category, index) => {
      const amount = Number(budgets[category] || 0);
      const used = spent[category] || 0;
      const ratio = percent(used, amount);
      return `<article class="budget-card"><div class="budget-card-head"><span class="budget-card-title"><span class="category-dot" style="background:${CATEGORY_COLORS[index % CATEGORY_COLORS.length]}"></span>${escapeHTML(category)}</span><button class="budget-edit" data-action="edit-budget" data-category="${escapeHTML(category)}" aria-label="Editar presupuesto de ${escapeHTML(category)}">${svg('edit')}</button></div><div class="budget-card-value">${amount ? `${formatMoney(used)} de ${formatMoney(amount)}` : 'Sin límite definido'}</div><div class="progress" style="margin-top:10px"><div class="progress-fill ${progressClass(used, amount)}" style="width:${Math.min(100, ratio)}%"></div></div><div class="budget-card-foot"><span>${amount ? `${ratio}% utilizado` : `${formatMoney(used)} registrados`}</span><button class="text-button" data-action="edit-budget" data-category="${escapeHTML(category)}">${amount ? 'Cambiar' : 'Definir'}</button></div></article>`;
    }).join('')}</div>`;
}

function renderReports() {
  const income = totalFor(viewMonth, 'income');
  const expense = totalFor(viewMonth, 'expense');
  const net = income - expense;
  const months = Array.from({ length: 6 }, (_, index) => shiftMonth(viewMonth, index - 5));
  const totals = Object.fromEntries(months.map(month => [month, { income: 0, expense: 0 }]));
  const today = todayString();
  let spentThroughToday = 0;
  for (const tx of state.transactions) {
    const month = tx.date.slice(0, 7);
    if (totals[month]) totals[month][tx.type] += tx.amount;
    if (month === viewMonth && tx.type === 'expense' && tx.date <= today) spentThroughToday += tx.amount;
  }
  const max = Math.max(1, ...Object.values(totals).flatMap(row => [row.income, row.expense]));
  const hasSixMonthData = Object.values(totals).some(row => row.income || row.expense);
  const days = viewMonth === today.slice(0, 7) ? Number(today.slice(-2)) : new Date(Number(viewMonth.slice(0,4)), Number(viewMonth.slice(5)), 0).getDate();
  const previous = totals[months.at(-2)];
  const byCategory = spentByCategory();
  const categories = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);
  return `<div class="page-title-row"><div><h2>Panorama de tus finanzas</h2><p>Resumen de ${escapeHTML(monthName(viewMonth))} según los movimientos que registraste.</p></div></div>
    <div class="report-kpis"><article class="report-kpi"><span>Ingresos</span><strong class="positive">${formatMoney(income)}</strong></article><article class="report-kpi"><span>Gastos</span><strong>${formatMoney(expense)}</strong></article><article class="report-kpi"><span>Balance del mes</span><strong class="${net >= 0 ? 'positive' : 'negative'}">${formatMoney(net)}</strong></article></div>
    <div class="report-kpis"><article class="report-kpi"><span>Gasto diario promedio</span><strong>${viewMonth <= today.slice(0,7) ? formatMoney(spentThroughToday / days) : 'Sin días transcurridos'}</strong></article><article class="report-kpi"><span>Balance del mes anterior</span><strong>${formatMoney(previous.income - previous.expense)}</strong></article></div>
    <div class="report-grid"><article class="panel panel-pad"><div class="section-heading"><div><h2>Ingresos y gastos</h2><p>Últimos seis meses registrados en COP</p></div></div>${hasSixMonthData ? `<div class="report-chart" role="img" aria-label="Comparación de ingresos y gastos mensuales">${months.map(month => {
      const { income: inc, expense: exp } = totals[month];
      const hi = inc ? Math.max(5, Math.round(inc / max * 164)) : 2;
      const he = exp ? Math.max(5, Math.round(exp / max * 164)) : 2;
      return `<div class="report-bar-group"><div class="report-bars"><span class="report-bar income" style="height:${hi}px" title="Ingresos ${formatMoney(inc)}"></span><span class="report-bar expense" style="height:${he}px" title="Gastos ${formatMoney(exp)}"></span></div><span class="report-month">${escapeHTML(monthName(month, false).slice(0, 3))}</span></div>`;
    }).join('')}</div><div class="legend"><span class="legend-item"><span class="legend-dot"></span>Ingresos</span><span class="legend-item"><span class="legend-dot expense"></span>Gastos</span></div>` : `<div class="chart-empty"><span class="empty-icon">${svg('chart')}</span><p>Registra movimientos para comparar los últimos seis meses.</p></div>`}</article>
      <article class="panel panel-pad"><div class="section-heading"><div><h2>Gastos por categoría</h2><p>${escapeHTML(monthName(viewMonth))}</p></div></div>${categories.length ? `<div class="category-list">${categories.map(([category, amount], index) => `<div class="category-row"><span class="category-row-name"><span class="category-dot" style="background:${CATEGORY_COLORS[index % CATEGORY_COLORS.length]}"></span>${escapeHTML(category)}</span><span class="category-row-value">${formatMoney(amount)}</span><span class="category-track"><span style="width:${expense ? Math.max(3, Math.round(amount / expense * 100)) : 0}%;background:${CATEGORY_COLORS[index % CATEGORY_COLORS.length]}"></span></span></div>`).join('')}</div>` : emptyTransactions('Todavía no hay gastos', 'Cuando registres gastos, aquí verás en qué categorías se concentran.')}</article></div>`;
}

function brandMark() {
  return '<img src="./icons/saldo.svg?v=7" alt="" width="36" height="36" />';
}

function renderSyncChoices() {
  const details = tx => tx ? [tx.title, formatMoney(tx.amount), tx.date, tx.type === 'income' ? 'Ingreso' : 'Gasto', tx.category, walletLabel(tx.walletId), tx.merchant, tx.note].filter(Boolean).join(' · ') : 'Movimiento eliminado';
  return syncConflicts.map(item => `<section class="form-section"><h3>Dos cambios en el mismo movimiento</h3>
    <p>Elige qué versión guardar en tu cuenta.</p>${['device','cloud'].map(source => `<p>${source === 'device' ? 'Este dispositivo' : 'Nube'} · ${escapeHTML(details(item[source]))}</p>
    <button class="secondary-button" data-action="resolve-sync" data-source="${source}" data-id="${escapeHTML(item.id)}">${source === 'device' ? 'Usar este dispositivo' : 'Usar la nube'}</button>`).join('')}</section>`).join('');
}

function resolveSync(button) {
  const item = syncConflicts.find(entry => entry.id === button.dataset.id);
  if (!authUser || !item || !cloudBase) return;
  const replace = (rows, tx) => rows.filter(row => row.id !== item.id).concat(tx ? [tx] : []);
  cloudBase.transactions = replace(cloudBase.transactions, item.cloud);
  if (button.dataset.source === 'cloud') state.transactions = replace(state.transactions, item.cloud);
  syncConflicts = syncConflicts.filter(entry => entry.id !== item.id);
  persist();
  render();
}

function cloudStatusLabel() {
  return ({
    loading: 'Conectando…', pending: 'Cambios pendientes', saving: 'Sincronizando…',
    conflict: 'Revisa los cambios en Cuenta', synced: 'Sincronizado', error: 'Sin conexión con la nube', local: 'Solo en este dispositivo',
    'not-configured': 'Conexión no configurada',
  })[cloudStatus];
}

function lastCloudSaveLabel() {
  const date = new Date(cloudSavedAt);
  if (!cloudSavedAt || !Number.isFinite(date.valueOf())) return 'Aún no hay cambios guardados en la nube.';
  return 'Último guardado en la nube: ' + new Intl.DateTimeFormat('es-CO', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Bogota',
  }).format(date);
}

function updateCloudStatus() {
  root.querySelectorAll('[data-cloud-status]').forEach(item => { item.textContent = cloudStatusLabel(); });
  root.querySelectorAll('[data-cloud-saved-at]').forEach(item => { item.textContent = lastCloudSaveLabel(); });
}

const authViews = {
  signin: ['Inicia sesión', 'Abre tu cuenta de Saldo.', 'Iniciar sesión'],
  signup: ['Crea tu cuenta', 'Confirma tu correo para sincronizar tus movimientos.', 'Crear cuenta'],
  recovery: ['Recupera tu cuenta', 'Te enviaremos un enlace a tu correo.', 'Enviar enlace'],
  'new-password': ['Elige una contraseña nueva', 'Usa al menos 8 caracteres.', 'Guardar contraseña'],
};

function renderAuth() {
  const [title, description, submit] = authViews[authMode];
  const changing = authMode === 'new-password';
  const needsPassword = authMode !== 'recovery';
  const authForm = authBooting
    ? '<p role="status">Estamos abriendo Saldo…</p>'
    : !supabaseClient
      ? '<p role="status">La conexión a la cuenta no está disponible.</p>'
      : `<form id="auth-form" class="auth-panel">
          <div class="form-grid">
            ${changing ? '' : `<div class="field full"><label for="auth-email">Correo electrónico</label><input id="auth-email" name="email" type="email" autocomplete="username" inputmode="email" maxlength="254" required value="${escapeHTML(authEmail)}" /></div>`}
            ${needsPassword ? `<div class="field full"><label for="auth-password">Contraseña</label><input id="auth-password" name="password" type="password" autocomplete="${authMode === 'signup' || changing ? 'new-password' : 'current-password'}" ${authMode === 'signup' || changing ? 'minlength="8"' : ''} maxlength="128" required /></div>` : ''}
            ${changing ? '<div class="field full"><label for="auth-confirm">Repite la contraseña</label><input id="auth-confirm" name="confirm" type="password" minlength="8" maxlength="128" autocomplete="new-password" required /></div>' : ''}
          </div>
          ${authMode === 'signin' ? '<button class="text-button" type="button" data-action="auth-mode" data-mode="recovery">Olvidé mi contraseña</button>' : ''}
          <p class="auth-feedback" id="auth-feedback" role="status">${escapeHTML(authMessage)}</p>
          <button class="primary-button" type="submit" ${authBusy ? 'disabled' : ''}>${authBusy ? 'Un momento…' : submit}</button>
        </form>`;
  return `<main class="auth-shell">
    <section class="auth-intro" aria-label="Saldo">
      <span class="auth-hero-mark">${brandMark()}</span>
      <p class="brand-word">saldo</p><h1>Tus finanzas, claras.</h1>
      <p>Organiza tus ingresos, gastos y presupuestos en pesos colombianos.</p>
    </section>
    <section class="auth-card" aria-labelledby="auth-title">
      ${['signin', 'signup'].includes(authMode) && !authBooting ? `<div class="auth-mode-switch" aria-label="Acceso a Saldo"><button type="button" data-action="auth-mode" data-mode="signin" aria-pressed="${authMode === 'signin'}">Ingresar</button><button type="button" data-action="auth-mode" data-mode="signup" aria-pressed="${authMode === 'signup'}">Crear cuenta</button></div>` : ''}
      <h2 id="auth-title">${title}</h2><p>${description}</p>
      ${authForm}
      <div class="auth-actions">
        ${changing || authBooting ? '' : authMode === 'signin' ? '<button class="secondary-button" data-action="guest">Usar en este dispositivo</button>' : authMode === 'signup' ? '' : '<button class="text-button" data-action="auth-mode" data-mode="signin">Volver al inicio de sesión</button>'}
        ${changing ? '<button class="text-button" data-action="sign-out">Cancelar y cerrar sesión</button>' : ''}
      </div>
      <footer class="auth-footer"><a class="text-button" href="./privacy.html">Privacidad</a></footer>
    </section>
    <div class="toast-region" aria-live="polite" aria-atomic="true"></div>
  </main>`;
}

async function checkAdminAccess() {
  if (!authUser) return null;
  const userId = authUser.id;
  const { data, error } = await supabaseClient.rpc('saldo_admin_access');
  if (authUser?.id !== userId || error) return null;
  adminStatus = data;
  if (activeTab === 'account' && !document.activeElement?.matches('input, select, textarea')) render();
  return data;
}

async function openAdmin() {
  const ownerId = authUser?.id;
  if (!ownerId) return;
  const load = ++adminLoad;
  const viewingPanel = () => activeTab === 'admin' && authUser?.id === ownerId && adminLoad === load;

  activeTab = 'admin';
  adminStatus = adminFactor = adminSummary = null;
  render();
  const access = await checkAdminAccess();
  if (!viewingPanel()) return;
  if (!access) { adminStatus = { unavailable: true }; render(); return; }
  if (access.allowed && access.verified) {
    const { data } = await supabaseClient.rpc('saldo_admin_summary');
    if (!viewingPanel()) return;
    adminSummary = data || { unavailable: true };
  } else if (access.allowed) {
    const { data } = await supabaseClient.auth.mfa.listFactors();
    if (!viewingPanel()) return;
    adminFactor = data?.totp?.find(factor => factor.status === 'verified') || null;
  }
  render();
}

function ownerQrSource(value) {
  if (typeof value !== 'string' || value.length > 150000) return '';
  if (value.startsWith('data:image/svg+xml;') || value.startsWith('data:image/svg+xml,')) return value;
  if (/^<svg[\s>]/.test(value.trim())) return 'data:image/svg+xml,' + encodeURIComponent(value);
  return '';
}

async function enrollAdminFactor(button) {
  if (!authUser || !adminStatus?.allowed || adminFactor || button.disabled) return;
  const ownerId = authUser.id;
  button.disabled = true;
  try {
    const factors = await supabaseClient.auth.mfa.listFactors();
    if (activeTab !== 'admin' || authUser?.id !== ownerId) return;
    if (factors.error) throw factors.error;
    const existing = factors.data?.totp?.find(factor => factor.status === 'verified');
    if (existing) { adminFactor = existing; render(); return; }

    // If setup was abandoned before confirmation, replace only Saldo's unused factor.
    const abandoned = factors.data?.all?.find(factor => factor.factor_type === 'totp'
      && factor.status === 'unverified' && factor.friendly_name === 'Saldo');
    if (abandoned) {
      const removed = await supabaseClient.auth.mfa.unenroll({ factorId: abandoned.id });
      if (removed.error) throw removed.error;
    }
    const { data, error } = await supabaseClient.auth.mfa.enroll({
      factorType: 'totp', friendlyName: 'Saldo', issuer: 'Saldo',
    });
    if (activeTab !== 'admin' || authUser?.id !== ownerId) return;
    if (error || !data?.totp?.secret) throw error || new Error('Falta la clave del autenticador');
    adminFactor = { id: data.id, secret: data.totp.secret, qr: ownerQrSource(data.totp.qr_code) };
    render();
  } catch {
    toast('No pudimos preparar la verificación. Revisa tu conexión e inténtalo otra vez.', 'error');
  } finally {
    button.disabled = false;
  }
}

async function copyOwnerKey() {
  if (!adminStatus?.allowed || !adminFactor?.secret || activeTab !== 'admin') return;
  try {
    await navigator.clipboard.writeText(adminFactor.secret);
    toast('Clave copiada. Pégala en tu app de códigos.');
  } catch {
    const key = root.querySelector('#owner-secret');
    key?.focus();
    key?.select();
    toast('Seleccioné la clave para que puedas copiarla.', 'info');
  }
}

function renderOwnerSetup() {
  const qr = adminFactor.qr
    ? `<article class="owner-method"><h3>Saldo abierto en el portátil</h3><p>En tu teléfono, abre la app de códigos, toca <strong>+</strong> y elige escanear un código QR. Apunta la cámara a esta imagen.</p><img class="owner-qr" src="${escapeHTML(adminFactor.qr)}" alt="Código QR para vincular Saldo" width="180" height="180" /></article>`
    : '';
  return `<div class="owner-methods">${qr}<article class="owner-method">
    <h3>Todo desde el mismo teléfono</h3>
    <p>Usa una app de códigos como Google Authenticator. En esa app, toca <strong>+</strong> y elige <strong>Introducir clave de configuración</strong>. Ponle el nombre <strong>Saldo</strong> y pega esta clave. Si te pregunta el tipo, elige <strong>Basado en tiempo</strong>.</p>
    <details><summary>Ver y copiar la clave</summary><div class="field"><label for="owner-secret">Clave de configuración</label><input id="owner-secret" type="text" value="${escapeHTML(adminFactor.secret)}" readonly autocomplete="off" spellcheck="false" /></div><button class="secondary-button" data-action="admin-copy">Copiar clave</button></details>
    </article></div><p>Cuando tu app de códigos muestre seis dígitos junto a Saldo, escríbelos abajo.</p>`;
}

async function verifyAdminCode(form) {
  if (!adminFactor || !adminStatus?.allowed || !form.reportValidity()) return;
  const code = String(new FormData(form).get('code') || '').trim();
  const submit = form.querySelector('button[type="submit"]');
  submit.disabled = true;
  const { error } = await supabaseClient.auth.mfa.challengeAndVerify({ factorId: adminFactor.id, code });
  submit.disabled = false;
  if (error) { toast('Código inválido o vencido.', 'error'); return; }
  void openAdmin();
}

function renderAdmin() {
  let content = '<p role="status">Verificando acceso…</p>';
  if (adminStatus?.unavailable) content = '<p role="status">No pudimos consultar los permisos.</p>';
  else if (adminStatus && !adminStatus.allowed) content = '<p>Esta cuenta no tiene acceso al panel administrativo.</p>';
  else if (adminStatus?.allowed && !adminStatus.verified) {
    const enroll = adminFactor?.secret ? renderOwnerSetup() : '<p>Abre tu app de códigos y busca Saldo. Escribe el código vigente de seis dígitos.</p>';
    content = adminFactor
      ? `${enroll}<form id="admin-code-form"><div class="field"><label for="admin-code">Código de seis dígitos</label><input id="admin-code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required /></div><div class="account-actions"><button class="primary-button" type="submit">Verificar código</button></div></form>`
      : '<p>El panel pide un código adicional. Una app de autenticación, como Google Authenticator, genera ese código en tu teléfono. Vincúlala una sola vez.</p><button class="primary-button" data-action="admin-enroll">Vincular autenticador</button>';
  } else if (adminSummary?.unavailable) content = '<p role="status">No pudimos cargar los indicadores.</p>';
  else if (adminSummary) content = renderOwnerDiagnostics(adminSummary);
  else if (adminStatus?.verified) content = '<p role="status">Cargando indicadores…</p>';
  const refresh = adminSummary || adminStatus?.unavailable
    ? '<button class="secondary-button" data-action="admin-open">Actualizar indicadores</button>' : '';
  return `<section class="panel panel-pad owner-panel"><div class="section-heading"><div><h2>Panel del dueño</h2><p>Actividad de cuentas, sincronización y avisos</p></div>${refresh}</div>
    ${content}<div class="account-actions"><button class="text-button" data-action="admin-return">Volver a Cuenta</button></div></section>`;
}

function renderAccount() {
  const name = state.profile.name || '';
  const reminders = state.settings.remindersEnabled;
  const notifications = state.settings.notificationsEnabled;
  const pushEnabled = Boolean(authUser && devicePushEnabled);
  const pushSupported = 'PushManager' in window && 'Notification' in window && 'serviceWorker' in navigator;
  const pushDescription = !authUser ? 'Inicia sesión para configurar avisos en segundo plano.'
    : !pushSupported ? 'En iPhone abre Saldo desde la pantalla de inicio. En Android, usa Chrome.'
    : !pushPublicKey ? 'El servicio de avisos todavía no está disponible.'
    : 'Recibe avisos aunque Saldo esté cerrada.';
  const statusLabel = cloudStatusLabel();
  const local = readState(STORE_KEY);
  const hasLocalRecords = local.transactions.length || ['budgets','wallets','transfers','recurring','goals','categoryRules'].some(key => Object.keys(local[key]).length) || local.profile.name;
  const authPanel = authUser
    ? `<section class="form-section"><h3>Cuenta y sincronización</h3><p>Abre esta cuenta en tus dispositivos para ver tus movimientos.</p><div class="cloud-account"><span class="avatar">${svg('user')}</span><span><strong>${escapeHTML(authUser.email || 'Cuenta Saldo')}</strong><small data-cloud-status>${statusLabel}</small><small data-cloud-saved-at>${escapeHTML(lastCloudSaveLabel())}</small></span></div><div class="account-actions"><button class="secondary-button" data-action="sync-now">Sincronizar ahora</button><button class="secondary-button" data-action="sign-out">Cerrar sesión</button>${adminStatus?.allowed ? '<button class="secondary-button" data-action="admin-open">Panel del dueño</button>' : ''}${hasLocalRecords ? '<button class="text-button" data-action="import-local">Importar datos de invitado</button>' : ''}</div>${renderSyncChoices()}</section>`
    : `<section class="form-section"><h3>Cuenta y sincronización</h3><p>Inicia sesión para guardar una copia en la nube y sincronizar tus dispositivos.</p><div class="account-actions"><button class="primary-button" data-action="auth-mode" data-mode="signin">Iniciar sesión</button><button class="secondary-button" data-action="auth-mode" data-mode="signup">Crear cuenta</button></div></section>`;
  const privacyTitle = authUser ? 'Tus datos están vinculados a tu cuenta' : 'Tus movimientos permanecen en este navegador';
  const privacyCopy = authUser ? 'Saldo conserva una copia local y sincroniza tus registros con tu cuenta autenticada. Puedes cerrar sesión para ocultarlos en este dispositivo.' : 'Al iniciar sesión, podrás recuperar tus datos en otro dispositivo. Sin cuenta, usa la copia de seguridad antes de cambiar de teléfono.';
  return `<div class="page-title-row"><div><h2>Tu cuenta y preferencias</h2><p>Configura tu perfil, tus avisos y tus copias de seguridad.</p></div><span class="local-badge">${svg('lock')} <span ${authUser ? 'data-cloud-status' : ''}>${authUser ? statusLabel : 'Perfil local'}</span></span></div>
    <div class="profile-layout"><div class="panel">
      ${authPanel}
      <section class="form-section"><h3>Apariencia</h3><div class="field theme-picker">
        <label for="saldo-theme">Tema</label>
        <select id="saldo-theme" aria-describedby="theme-help">${[['system', 'Como el dispositivo'], ['light', 'Claro'], ['dark', 'Oscuro']].map(([value, label]) => `<option value="${value}" ${window.SaldoTheme.preference() === value ? 'selected' : ''}>${label}</option>`).join('')}</select>
        <small id="theme-help" class="field-help">Tu elección se guarda en este dispositivo.</small>
      </div></section>
      <section class="form-section"><h3>Mi perfil</h3><p>El nombre solo se usa para personalizar el saludo en este dispositivo.</p><form id="profile-form"><div class="form-grid"><div class="field full"><label for="profile-name">¿Cómo te llamamos?</label><input id="profile-name" name="name" maxlength="48" value="${escapeHTML(name)}" placeholder="Tu nombre" autocomplete="name" /></div><div class="field"><label>Moneda</label><input value="Peso colombiano (COP)" disabled aria-label="Moneda peso colombiano" /></div><div class="field"><label>Registros guardados</label><input value="${state.transactions.length}" disabled aria-label="Cantidad de movimientos" /></div></div><div class="form-actions"><button class="primary-button" type="submit">Guardar perfil</button></div></form></section>
      <section class="form-section"><h3>Recordatorios</h3><p>Elige cuándo quieres recibir avisos de presupuesto y recordatorios.</p>
        <div class="setting-row"><div><strong>Avisos de presupuesto</strong><small>Te avisa cuando un gasto registrado alcanza el 80% o supera un presupuesto.</small></div><button class="switch ${notifications ? 'on' : ''}" data-action="toggle-notifications" role="switch" aria-checked="${notifications}" aria-label="Activar avisos de presupuesto"></button></div>
        <div class="setting-row"><div><strong>Notificaciones push</strong><small>${pushDescription}</small></div><button class="switch ${pushEnabled ? 'on' : ''}" data-action="toggle-push" role="switch" aria-checked="${pushEnabled}" aria-label="Activar notificaciones push" ${authUser && pushSupported && pushPublicKey && !pushChangePending ? '' : 'disabled'}></button></div>
        <div class="setting-row"><div><strong>Recordatorio mensual</strong><small>Te invita a revisar tus movimientos en el día y hora que elijas.</small></div><button class="switch ${reminders ? 'on' : ''}" data-action="toggle-reminders" role="switch" aria-checked="${reminders}" aria-label="Activar recordatorio mensual"></button></div>
        <div class="reminder-controls"><label>Día del mes<select name="reminder-day" id="reminder-day">${Array.from({ length: 28 }, (_, i) => i + 1).map(day => `<option value="${day}" ${String(day) === String(state.settings.reminderDay) ? 'selected' : ''}>${day}</option>`).join('')}</select></label><label>Hora aproximada<input id="reminder-time" required type="time" value="${escapeHTML(state.settings.reminderTime)}" /></label></div>
        <div class="account-actions"><button class="secondary-button" data-action="test-notification">${svg('bell')} Enviar aviso de prueba</button></div>
      </section>
      <section class="form-section">
        <details class="account-details" id="data-panel" ${dataPanelOpen ? 'open' : ''}>
          <summary>Datos y copias</summary><p>Descarga una copia de tus datos y reglas de categorías.</p>
          <div class="account-actions"><button class="secondary-button" data-action="export-json">${svg('download')} Descargar copia</button><button class="secondary-button" data-action="import-json">Restaurar copia</button><input hidden id="import-file" type="file" accept="application/json,.json" /></div>
          <details class="account-details account-delete" id="delete-panel" ${deletePanelOpen ? 'open' : ''}><summary>Borrar datos</summary><p>Vacía los datos de Saldo. Tu cuenta de acceso se conserva.</p><button class="danger-button" data-action="clear-data">Borrar todos mis datos</button></details>
        </details>
      </section>
    </div>
    <aside class="panel panel-pad"><div class="section-heading"><div><h2>Privacidad y conexión</h2><p>Tu información se usa solo para las funciones de Saldo.</p></div></div><div class="muted-panel"><strong>${svg('shield')} ${privacyTitle}</strong><p>${privacyCopy} Saldo no lee tus cuentas bancarias ni procesa pagos.</p></div><div class="setting-row"><div><strong>Sincronización</strong><small>${authUser ? 'Tus movimientos, presupuestos y preferencias se sincronizan al iniciar sesión.' : 'Los datos permanecen locales hasta que inicies sesión.'}</small></div></div><div class="setting-row"><div><strong>Avisos con la app cerrada</strong><small>${pushEnabled ? 'Push está activado para este dispositivo.' : 'El permiso del teléfono se solicita al activar push.'}</small></div></div><div class="account-actions"><a class="text-button" href="./privacy.html">Política de privacidad</a><button class="text-button" data-action="install-help">Cómo instalar en mi teléfono</button></div></aside></div>`;
}

function renderModal() {
  if (modal.type === 'budget') return renderBudgetModal();
  if (modal.type === 'transaction') return renderTransactionModal();
  if (modal.type === 'planning') return renderToolModal();
  return '';
}

function renderTransactionModal() {
  const existing = modal.id ? state.transactions.find(tx => tx.id === modal.id) : null;
  const draft = modal.fields || existing || {};
  const type = modal.draftType || existing?.type || 'expense';
  const category = modal.category || existing?.category || CATEGORIES[type].at(-1);
  const walletId = modal.walletId || existing?.walletId || preferredWallet();
  const walletField = Object.keys(state.wallets).length
    ? toolSelect('tx-wallet', 'walletId', 'Bolsillo', walletOptions(walletId))
    : '';
  const label = existing ? 'Editar movimiento' : modal.duplicate ? 'Duplicar movimiento' : 'Nuevo movimiento';
  return `<div class="modal-backdrop" data-action="backdrop-close"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
    <div class="modal-header"><div><h2 id="modal-title">${label}</h2><p>${modal.duplicate ? 'Revisa los datos de la copia antes de guardarla.' : 'Registra una entrada o salida de dinero.'}</p></div>
    <button class="icon-button" data-action="close-modal" aria-label="Cerrar">${svg('close')}</button></div>
    <div class="modal-body">
      <div class="type-switch"><button class="type-choice ${type === 'income' ? 'active income' : ''}" data-action="set-type" data-type="income">Ingreso</button><button class="type-choice ${type === 'expense' ? 'active expense' : ''}" data-action="set-type" data-type="expense">Gasto</button></div>
      <form id="transaction-form" class="modal-form">
        <input type="hidden" name="type" value="${type}" />
        <div class="field field-amount"><label for="tx-amount">Valor en pesos</label><input id="tx-amount" name="amount" type="number" inputmode="numeric" min="1" max="999999999999" step="1" required value="${escapeHTML(draft.amount ?? '')}" placeholder="0" /></div>
        <div class="field"><label for="tx-title">Concepto</label><input id="tx-title" name="title" maxlength="80" required value="${escapeHTML(draft.title || '')}" placeholder="Ej. Mercado, salario…" /></div>
        <div class="field"><label for="tx-merchant">Comercio <span class="field-help">(opcional)</span></label><input id="tx-merchant" name="merchant" maxlength="80" value="${escapeHTML(draft.merchant || '')}" placeholder="Ej. Supermercado" /></div>
        <div class="form-grid">
          <div class="field"><label for="tx-category">Categoría</label><select id="tx-category" name="category" aria-describedby="tx-category-hint">${categoryOptions(type, category)}</select><small id="tx-category-hint" class="field-help" aria-live="polite"></small></div>
          <div class="field"><label for="tx-date">Fecha</label><input id="tx-date" name="date" type="date" required value="${escapeHTML(draft.date || todayString())}" /></div>
        </div>
        ${walletField}
        <div class="field"><label for="tx-note">Nota <span class="field-help">(opcional)</span></label><input id="tx-note" name="note" maxlength="120" value="${escapeHTML(draft.note || '')}" placeholder="Añade un detalle" /></div>
        <div class="modal-form-actions">
          ${existing ? `<button class="danger-button" type="button" data-action="delete-transaction" data-id="${escapeHTML(existing.id)}">Eliminar</button><button class="secondary-button" type="button" data-action="duplicate-transaction" data-id="${escapeHTML(existing.id)}">Duplicar</button>` : ''}
          <button class="secondary-button" type="button" data-action="close-modal">Cancelar</button>
          <button class="primary-button" type="submit">${existing ? 'Guardar cambios' : 'Guardar movimiento'}</button>
        </div>
      </form>
    </div></section></div>`;
}

function renderBudgetModal() {
  const category = modal.category;
  const amount = Number(monthBudgets()[category] || 0);
  return `<div class="modal-backdrop" data-action="backdrop-close"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-header"><div><h2 id="modal-title">Presupuesto de ${escapeHTML(category)}</h2><p>${escapeHTML(monthName(viewMonth))}</p></div><button class="icon-button" data-action="close-modal" aria-label="Cerrar">${svg('close')}</button></div><div class="modal-body"><form id="budget-form" class="modal-form"><input type="hidden" name="category" value="${escapeHTML(category)}"/><div class="field field-amount"><label for="budget-amount">Límite mensual en pesos</label><input id="budget-amount" name="amount" type="number" inputmode="decimal" min="0" step="1" value="${amount || ''}" placeholder="Ej. 300000" /><span class="field-help">Escribe 0 o deja el campo vacío para quitar el límite.</span></div><div class="modal-form-actions"><button class="secondary-button" type="button" data-action="close-modal">Cancelar</button><button class="primary-button" type="submit">Guardar presupuesto</button></div></form></div></section></div>`;
}

function render(options = {}) {
  const gated = authBooting || authMode === 'new-password' || (!authUser && !guestMode);
  root.innerHTML = gated ? renderAuth() : shell();
  lastView = gated ? '' : activeTab;
  if (!gated && modal?.type === 'transaction') showCategorySuggestion(root.querySelector('#transaction-form'));
  if (!gated && installPrompt && localStorage.getItem('saldo-install-dismissed') !== '1') {
    document.getElementById('install-banner')?.classList.add('visible');
  }
  if (options.focus) {
    const field = root.querySelector(`#${options.focus}`);
    if (field) {
      field.focus();
      if (options.caret !== undefined) field.setSelectionRange(options.caret, options.caret);
    }
  }
}

function toast(message, type = 'success') {
  const region = root.querySelector('.toast-region');
  if (!region) return;
  const item = document.createElement('div');
  item.className = `toast ${type}`;
  item.innerHTML = `<span class="toast-mark"></span><span class="toast-message">${escapeHTML(message)}</span>`;
  region.append(item);
  window.setTimeout(() => item.remove(), 3800);
}

function openTransaction(id = null, duplicate = false) {
  const existing = id ? state.transactions.find(tx => tx.id === id) : null;
  if (id && !existing) return;
  modal = {
    type: 'transaction', id: duplicate ? null : id, duplicate,
    draftType: existing?.type || 'expense', category: existing?.category,
    manualCategory: Boolean(existing),
    walletId: existing ? existing.walletId || 'general' : preferredWallet(),
    fields: duplicate ? { ...existing, date: todayString() } : null,
  };
  render();
  root.querySelector('#tx-amount')?.focus({ preventScroll: true });
}

function saveTransaction(form) {
  const data = new FormData(form);
  const amount = Number(data.get('amount'));
  if (!positiveAmount(Math.round(amount))) return toast('Escribe un valor mayor que cero y menor a un billón.', 'error');
  const type = data.get('type') === 'income' ? 'income' : 'expense';
  const id = modal.id || (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const tx = { id, type, amount: Math.round(amount), title: String(data.get('title') || '').trim(), category: String(data.get('category') || ''), date: String(data.get('date') || todayString()), note: String(data.get('note') || '').trim() };
  if (!tx.title || !validDate(tx.date) || !CATEGORIES[type].includes(tx.category)) return toast('Revisa el concepto, la fecha y la categoría.', 'error');
  const merchant = String(data.get('merchant') || '').trim();
  if (merchant) tx.merchant = merchant;
  const walletId = String(data.get('walletId') || 'general');
  if (Object.hasOwn(state.wallets, walletId)) tx.walletId = walletId;
  const exists = state.transactions.some(item => item.id === id);
  state.transactions = exists ? state.transactions.map(item => item.id === id ? tx : item) : [...state.transactions, tx];
  const month = tx.date.slice(0, 7);
  rememberWallet(tx.walletId || 'general');
  persist();
  modal = null;
  const alert = tx.type === 'expense' ? checkBudgetAlerts(month, tx.category) : '';
  render();
  toast(alert || (exists ? 'Movimiento actualizado.' : 'Movimiento guardado.'), alert ? 'info' : 'success');
}

function checkBudgetAlerts(month, category) {
  const limit = Number(monthBudgets(month)[category] || 0);
  const used = spentByCategory(month)[category] || 0;
  if (!limit || !state.settings.notificationsEnabled) return;
  const key = `${month}:${category}`;
  const stage = used >= limit ? '100' : used >= limit * .8 ? '80' : '';
  if (!stage || Number(state.alertedBudgets[key] || 0) >= Number(stage)) return;
  state.alertedBudgets[key] = Number(stage);
  persist();
  const message = stage === '100' ? `Alcanzaste el límite de ${category}.` : `Ya usaste el 80% del presupuesto de ${category}.`;
  if (devicePushEnabled) {
    void sendPushNotification(stage === '100' ? 'budget_100' : 'budget_80').catch(() => {});
  } else void sendNotice('Aviso de presupuesto', message);
  return message;
}

async function sendNotice(title, body) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return false;
  const options = {
    body, icon: './icons/icon-192.png?v=7', badge: './icons/notification-badge.png?v=7', tag: 'saldo-local',
    data: { url: new URL('./', location.href).href },
  };
  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    if (registration?.active) await registration.showNotification(title, options);
    else new Notification(title, options);
    return true;
  } catch { return false; }
}

async function requestNotificationPermission() {
  if (!('Notification' in window) || Notification.permission === 'denied') return false;
  if (Notification.permission === 'granted') return true;
  try { return await Notification.requestPermission() === 'granted'; }
  catch { return false; }
}

function decodeVapidKey(value) {
  const padding = '='.repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from(raw, character => character.charCodeAt(0));
}

async function preparePushForDevice() {
  if (!authUser || !supabaseClient || !('serviceWorker' in navigator) || !('PushManager' in window)) return false;
  if (pushConfigPromise) return pushConfigPromise;
  const epoch = cloudEpoch;
  const userId = authUser.id;
  const request = (async () => {
    try {
      const { data, error } = await supabaseClient.functions.invoke('saldo-notify', { body: { kind: 'configuration' } });
      if (cloudEpoch !== epoch) return false;
      if (error || !/^B[A-Za-z0-9_-]{86}$/.test(data?.vapidPublicKey || '')) return false;
      pushPublicKey = data.vapidPublicKey;
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager?.getSubscription();
      if (cloudEpoch !== epoch) return false;
      if (subscription) {
        const { data: record } = await supabaseClient.from('push_subscriptions')
          .select('endpoint').eq('user_id', userId).eq('endpoint', subscription.endpoint).maybeSingle();
        if (cloudEpoch === epoch) devicePushEnabled = Boolean(record);
      }
      if (cloudEpoch === epoch && activeTab === 'account' && !document.activeElement?.matches('input, select, textarea')) render();
      return cloudEpoch === epoch;
    } catch { return false; }
  })();
  pushConfigPromise = request;
  void request.finally(() => { if (pushConfigPromise === request) pushConfigPromise = null; });
  return request;
}

async function sendPushNotification(kind = 'test') {
  if (!authUser || !supabaseClient) throw new Error('Inicia sesión para enviar avisos push.');
  const { data, error } = await supabaseClient.functions.invoke('saldo-notify', { body: { kind } });
  if (error) throw error;
  return data || {};
}

async function enablePushNotifications() {
  if (!authUser || !pushPublicKey || pushChangePending) return;
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    toast('Este dispositivo no admite notificaciones push web.', 'error');
    return;
  }
  const publicKey = pushPublicKey;
  const pushEpoch = cloudEpoch;
  pushChangePending = true;
  const pushUserId = authUser.id;
  let subscription = null;
  try {
    const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    if (permission !== 'granted') {
      toast(/iPhone|iPad|iPod/i.test(navigator.userAgent) ? 'En iPhone, instala Saldo en la pantalla de inicio y vuelve a activar push.' : 'Permite las notificaciones para activar push.', 'info');
      return;
    }
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration?.active) throw new Error('El servicio de avisos aún se está iniciando.');
    subscription = await registration.pushManager.getSubscription();
    if (!subscription) subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: decodeVapidKey(publicKey),
    });
    if (cloudEpoch !== pushEpoch) return;
    const keys = subscription.toJSON().keys || {};
    if (!keys.p256dh || !keys.auth) throw new Error('El navegador no entregó las claves de suscripción.');
    const { error } = await supabaseClient.from('push_subscriptions').upsert({
      user_id: pushUserId,
      endpoint: subscription.endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
    }, { onConflict: 'user_id,endpoint' });
    if (error) throw error;
    if (cloudEpoch !== pushEpoch) return;
    devicePushEnabled = true;
    pushChangePending = false;
    render();
    toast('Push activado para este dispositivo. Puedes enviar un aviso de prueba.');
  } catch {
    if (cloudEpoch !== pushEpoch) return;
    if (subscription) {
      await supabaseClient.from('push_subscriptions').delete()
        .eq('user_id', pushUserId).eq('endpoint', subscription.endpoint);
      await subscription.unsubscribe().catch(() => {});
    }
    devicePushEnabled = false;
    render();
    toast('No se pudo activar push. Revisa tu conexión y vuelve a intentarlo.', 'error');
  } finally {
    if (cloudEpoch === pushEpoch) pushChangePending = false;
  }
}

async function disablePushNotifications(options = {}) {
  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    const subscription = await registration?.pushManager?.getSubscription();
    if (subscription && authUser) {
      await supabaseClient.from('push_subscriptions').delete()
        .eq('user_id', authUser.id).eq('endpoint', subscription.endpoint);
    }
    if (subscription) await subscription.unsubscribe();
  } catch {
    if (!options.silent) toast('No se pudo quitar esta suscripción push.', 'error');
  }
  devicePushEnabled = false;
  if (!options.silent) { persist(); render(); toast('Push quedó desactivado en este dispositivo.'); }
}

function changeAuthMode(mode) {
  if (!authViews[mode] || authBusy) return;
  authEmail = root.querySelector('#auth-email')?.value.trim() || authEmail;
  authMessage = '';
  authMode = mode;
  guestMode = false;
  render();
  root.querySelector('#auth-email')?.focus();
}

function showAuthMessage(message) {
  authMessage = message;
  const feedback = root.querySelector('#auth-feedback');
  if (feedback) feedback.textContent = message;
}

async function submitAuthForm(form) {
  if (!supabaseClient || authBusy || !form.reportValidity()) return;
  const mode = authMode;
  const data = new FormData(form);
  const email = String(data.get('email') || '').trim();
  const password = String(data.get('password') || '');
  if (mode === 'new-password' && password !== data.get('confirm')) {
    showAuthMessage('Las contraseñas deben coincidir.');
    return;
  }
  const submit = form.querySelector('button[type="submit"]');
  authEmail = email;
  authBusy = true;
  submit.disabled = true;
  submit.textContent = 'Un momento…';
  showAuthMessage('');
  try {
    const redirectTo = new URL('./', location.href).href;
    if (mode === 'recovery') {
      const { error } = await supabaseClient.auth.resetPasswordForEmail(email, { redirectTo });
      showAuthMessage(error ? 'No pudimos enviar el enlace. Intenta de nuevo más tarde.' : 'Si el correo está registrado y habilitado, recibirás el enlace.');
      return;
    }
    if (mode === 'new-password') {
      await supabaseClient.auth.updateUser({ password }).then(({ error }) => { if (error) throw error; });
      authMode = 'signin';
      render();
      toast('Contraseña actualizada.');
      return;
    }
    if (mode === 'signup') {
      const { data: result, error } = await supabaseClient.auth.signUp({ email, password, options: { emailRedirectTo: redirectTo } });
      if (error) throw error;
      if (!result.session) showAuthMessage('Revisa tu correo para confirmar la cuenta e inicia sesión.');
      else handleSignedIn(result.session.user);
      return;
    }

    const { data: result, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) throw error;
    handleSignedIn(result.user);

  } catch (error) {
    const message = ({
      email_not_confirmed: 'Confirma tu correo con el enlace que recibiste.',
      email_address_not_authorized: 'Este correo todavía no está habilitado para el registro.',
      over_email_send_rate_limit: 'Alcanzaste el límite temporal de correos. Intenta más tarde.',
      weak_password: 'Elige una contraseña más larga y difícil de adivinar.',
    })[error?.code];
    showAuthMessage(message || (mode === 'signup' ? 'No pudimos enviar la confirmación. Revisa tu correo o intenta más tarde.' : mode === 'new-password' ? 'No se pudo guardar la contraseña. Revisa el enlace o elige otra.' : 'No pudimos iniciar sesión. Revisa el correo, la contraseña y tu conexión.'));
  } finally {
    authBusy = false;
    submit.disabled = false;
    submit.textContent = authViews[mode][2];
    const passwordField = form.querySelector('#auth-password');
    if (passwordField) passwordField.value = '';
  }
}

async function signOutOfAccount() {
  if (!supabaseClient) return;
  if (cloudDirty) await saveCloudNow();
  if (devicePushEnabled) await disablePushNotifications({ silent: true });
  const { error } = await supabaseClient.auth.signOut({ scope: 'local' });
  if (error) toast('No se pudo cerrar la sesión. Inténtalo de nuevo.', 'error');
}

function checkReminder() {
  if (devicePushEnabled || !state.settings.remindersEnabled || (!authUser && !guestMode)) return;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota', year: 'numeric', month: 'numeric', day: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date());
  const clock = Object.fromEntries(parts.map(part => [part.type, part.value]));
  const stamp = clock.year + '-' + clock.month;
  if (clock.day !== String(state.settings.reminderDay) || clock.hour + ':' + clock.minute !== state.settings.reminderTime || state.lastReminder === stamp) return;
  state.lastReminder = stamp;
  persist();
  const message = 'Revisa tus movimientos y presupuestos de este mes.';
  toast(message, 'info');
  void sendNotice('Recordatorio de Saldo', message);
}

function downloadFile(name, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function exportCSV() {
  const headers = ['Fecha', 'Tipo', 'Concepto', 'Comercio', 'Categoría', 'Bolsillo', 'Valor COP', 'Nota'];
  const rows = visibleMovements().slice().reverse().map(tx => [
    tx.date, tx.type === 'income' ? 'Ingreso' : 'Gasto', tx.title, tx.merchant || '',
    tx.category, walletLabel(tx.walletId), tx.amount, tx.note || '',
  ]);
  const cell = value => {
    const raw = String(value ?? '');
    const safe = typeof value !== 'number' && /^[\s]*[=+@-]/.test(raw) ? "'" + raw : raw;
    return '"' + safe.replace(/"/g, '""') + '"';
  };
  const csv = [headers, ...rows].map(row => row.map(cell).join(',')).join('\r\n');
  downloadFile(`saldo-movimientos-${viewMonth}.csv`, `\uFEFF${csv}`, 'text/csv;charset=utf-8');
  toast(`Descargaste ${rows.length} ${rows.length === 1 ? 'movimiento' : 'movimientos'} en CSV.`);
}

function exportJSON() {
  downloadFile(`saldo-copia-${todayString()}.json`, JSON.stringify({ format: 'saldo-backup-v1', exportedAt: new Date().toISOString(), state }, null, 2), 'application/json');
  toast('Copia de seguridad descargada.');
}

function importJSON(file) {
  if (!file) return;
  if (file.size > 5_000_000) { toast('La copia pesa más de 5 MB.', 'error'); return; }
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result));
      const normalized = window.SaldoState.readBackup(parsed);
      if (!confirm(authUser ? 'La importación reemplazará los datos de tu cuenta. ¿Continuar?' : 'La importación reemplazará los datos de este dispositivo. ¿Continuar?')) return;
      state = normalized;
      cloudReset = Boolean(authUser);
      persist(); render(); toast('Copia importada correctamente.');
    } catch {
      toast('No se pudo leer esa copia de seguridad.', 'error');
    }
  };
  reader.readAsText(file);
}

function handleAction(button) {
  if (handlePlanningAction(button)) return;
  const action = button.dataset.action;
  if (action === 'retry-local') { storeState(); render(); return; }
  if (action === 'resolve-sync') { resolveSync(button); return; }
  if (action === 'new-transaction') openTransaction();
  if (action === 'category-rules') { activeTab = 'rules'; render(); window.scrollTo(0,0); }
  if (action === 'calendar-range') { calendarRange = button.dataset.range === 'all' ? 'all' : button.dataset.range === '30' ? 30 : 7; render(); }
  if (action === 'duplicate-transaction') openTransaction(button.dataset.id, true);
  if (action === 'reset-movement-filters') {
    walletFilter = categoryFilter = transactionFilter = 'all';
    searchTerm = '';
    render();
  }
  if (action === 'close-modal') { modal = null; render(); }
  if (action === 'set-type' && modal?.type === 'transaction') {
    modal.walletId = root.querySelector('#tx-wallet')?.value || 'general';
    const draft = new FormData(root.querySelector('#transaction-form'));
    modal.fields = Object.fromEntries(draft);
    modal.draftType = button.dataset.type;
    modal.category = null;
    modal.manualCategory = false;
    render();
    root.querySelector('#tx-amount')?.focus();
  }
  if (action === 'edit-transaction') openTransaction(button.dataset.id);
  if (action === 'delete-transaction') {
    if (confirm('¿Eliminar este movimiento?')) {
      state.transactions = state.transactions.filter(tx => tx.id !== button.dataset.id);
      persist(); modal = null; render(); toast('Movimiento eliminado.');
    }
  }
  if (action === 'prev-month') { viewMonth = shiftMonth(viewMonth, -1); render(); }
  if (action === 'next-month') { viewMonth = shiftMonth(viewMonth, 1); render(); }
  if (action === 'filter-transactions') { transactionFilter = button.dataset.filter; render(); }
  if (action === 'edit-budget') { modal = { type: 'budget', category: button.dataset.category }; render(); root.querySelector('#budget-amount')?.focus({preventScroll:true}); }
  if (action === 'toggle-notifications') {
    state.settings.notificationsEnabled = !state.settings.notificationsEnabled;
    persist(); render();
  }
  if (action === 'toggle-push') {
    if (devicePushEnabled) void disablePushNotifications();
    else void enablePushNotifications();
  }
  if (action === 'sync-now') {
    cloudStatus = 'saving'; render();
    if (!pushPublicKey) void preparePushForDevice();
    void saveCloudNow().then(saved => {
      render();
      toast(saved ? 'Tus datos están sincronizados.' : syncConflicts.length ? 'Elige la versión del movimiento en Cuenta.' : 'No se pudo sincronizar. Conservamos los datos en este dispositivo.', saved ? 'success' : 'error');
    });
  }
  if (action === 'auth-mode') changeAuthMode(button.dataset.mode);
  if (action === 'guest' && !authBusy && !authUser) { guestMode = true; activeTab = 'home'; render(); }
  if (action === 'import-local' && authUser) {
    if (!confirm('¿Copiar los movimientos de invitado de este navegador a tu cuenta Saldo?')) return;
    state = mergeStates(blankState(), readState(STORE_KEY), normalizeState(state));
    persist(); render(); toast('Se copiaron los datos de invitado a tu cuenta.');
  }
  if (action === 'admin-open') void openAdmin();
  if (action === 'admin-enroll') void enrollAdminFactor(button);
  if (action === 'admin-copy') void copyOwnerKey();
  if (action === 'admin-return') { adminFactor = adminSummary = null; activeTab = 'account'; render(); }

  if (action === 'sign-out') void signOutOfAccount();
  if (action === 'toggle-reminders') {
    state.settings.remindersEnabled = !state.settings.remindersEnabled;
    persist(); render();
    toast(state.settings.remindersEnabled ? 'Recordatorio mensual activado.' : 'Recordatorio mensual pausado.');
  }
  if (action === 'test-notification') {
    if (devicePushEnabled) {
      void sendPushNotification('test').then(result => {
        toast(result.sent ? 'El proveedor aceptó el aviso de prueba.' : 'No hay un dispositivo push disponible.', result.sent ? 'success' : 'info');
      }).catch(() => toast('No se pudo enviar el aviso push. Prueba más tarde.', 'error'));
    } else {
      void requestNotificationPermission().then(async granted => {
        if (granted && await sendNotice('Notificaciones de Saldo', 'Así se verá un recordatorio.')) {
          toast('Aviso del dispositivo enviado.');
        } else toast('Este es un aviso dentro de Saldo.', 'info');
      });
    }
  }
  if (action === 'export-csv') exportCSV();
  if (action === 'export-json') exportJSON();
  if (action === 'import-json') root.querySelector('#import-file')?.click();
  if (action === 'clear-data') {
    const message = authUser
      ? 'Esto borra tus movimientos, presupuestos y preferencias de la cuenta. Descarga una copia antes si quieres conservarlos. ¿Continuar?'
      : 'Esto borra los datos guardados en este navegador. ¿Continuar?';
    if (!confirm(message)) return;
    state = blankState();
    cloudReset = Boolean(authUser);
    persist();
    render();
    if (authUser) {
      void saveCloudNow().then(saved => toast(saved ? 'Datos borrados de tu cuenta.' : 'El borrado de la nube queda pendiente de conexión.', saved ? 'success' : 'info'));
    } else toast('Datos borrados de este navegador.');
  }
  if (action === 'install-help') {
    toast(/iPhone|iPad|iPod/i.test(navigator.userAgent) ? 'En Safari: Compartir y luego Añadir a pantalla de inicio.' : 'En Chrome: abre el menú y elige Instalar aplicación o Añadir a pantalla de inicio.', 'info');
  }
  if (action === 'install-app') installApp();
  if (action === 'dismiss-install') { document.getElementById('install-banner')?.classList.remove('visible'); localStorage.setItem('saldo-install-dismissed', '1'); }
}

function installApp() {
  if (installPrompt) {
    installPrompt.prompt();
    installPrompt.userChoice.finally(() => { installPrompt = null; document.getElementById('install-banner')?.classList.remove('visible'); });
  } else if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) {
    toast('En Safari, toca Compartir y elige “Añadir a pantalla de inicio”.', 'info');
  } else {
    toast('Abre el menú del navegador y elige “Instalar aplicación”.', 'info');
  }
}

root.addEventListener('click', event => {
  const tab = event.target.closest('[data-tab]');
  if (tab) {
    if (activeTab !== tab.dataset.tab || (tab.dataset.tab === 'budgets' && plannerView !== 'budgets')) {
      if (activeTab === 'admin') adminFactor = adminSummary = null;
      if (tab.dataset.tab === 'budgets') plannerView = 'budgets';
      activeTab = tab.dataset.tab; render(); window.scrollTo(0, 0);
      if (activeTab === 'account' && !pushPublicKey) void preparePushForDevice();
    }
    return;
  }
  const button = event.target.closest('[data-action]');
  if (!button) return;
  if (button.dataset.action === 'backdrop-close' && event.target !== button) return;
  if (button.dataset.action === 'backdrop-close') { modal = null; render(); return; }
  handleAction(button);
});

root.addEventListener('submit', event => {
  if (event.target.id === 'auth-form') { event.preventDefault(); void submitAuthForm(event.target); }
  if (event.target.id === 'admin-code-form') { event.preventDefault(); void verifyAdminCode(event.target); }
  if (event.target.id === 'plan-form') { event.preventDefault(); saveToolForm(event.target); }
  if (event.target.id === 'transaction-form') { event.preventDefault(); saveTransaction(event.target); }
  if (event.target.id === 'budget-form') {
    event.preventDefault();
    const data = new FormData(event.target);
    const category = String(data.get('category'));
    const amount = Math.round(Number(data.get('amount')) || 0);
    if (!CATEGORIES.expense.includes(category) || (amount !== 0 && !positiveAmount(amount))) {
      toast('Revisa el valor del presupuesto.', 'error');
      return;
    }
    if (!state.budgets[viewMonth]) state.budgets[viewMonth] = {};
    if (amount === 0) delete state.budgets[viewMonth][category];
    else state.budgets[viewMonth][category] = Math.round(amount);
    persist(); modal = null; render(); toast(amount ? 'Presupuesto actualizado.' : 'Se quitó el límite de esta categoría.');
  }
  if (event.target.id === 'profile-form') {
    event.preventDefault();
    state.profile.name = String(new FormData(event.target).get('name') || '').trim();
    persist(); render(); toast('Perfil guardado.');
  }
});

root.addEventListener('input', event => {
  if (modal?.type === 'transaction' && ['tx-title','tx-merchant'].includes(event.target.id)) showCategorySuggestion(event.target.form);

  if (event.target.id === 'movement-search') {
    searchTerm = event.target.value;
    const caret = event.target.selectionStart;
    render({ focus: 'movement-search', caret });
  }
});

root.addEventListener('toggle', event => {
  if (event.target.id === 'data-panel') dataPanelOpen = event.target.open;
  if (event.target.id === 'delete-panel') deletePanelOpen = event.target.open;
}, true);

root.addEventListener('change', event => {
  if (event.target.id === 'saldo-theme') window.SaldoTheme.setPreference(event.target.value);
  if (event.target.id === 'scheduled-type') root.querySelector('#scheduled-category').innerHTML = categoryOptions(event.target.value);

  if (event.target.id === 'rule-type') root.querySelector('#rule-category').innerHTML = categoryOptions(event.target.value);
  if (event.target.id === 'filter-wallet') { walletFilter = event.target.value; render({focus:'filter-wallet'}); }
  if (event.target.id === 'filter-category') { categoryFilter = event.target.value; render({focus:'filter-category'}); }
  if (event.target.id === 'tx-category' && modal?.type === 'transaction') {
    modal.category = event.target.value;
    modal.manualCategory = true;
    showCategorySuggestion(event.target.form);
  }
  if (event.target.id === 'reminder-day') { state.settings.reminderDay = event.target.value; persist(); }
  if (event.target.id === 'reminder-time' && event.target.value) { state.settings.reminderTime = event.target.value; persist(); }
  if (event.target.id === 'import-file') importJSON(event.target.files?.[0]);
});

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  installPrompt = event;
  if (localStorage.getItem('saldo-install-dismissed') !== '1') document.getElementById('install-banner')?.classList.add('visible');
});

window.addEventListener('appinstalled', () => {
  document.getElementById('install-banner')?.classList.remove('visible');
  toast('Saldo quedó instalada en tu teléfono.');
});

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}

render();
initializeCloud();
window.setInterval(checkReminder, 30000);
window.addEventListener('online', () => void saveCloudNow());
document.addEventListener('visibilitychange', () => { if (!document.hidden && authUser) void saveCloudNow(); });
