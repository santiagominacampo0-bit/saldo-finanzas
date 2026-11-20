const plannerLabels = Object.freeze({
  budgets: 'Presupuestos',
  recurring: 'Recurrentes',
  calendar: 'Calendario',
  wallets: 'Bolsillos',
  goals: 'Metas',
});
const frequencies = Object.freeze({ weekly: 'Semanal', biweekly: 'Cada dos semanas', monthly: 'Mensual' });

function plannerTabs() {
  return `<nav class="planner-nav filter-group" aria-label="Planificación">${Object.entries(plannerLabels).map(([id, label]) =>
    `<button class="filter-chip ${plannerView === id ? 'active' : ''}" data-action="planner-view" data-view="${id}" aria-pressed="${plannerView === id}">${label}</button>`).join('')}</nav>`;
}

function allWallets() {
  return [window.SaldoPlanning.GENERAL_WALLET, ...Object.values(state.wallets)];
}

function walletLabel(id) {
  return state.wallets[id]?.name || 'General';
}

function walletOptions(current = 'general') {
  return allWallets().map(wallet =>
    `<option value="${escapeHTML(wallet.id)}" ${current === wallet.id ? 'selected' : ''}>${escapeHTML(wallet.name)}</option>`).join('');
}

function renderPlanning() {
  if (plannerView === 'budgets') return plannerTabs() + renderBudgets();
  if (plannerView === 'recurring') return plannerTabs() + renderRecurring();
  if (plannerView === 'calendar') return plannerTabs() + renderCalendar();
  if (plannerView === 'wallets') return plannerTabs() + renderWallets();
  return plannerTabs() + renderGoals();
}

function planEmpty(copy) {
  return `<div class="muted-panel plan-empty"><p>${escapeHTML(copy)}</p></div>`;
}

function editPlanButton(kind, id, name) {
  return `<button class="text-button" data-action="plan-edit" data-kind="${kind}" data-id="${escapeHTML(id)}" aria-label="Editar ${escapeHTML(name)}">Editar</button>`;
}

function renderRecurringPreview() {
  const items = window.SaldoRecurrence.upcomingRecurring(state.recurring, todayString()).slice(0, 3);
  return items.length
    ? `<ul class="plan-compact">${items.map(item => `<li><span><strong>${escapeHTML(item.title)}</strong><small>${formatDate(item.nextDue)} · ${item.type === 'income' ? 'Ingreso' : 'Gasto'}</small></span><strong>${formatMoney(item.amount)}</strong></li>`).join('')}</ul>`
    : planEmpty('Organiza pagos fijos como arriendo, servicios y suscripciones.');
}

function renderRecurring() {
  const all = Object.values(state.recurring).sort((a, b) => Number(b.active) - Number(a.active) || a.nextDue.localeCompare(b.nextDue));
  const today = todayString();
  return `<div class="page-title-row"><div><h2>Movimientos recurrentes</h2><p>Programa un vencimiento y confirma cada pago o ingreso.</p></div><button class="primary-button" data-action="plan-edit" data-kind="recurring">${svg('plus')} Nuevo recurrente</button></div>
    <div class="plan-grid">${all.length ? all.map(item => {
      const late = item.active && item.nextDue < today;
      const status = !item.active ? 'En pausa' : late ? 'Vencido' : item.nextDue === today ? 'Vence hoy' : 'Programado';
      return `<article class="panel panel-pad plan-card"><div class="plan-card-top"><div><h3>${escapeHTML(item.title)}</h3><p>${item.type === 'income' ? 'Ingreso' : 'Gasto'} · ${frequencies[item.frequency]} · ${escapeHTML(walletLabel(item.walletId))}</p></div><span class="plan-status ${late ? 'late' : ''}">${status}</span></div>
        <strong class="plan-amount">${formatMoney(item.amount)}</strong><p>Próxima fecha: ${formatDate(item.nextDue, {dateStyle: 'medium'})}</p>
        <div class="account-actions">${item.active ? `<button class="secondary-button" data-action="confirm-recurring" data-id="${escapeHTML(item.id)}" data-due="${item.nextDue}">Registrar ${item.type === 'income' ? 'ingreso' : 'pago'}</button>` : ''}${editPlanButton('recurring', item.id, item.title)}</div></article>`;
    }).join('') : planEmpty('Aún no tienes movimientos recurrentes.')}</div>`;
}

function renderWallets() {
  const items = allWallets();
  const transfers = Object.values(state.transfers).sort((a, b) => b.date.localeCompare(a.date));
  return `<div class="page-title-row"><div><h2>Tus bolsillos</h2><p>Separa efectivo, Nequi o una cuenta bancaria. Los saldos se llevan de forma manual.</p></div><div class="account-actions"><button class="primary-button" data-action="plan-edit" data-kind="wallets">${svg('plus')} Nuevo bolsillo</button><button class="secondary-button" data-action="plan-edit" data-kind="transfers" ${items.length < 2 ? 'disabled title="Agrega otro bolsillo primero"' : ''}>Transferir</button></div></div>
    <div class="plan-grid">${items.map(wallet => `<article class="panel panel-pad plan-card"><div class="plan-card-top"><div><h3>${escapeHTML(wallet.name)}</h3><p>${wallet.id === 'general' ? 'Movimientos sin bolsillo asignado' : 'Saldo inicial: ' + formatMoney(wallet.openingBalance)}</p></div>${wallet.id === 'general' ? '' : editPlanButton('wallets', wallet.id, wallet.name)}</div><strong class="plan-amount">${formatMoney(window.SaldoPlanning.walletBalance(wallet, state.transactions, state.transfers))}</strong></article>`).join('')}</div>
    <section class="panel panel-pad activity-panel"><div class="section-heading"><div><h2>Transferencias</h2><p>Se reflejan en tus bolsillos y quedan fuera de ingresos y gastos.</p></div></div>
      ${transfers.length ? `<ul class="plan-compact">${transfers.map(item => `<li><span><strong>${escapeHTML(walletLabel(item.fromId))} → ${escapeHTML(walletLabel(item.toId))}</strong><small>${formatDate(item.date)}${item.note ? ' · ' + escapeHTML(item.note) : ''}</small></span><span class="plan-transfer-value"><strong>${formatMoney(item.amount)}</strong>${editPlanButton('transfers', item.id, 'transferencia')}</span></li>`).join('')}</ul>` : planEmpty('Las transferencias entre bolsillos aparecerán aquí.')}</section>`;
}

function renderGoals() {
  const entries = Object.values(state.goals);
  return `<div class="page-title-row"><div><h2>Metas de ahorro</h2><p>Lleva el progreso de lo que quieres ahorrar.</p></div><button class="primary-button" data-action="plan-edit" data-kind="goals">${svg('plus')} Nueva meta</button></div>
    <div class="plan-grid">${entries.length ? entries.map(goal => {
      const { complete, percent, barPercent, remaining } = window.SaldoPlanning.goalProgress(goal);
      return `<article class="panel panel-pad plan-card"><div class="plan-card-top"><div><h3>${escapeHTML(goal.name)}</h3><p>${goal.deadline ? 'Fecha objetivo: ' + formatDate(goal.deadline, {dateStyle:'medium'}) : 'Sin fecha objetivo'}</p></div>${editPlanButton('goals', goal.id, goal.name)}</div>
        <strong class="plan-amount">${formatMoney(goal.saved)} <small>de ${formatMoney(goal.target)}</small></strong>
        <div class="progress" role="progressbar" aria-label="Avance de ${escapeHTML(goal.name)}" aria-valuenow="${barPercent}" aria-valuemin="0" aria-valuemax="100"><div class="progress-fill" style="width:${barPercent}%"></div></div>
        <p>${complete ? 'Meta alcanzada' : 'Faltan ' + formatMoney(remaining)} · ${percent}%</p><button class="secondary-button" data-action="plan-edit" data-kind="contribution" data-id="${escapeHTML(goal.id)}">Anotar aporte</button></article>`;
    }).join('') : planEmpty('Crea una meta para un viaje, una compra o un fondo de emergencia.')}</div>`;
}

const toolTitles = Object.freeze({
  recurring: 'Movimiento recurrente', wallets: 'Bolsillo', transfers: 'Transferencia',
  goals: 'Meta de ahorro', contribution: 'Anotar aporte', categoryRules: 'Regla de categoría',
});

function toolNumber(id, name, label, value, { min = 1, max = 999999999999, required = true } = {}) {
  return `<div class="field"><label for="${id}">${label}</label><input id="${id}" name="${name}" inputmode="numeric" type="number" min="${min}" max="${max}" step="1" ${required ? 'required' : ''} value="${value ?? ''}"/></div>`;
}

function toolText(id, name, label, value, length = 48, required = true) {
  return `<div class="field"><label for="${id}">${label}</label><input id="${id}" name="${name}" type="text" maxlength="${length}" ${required ? 'required' : ''} value="${escapeHTML(value || '')}"/></div>`;
}

function toolDate(id, name, label, value, required = true) {
  return `<div class="field"><label for="${id}">${label}</label><input id="${id}" name="${name}" type="date" ${required ? 'required' : ''} value="${escapeHTML(value || '')}"/></div>`;
}

function toolSelect(id, name, label, options) {
  return `<div class="field"><label for="${id}">${label}</label><select id="${id}" name="${name}" required>${options}</select></div>`;
}

function categoryOptions(type, selected) {
  return CATEGORIES[type].map(name => `<option ${name === selected ? 'selected' : ''}>${escapeHTML(name)}</option>`).join('');
}

function renderToolFields(kind, existing) {
  if (kind === 'categoryRules') {
    const type = existing?.type || 'expense';
    return toolText('rule-pattern', 'pattern', 'Comercio o texto del concepto', existing?.pattern, 64)
      + toolSelect('rule-match', 'match', 'Coincidencia', `<option value="contains" ${existing?.match !== 'exact' ? 'selected' : ''}>Contiene estas palabras</option><option value="exact" ${existing?.match === 'exact' ? 'selected' : ''}>Igual al texto</option>`)
      + toolSelect('rule-type', 'type', 'Tipo de movimiento', `<option value="expense" ${type === 'expense' ? 'selected' : ''}>Gasto</option><option value="income" ${type === 'income' ? 'selected' : ''}>Ingreso</option>`)
      + toolSelect('rule-category', 'category', 'Categoría', categoryOptions(type, existing?.category))
      + `<label class="plan-checkbox"><input type="checkbox" name="active" ${existing?.active === false ? '' : 'checked'}/> Regla activa</label>`;
  }

  if (kind === 'wallets') return toolText('wallet-name', 'name', 'Nombre', existing?.name)
    + toolNumber('wallet-opening', 'openingBalance', 'Saldo inicial (COP)', existing?.openingBalance ?? 0, { min: -999999999999 })
    + '<p class="field-help">Anota el saldo de partida antes de los movimientos que vas a asignar a este bolsillo.</p>';
  if (kind === 'transfers') return toolSelect('transfer-from', 'fromId', 'Bolsillo de origen', walletOptions(existing?.fromId))
    + toolSelect('transfer-to', 'toId', 'Bolsillo de destino', walletOptions(existing?.toId || allWallets()[1]?.id))
    + toolNumber('transfer-amount', 'amount', 'Valor (COP)', existing?.amount)
    + toolDate('transfer-date', 'date', 'Fecha', existing?.date || todayString())
    + toolText('transfer-note', 'note', 'Nota (opcional)', existing?.note, 120, false);
  if (kind === 'goals') return toolText('goal-name', 'name', 'Nombre', existing?.name)
    + toolNumber('goal-target', 'target', 'Meta (COP)', existing?.target)
    + toolNumber('goal-saved', 'saved', 'Ahorrado hasta hoy (COP)', existing?.saved ?? 0, { min: 0 })
    + toolDate('goal-deadline', 'deadline', 'Fecha objetivo (opcional)', existing?.deadline, false);
  if (kind === 'contribution') return toolNumber('goal-contribution', 'amount', 'Aporte (COP)', null)
    + '<p class="field-help">Este aporte actualiza el avance de la meta. Para reflejar dinero movido entre bolsillos, registra también la transferencia.</p>';
  const type = existing?.type || 'expense';
  return toolText('recurring-title', 'title', 'Concepto', existing?.title, 80)
    + toolSelect('recurring-type', 'type', 'Tipo', `<option value="expense" ${type === 'expense' ? 'selected' : ''}>Gasto</option><option value="income" ${type === 'income' ? 'selected' : ''}>Ingreso</option>`)
    + toolSelect('recurring-category', 'category', 'Categoría', categoryOptions(type, existing?.category))
    + toolNumber('recurring-amount', 'amount', 'Valor (COP)', existing?.amount)
    + toolSelect('recurring-wallet', 'walletId', 'Bolsillo', walletOptions(existing?.walletId))
    + toolDate('recurring-date', 'nextDue', 'Próximo vencimiento', existing?.nextDue || todayString())
    + toolSelect('recurring-frequency', 'frequency', 'Frecuencia', Object.entries(frequencies).map(([id,label]) =>
      `<option value="${id}" ${(existing?.frequency || 'monthly') === id ? 'selected' : ''}>${label}</option>`).join(''))
    + toolNumber('recurring-lead', 'leadDays', 'Avisar con días de anticipación', existing?.leadDays ?? 1, { min: 0, max: 7 })
    + '<p class="field-help">El aviso se programa a las 8:00 a. m., hora de Colombia, si activaste push. Con 0 días, llega el día del vencimiento.</p>'
    + `<label class="plan-checkbox"><input type="checkbox" name="active" ${existing?.active === false ? '' : 'checked'}/> Recurrente activo</label>`;
}

function renderToolModal() {
  const { kind, id } = modal;
  const existing = state[kind === 'contribution' ? 'goals' : kind]?.[id];
  return `<div class="modal-backdrop" data-action="backdrop-close"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
    <div class="modal-header"><div><h2 id="modal-title">${toolTitles[kind]}</h2>${kind === 'contribution' ? `<p>${escapeHTML(existing?.name)}</p>` : ''}</div><button class="icon-button" data-action="close-modal" aria-label="Cerrar">${svg('close')}</button></div>
    <div class="modal-body"><form class="modal-form" id="plan-form">${renderToolFields(kind, existing)}
    <div class="modal-form-actions">${id && kind !== 'contribution' ? '<button class="danger-button" type="button" data-action="plan-remove">Eliminar</button>' : ''}<button type="button" class="secondary-button" data-action="close-modal">Cancelar</button><button class="primary-button" type="submit">${kind === 'contribution' ? 'Guardar aporte' : 'Guardar'}</button></div></form></div></section></div>`;
}

function saveToolForm(form) {
  const { kind, id = crypto.randomUUID() } = modal;
  const data = new FormData(form);
  const text = name => String(data.get(name) || '').trim();
  const number = name => Number(data.get(name));
  const draft = kind === 'wallets' ? { id, name: text('name'), openingBalance: number('openingBalance') }
    : kind === 'transfers' ? { id, fromId: text('fromId'), toId: text('toId'), amount: number('amount'), date: text('date'), note: text('note') }
    : kind === 'goals' ? { id, name: text('name'), target: number('target'), saved: number('saved'), deadline: text('deadline') }
    : kind === 'categoryRules' ? { id, pattern: text('pattern'), match: text('match'), type: text('type'), category: text('category'), active: data.has('active') }
    : kind === 'contribution' ? { ...state.goals[id], saved: (state.goals[id]?.saved || 0) + number('amount') }
    : {
      id, title: text('title'), type: text('type'), category: text('category'), amount: number('amount'),
      nextDue: text('nextDue'), frequency: text('frequency'), leadDays: number('leadDays'),
      dayOfMonth: state.recurring[id]?.nextDue === text('nextDue') ? state.recurring[id].dayOfMonth : Number(text('nextDue').slice(-2)),
      active: data.has('active'), walletId: text('walletId'),
    };
  const collection = kind === 'contribution' ? 'goals' : kind;
  if (kind === 'transfers' && draft.fromId === draft.toId) { toast('Elige dos bolsillos distintos.', 'error'); return; }
  if (kind === 'contribution' && !positiveAmount(number('amount'))) { toast('Escribe un aporte válido.', 'error'); return; }
  const next = normalizeState({ ...state, [collection]: { ...state[collection], [id]: draft } });
  if (!Object.hasOwn(next[collection], id)) { toast('Revisa que los datos estén completos y los valores sean válidos.', 'error'); return; }
  state = next;
  persist();
  modal = null;
  render();
  toast(kind === 'contribution' ? 'Aporte guardado.' : 'Cambios guardados.');
}

function handlePlanningAction(button) {
  const { action, view, kind, id, due } = button.dataset;
  if (action === 'planner-view') {
    if (!Object.hasOwn(plannerLabels, view)) return true;
    plannerView = view;
    activeTab = 'budgets';
    render();
    window.scrollTo(0, 0);
    return true;
  }
  if (action === 'plan-edit') {
    if (!Object.hasOwn(toolTitles, kind)) return true;
    modal = { type: 'planning', kind, id };
    render();
    root.querySelector('#plan-form input')?.focus();
    return true;
  }
  if (action === 'plan-remove') {
    const { kind: collection, id: itemId } = modal;
    if (collection === 'wallets' && (
      state.transactions.some(tx => tx.walletId === itemId) ||
      Object.values(state.transfers).some(item => item.fromId === itemId || item.toId === itemId) ||
      Object.values(state.recurring).some(item => item.walletId === itemId)
    )) { toast('Este bolsillo está en uso. Primero cambia sus movimientos, transferencias o recurrentes.', 'info'); return true; }
    if (!confirm('¿Eliminar este registro?')) return true;
    delete state[collection][itemId];
    persist();
    modal = null;
    render();
    toast('Registro eliminado.');
    return true;
  }
  if (action === 'confirm-recurring') {
    const item = state.recurring[id];
    if (!item?.active || item.nextDue !== due) return true;
    const sentence = item.type === 'income' ? 'Registrar ingreso' : 'Registrar pago';
    if (!confirm(sentence + ' de ' + formatMoney(item.amount) + ' con fecha ' + formatDate(item.nextDue) + ' y avanzar al siguiente vencimiento?')) return true;
    const occurrence = window.SaldoRecurrence.confirmRecurring(item);
    if (!occurrence) { toast('No se pudo preparar este vencimiento.', 'error'); return true; }
    const { transaction, next } = occurrence;
    if (!state.transactions.some(tx => tx.id === transaction.id)) state.transactions.push(transaction);
    state.recurring[id] = next;
    const alert = transaction.type === 'expense' ? checkBudgetAlerts(transaction.date.slice(0, 7), transaction.category) : '';
    persist();
    render();
    toast(alert || 'Movimiento registrado y próximo vencimiento actualizado.', alert ? 'info' : 'success');
    return true;
  }
  return false;
}
