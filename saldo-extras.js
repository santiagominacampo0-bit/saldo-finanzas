// Views shared by the planning tabs, the dashboard and the transaction form.
const calendarStatuses = { pending: 'Pendiente', overdue: 'Vencido', recorded: 'Registrado' };


function renderCalendar() {
  const today = todayString();
  const entries = window.SaldoCalendar.calendarEntries(state.recurring, state.transactions, today, calendarRange);
  const counts = Object.fromEntries(Object.keys(calendarStatuses).map(id => [id, entries.filter(item => item.status === id).length]));
  return `<div class="page-title-row"><div><h2>Calendario de pagos y cobros</h2><p>Consulta tus vencimientos y confirma desde aquí.</p></div>
    <div class="filter-group" aria-label="Rango del calendario">
      ${[7, 30].map(day => `<button class="filter-chip ${calendarRange === day ? 'active' : ''}" data-action="calendar-range" data-range="${day}" aria-pressed="${calendarRange === day}">${day} días</button>`).join('')}
    </div></div>
    <div class="calendar-counts" aria-label="Resumen">${Object.entries(calendarStatuses).map(([id, label]) => `<span class="plan-status ${id === 'overdue' ? 'late' : ''}">${label} ${counts[id]}</span>`).join('')}</div>
    <section class="panel panel-pad"><ul class="calendar-list">${entries.map(item => {
      const action = item.canConfirm
        ? `<button class="secondary-button" data-action="confirm-recurring" data-id="${escapeHTML(item.ruleId)}" data-due="${escapeHTML(item.date)}">${item.type === 'income' ? 'Registrar cobro' : 'Registrar pago'}</button>`
        : '';
      return `<li class="calendar-row"><div class="calendar-item-copy"><strong>${escapeHTML(item.title)}</strong><small>${formatDate(item.date, { dateStyle: 'medium' })} · ${item.type === 'income' ? 'Ingreso' : 'Gasto'}</small></div><div class="calendar-item-main"><span class="plan-status ${item.status === 'overdue' ? 'late' : ''}">${calendarStatuses[item.status]}</span><strong>${formatMoney(item.amount)}</strong></div>${action}</li>`;
    }).join('')}</ul>${entries.length ? '' : planEmpty('Todavía no hay pagos o cobros programados. Crea un recurrente para verlo aquí.')}</section>`;
}

function renderForecast() {
  const { registered, pending, available } = window.SaldoCalendar.monthForecast(state, todayString());
  return `<article class="panel panel-pad forecast" aria-labelledby="forecast-title">
    <div class="section-heading"><div><h2 id="forecast-title">Disponible después de pagos</h2><p>Estimación para el mes actual, incluidos los pagos vencidos.</p></div>
    <button class="text-button" data-action="planner-view" data-view="calendar">Ver calendario</button></div>
    <div class="forecast-values">
      <div><span>Saldo registrado</span><strong data-forecast="registered">${formatMoney(registered)}</strong></div>
      <div><span>Pagos pendientes</span><strong data-forecast="pending">${formatMoney(pending)}</strong></div>
      <div><span>Disponible estimado</span><strong data-forecast="available" class="${available < 0 ? 'forecast-negative' : ''}">${formatMoney(available)}</strong></div>
    </div></article>`;
}

function searchable(value) {
  return String(value || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
}

function visibleMovements() {
  const search = searchable(searchTerm);
  const selectedWallet = walletFilter === 'general' || Object.hasOwn(state.wallets, walletFilter) ? walletFilter : 'all';
  return transactionsIn(viewMonth)
    .filter(tx => transactionFilter === 'all' || tx.type === transactionFilter)
    .filter(tx => selectedWallet === 'all' || (tx.walletId || 'general') === selectedWallet)
    .filter(tx => categoryFilter === 'all' || tx.category === categoryFilter)
    .filter(tx => searchable([tx.title, tx.merchant, tx.category, tx.note, walletLabel(tx.walletId)].join(' ')).includes(search))
    .sort((a, b) => b.date.localeCompare(a.date));
}

function renderMovementFilters() {
  const categoryOptions = [...new Set([...CATEGORIES.income, ...CATEGORIES.expense])].map(label =>
    `<option value="${escapeHTML(label)}" ${categoryFilter === label ? 'selected' : ''}>${escapeHTML(label)}</option>`).join('');
  return `<div class="movement-filters">
    <label>Bolsillo<select id="filter-wallet"><option value="all">Todos los bolsillos</option>${walletOptions(walletFilter)}</select></label>
    <label>Categoría<select id="filter-category"><option value="all">Todas las categorías</option>${categoryOptions}</select></label>
    ${walletFilter !== 'all' || categoryFilter !== 'all' || transactionFilter !== 'all' || searchTerm ? '<button class="text-button" data-action="reset-movement-filters">Limpiar filtros</button>' : ''}
  </div>`;
}

function renderCategoryRules() {
  const rules = Object.values(state.categoryRules).sort((a, b) => a.pattern.localeCompare(b.pattern, 'es'));
  return `<div class="page-title-row"><div><h2>Reglas de categorías</h2><p>Saldo sugiere una categoría según el comercio. Puedes cambiarla antes de guardar.</p></div>
    <button class="primary-button" data-action="plan-edit" data-kind="categoryRules">${svg('plus')} Nueva regla</button></div>
    <article class="panel panel-pad">
      <div class="section-heading"><div><h2>Tus reglas</h2><p>Tienen prioridad sobre las sugerencias de Saldo.</p></div><button class="text-button" data-tab="movements">Volver a Movimientos</button></div>
      ${rules.length ? `<ul class="plan-compact">${rules.map(rule => `<li><span><strong>${escapeHTML(rule.pattern)} → ${escapeHTML(rule.category)}</strong><small>${rule.type === 'income' ? 'Ingreso' : 'Gasto'} · ${rule.match === 'exact' ? 'Coincidencia exacta' : 'Contiene estas palabras'} · ${rule.active ? 'Activa' : 'En pausa'}</small></span>${editPlanButton('categoryRules',rule.id,rule.pattern)}</li>`).join('')}</ul>`
        : planEmpty('Ejemplo: si el comercio contiene «Farmacia», sugiere Salud. Saldo ya reconoce «Supermercado» como Alimentación.')}</article>`;
}

function showCategorySuggestion(form) {
  const hint = form.querySelector('#tx-category-hint');
  const select = form.querySelector('#tx-category');
  if (!hint || !select) return;
  if (modal.manualCategory) {
    hint.textContent = 'Categoría elegida por ti.';
    return;
  }
  const type = form.elements.type.value;
  const suggestion = window.SaldoRules.suggestCategory({
    type, merchant: form.elements.merchant.value, title: form.elements.title.value,
  }, state.categoryRules, CATEGORIES);
  select.value = suggestion?.category || CATEGORIES[type].at(-1);
  hint.textContent = suggestion
    ? (suggestion.source === 'custom' ? 'Aplicada por tu regla: «' + suggestion.pattern + '».' : 'Categoría sugerida por Saldo.')
    : 'Puedes elegir una categoría.';
}

function lastWalletKey() {
  return STORE_KEY + ':last-wallet:' + (authUser?.id || 'guest');
}

function preferredWallet() {
  try {
    const walletId = localStorage.getItem(lastWalletKey());
    return Object.hasOwn(state.wallets, walletId) ? walletId : 'general';
  } catch { return 'general'; }
}

function rememberWallet(walletId) {
  try { localStorage.setItem(lastWalletKey(), walletId); } catch { /* This small preference is optional. */ }
}

function renderNotificationCheck(check) {
  if (!check?.last_started_at) return `<section class="owner-notifications"><h3>Estado de los avisos</h3><p>El programador todavía no ha registrado una comprobación.</p></section>`;
  const date = value => {
    const parsed = new Date(value);
    return value && Number.isFinite(parsed.valueOf())
      ? new Intl.DateTimeFormat('es-CO',{dateStyle:'medium', timeStyle:'short', timeZone:'America/Bogota'}).format(parsed)
      : 'Sin registro';
  };
  const count = key => Math.max(0, Number(check[key]) || 0);
  const running = !check.last_finished_at || Date.parse(check.last_started_at) > Date.parse(check.last_finished_at);
  const stale = Date.now() - Date.parse(check.last_started_at) > 20 * 60 * 1000;
  const failures = count('transient_failures') + count('provider_rejections') + count('processing_errors');
  const status = stale ? 'Hace más de 20 minutos sin un chequeo nuevo' : running ? 'Chequeo sin terminar' : failures ? 'El último chequeo tuvo fallos' : 'El último chequeo terminó sin fallos';
  return `<section class="owner-notifications"><h3>Estado de los avisos</h3><p>${status}</p>
    <dl><div><dt>Último chequeo</dt><dd>${date(check.last_started_at)}</dd></div>
      <div><dt>Entregas aceptadas por el proveedor</dt><dd>${count('accepted')}</dd></div>
      <div><dt>Fallos en el último chequeo</dt><dd>${failures}</dd></div>
      <div><dt>Último fallo registrado</dt><dd>${date(check.last_failure_at)}</dd></div></dl>
    <p>Los conteos corresponden al último chequeo terminado. La aceptación del proveedor queda registrada aunque el sistema del teléfono silencie un aviso.</p></section>`;
}
