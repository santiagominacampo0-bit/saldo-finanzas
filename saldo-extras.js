// Views shared by the planning tabs, the dashboard and the transaction form.
const calendarStatuses = { pending: 'Pendiente', overdue: 'Vencido', recorded: 'Registrado', paused: 'En pausa' };

function renderCalendar() {
  const entries = window.SaldoCalendar.calendarEntries(state.recurring, state.transactions, todayString(), calendarRange);
  const counts = Object.fromEntries(Object.keys(calendarStatuses).map(id => [id, 0]));
  for (const item of entries) counts[item.status] += 1;
  const ranges = [[7, '7 días'], [30, '30 días'], ['all', 'Todas las fechas']];
  return `<div class="page-title-row"><div><h2>Calendario de pagos y cobros</h2><p>Programa un movimiento para una fecha y regístralo cuando ocurra.</p></div>
    <button class="primary-button" data-action="plan-edit" data-kind="scheduled">${svg('plus')} Programar movimiento</button></div>
    <div class="filter-group planner-nav" role="group" aria-label="Rango del calendario">
      ${ranges.map(([days, label]) => `<button class="filter-chip ${calendarRange === days ? 'active' : ''}" data-action="calendar-range" data-range="${days}" aria-pressed="${calendarRange === days}">${label}</button>`).join('')}
    </div>
    <div class="calendar-counts" role="group" aria-label="Resumen">${Object.entries(calendarStatuses).map(([id, label]) => id === 'paused' && !counts[id] ? '' : `<span class="plan-status ${id === 'overdue' ? 'late' : ''}">${label} ${counts[id]}</span>`).join('')}</div>
    <section class="panel panel-pad">${entries.length ? `<ul class="calendar-list">${entries.map(item => {
      const confirmButton = item.canConfirm
        ? `<button class="secondary-button" data-action="confirm-scheduled" data-id="${escapeHTML(item.ruleId)}" data-due="${escapeHTML(item.date)}">${item.type === 'income' ? 'Registrar cobro' : 'Registrar pago'}</button>`
        : '';
      const actions = item.status === 'recorded' ? '' : `<div class="calendar-item-actions account-actions">${confirmButton}${editPlanButton('scheduled', item.ruleId, item.title)}</div>`;
      return `<li class="calendar-row"><div class="calendar-item-copy"><strong>${escapeHTML(item.title)}</strong><small>${formatDate(item.date, { dateStyle: 'medium' })} · ${item.type === 'income' ? 'Ingreso' : 'Gasto'}</small></div><div class="calendar-item-main"><span class="plan-status ${item.status === 'overdue' ? 'late' : ''}">${calendarStatuses[item.status]}</span><strong>${formatMoney(item.amount)}</strong></div>${actions}</li>`;
    }).join('')}</ul>` : planEmpty('No hay pagos o cobros en estas fechas.')}</section>`;
}

function renderForecast() {
  const { registered, pending, futureRecorded, available } = window.SaldoCalendar.monthForecast(state, todayString());
  return `<article class="panel panel-pad forecast" aria-labelledby="forecast-title">
    <div class="section-heading"><div><h2 id="forecast-title">Disponible después de pagos</h2><p>Estimación del mes actual. Incluye vencimientos pendientes y gastos ya registrados con fecha futura.</p></div>
    <button class="text-button" data-action="planner-view" data-view="calendar">Ver calendario</button></div>
    <div class="forecast-values">
      <div><span>Saldo registrado</span><strong data-forecast="registered">${formatMoney(registered)}</strong></div>
      <div><span>Pagos por descontar</span><strong data-forecast="pending">${formatMoney(pending + futureRecorded)}</strong></div>
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
    .filter(tx => searchable([tx.date, formatDate(tx.date), tx.title, tx.merchant, tx.category, tx.note, walletLabel(tx.walletId)].join(' ')).includes(search))
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

function ownerDate(value) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return 'Sin registro';
  return new Intl.DateTimeFormat('es-CO', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Bogota',
  }).format(parsed);
}

function ownerCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value.toLocaleString('es-CO') : 'Sin datos';
}

function ownerMetrics(rows) {
  return `<dl class="owner-metrics">${rows.map(([label, value]) =>
    `<div><dt>${label}</dt><dd>${value}</dd></div>`).join('')}</dl>`;
}

function renderOwnerDiagnostics(summary) {
  const activity = summary.activity;
  return `<section class="owner-diagnostics" aria-labelledby="owner-usage-title">
    <h3 id="owner-usage-title">Cuentas y sincronización</h3>
    ${ownerMetrics([
      ['Cuentas confirmadas', ownerCount(summary.accounts)],
      ['Cuentas con datos', ownerCount(summary.sync_accounts)],
      ['Suscripciones push', ownerCount(summary.push_devices)],
      ['Cuentas confirmadas en los últimos 7 días', ownerCount(activity?.confirmed_last_7_days)],
      ['Cuentas con guardados en los últimos 7 días', ownerCount(activity?.saved_last_7_days)],
      ['Último guardado en la nube', ownerDate(activity?.last_saved_at)],
    ])}
    <p>El último guardado indica cuándo cambió algún dato en la nube.</p>
    ${summary.checked_at ? `<p>Indicadores consultados el ${ownerDate(summary.checked_at)} (hora de Colombia).</p>` : ''}
    </section>${renderNotificationCheck(summary.notification_check, summary.checked_at)}`;
}

function renderNotificationCheck(check, checkedAt) {
  const title = '<h3 id="owner-notices-title">Estado de los avisos</h3>';
  const start = Date.parse(check?.last_started_at);
  if (!Number.isFinite(start)) return `<section class="owner-diagnostics" aria-labelledby="owner-notices-title">${title}<p>El programador todavía no ha registrado una comprobación.</p></section>`;

  const finish = Date.parse(check.last_finished_at);
  const observed = Date.parse(checkedAt);
  const stale = (Number.isFinite(observed) ? observed : Date.now()) - start > 20 * 60 * 1000;
  const hasResult = Number.isFinite(finish);
  const running = !hasResult || start > finish;
  const failures = [check.transient_failures, check.provider_rejections, check.processing_errors]
    .reduce((total, value) => total + (Number.isSafeInteger(value) && value > 0 ? value : 0), 0);
  const status = stale ? 'Hace más de 20 minutos sin un chequeo nuevo'
    : running ? 'Chequeo sin terminar'
    : failures ? 'El último chequeo tuvo fallos' : 'El último chequeo terminó sin fallos';
  return `<section class="owner-diagnostics" aria-labelledby="owner-notices-title">${title}
    <p class="owner-check-status">${status}</p>
    ${ownerMetrics([
      ['Último chequeo iniciado', ownerDate(check.last_started_at)],
      ['Último chequeo terminado', ownerDate(check.last_finished_at)],
      ['Última entrega aceptada por un proveedor', ownerDate(check.last_accepted_at)],
      ['Último fallo registrado', ownerDate(check.last_failure_at)],
    ])}
    ${hasResult ? `<h4>Detalle del último chequeo terminado</h4>${ownerMetrics([
      ['Recordatorios mensuales seleccionados', ownerCount(check.monthly_claims)],
      ['Entregas aceptadas por el proveedor', ownerCount(check.accepted)],
      ['Rechazos del proveedor', ownerCount(check.provider_rejections)],
      ['Fallos temporales', ownerCount(check.transient_failures)],
      ['Fallos por tiempo de espera', ownerCount(check.timed_out)],
      ['Errores de procesamiento', ownerCount(check.processing_errors)],
      ['Suscripciones descartadas', ownerCount(check.discarded_subscriptions)],
    ])}<p>Los fallos por tiempo de espera están incluidos en los temporales. Una entrega aceptada todavía puede quedar silenciada en el dispositivo.</p>` : ''}
    </section>`;
}
