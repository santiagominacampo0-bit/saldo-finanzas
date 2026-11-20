const plannerLabels = Object.freeze({
  budgets: 'Presupuestos',
  calendar: 'Calendario',
  wallets: 'Bolsillos',
  goals: 'Metas',
});

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

function nequiWallet() {
  return Object.values(state.wallets).find(wallet => searchable(wallet.name) === 'nequi');
}

function renderWalletHistory(wallet, transactions, transfers, open) {
  const entries = transactions.map(tx => ({
    title: tx.title || tx.category,
    date: tx.date,
    detail: [tx.type === 'income' ? 'Ingreso' : 'Gasto', tx.category, tx.merchant].filter(Boolean).join(' · '),
    amount: tx.type === 'income' ? tx.amount : -tx.amount,
  }));
  for (const transfer of transfers) {
    const incoming = transfer.toId === wallet.id;
    entries.push({
      title: incoming ? 'Transferencia desde ' + walletLabel(transfer.fromId) : 'Transferencia a ' + walletLabel(transfer.toId),
      date: transfer.date, detail: transfer.note, amount: incoming ? transfer.amount : -transfer.amount,
    });
  }
  entries.sort((a, b) => b.date.localeCompare(a.date));

  return `<details class="wallet-history" data-wallet-history="${escapeHTML(wallet.id)}" ${open ? 'open' : ''}>
    <summary aria-label="Historial de ${escapeHTML(wallet.name)}">Historial <small>${entries.length}</small></summary>
    ${entries.length ? `<ul class="wallet-history-list plan-compact">${entries.map(entry => `<li>
      <span><strong>${escapeHTML(entry.title)}</strong><small><time datetime="${escapeHTML(entry.date)}">${formatDate(entry.date, { dateStyle: 'medium' })}</time>${entry.detail ? ' · ' + escapeHTML(entry.detail) : ''}</small></span>
      <strong class="wallet-history-amount ${entry.amount > 0 ? 'incoming' : ''}">${entry.amount > 0 ? '+' : '−'}${formatMoney(Math.abs(entry.amount))}</strong>
    </li>`).join('')}</ul>` : '<p>Los movimientos de este bolsillo aparecerán aquí.</p>'}</details>`;
}

function renderNequiComparison() {
  return `<details class="wallet-nequi">
    <summary>Comparar con Nequi</summary>
    <p>Compara con tus registros hasta hoy. Usa el Disponible si registras solo ese dinero. Si también registras fondos de Bolsillos, Metas o Colchón, súmalos al monto que vas a comparar.</p>
    <form id="wallet-nequi-compare" class="wallet-reconcile">
      <div class="field"><label for="wallet-nequi-balance">Saldo de hoy en Nequi (COP)</label><input id="wallet-nequi-balance" name="balance" type="text" inputmode="decimal" maxlength="15" pattern="[0-9]{1,12}([.,][0-9]{1,2})?" aria-describedby="nequi-balance-hint" required /><small id="nequi-balance-hint" class="field-help">Hasta dos decimales. Ejemplo 123456,78.</small></div>
      <button class="secondary-button" type="submit">Comparar</button>
      <output for="wallet-nequi-balance" role="status" aria-live="polite" aria-atomic="true"></output>
    </form>
    <a class="text-button" href="https://ayuda.nequi.com.co/hc/es/articles/35533244922637" target="_blank" rel="noopener noreferrer">Cómo descargar extractos de Nequi</a>
  </details>`;
}

function renderWallets() {
  const items = allWallets();
  const transfers = Object.values(state.transfers).sort((a, b) => b.date.localeCompare(a.date));
  const ledger = new Map(items.map(wallet => [wallet.id, { transactions: [], transfers: [] }]));
  const existingNequi = nequiWallet();
  const opened = new Set(Array.from(root.querySelectorAll('.wallet-history[open]'), detail => detail.dataset.walletHistory));

  for (const tx of state.transactions) ledger.get(tx.walletId || 'general')?.transactions.push(tx);
  for (const transfer of transfers) {
    ledger.get(transfer.fromId)?.transfers.push(transfer);
    ledger.get(transfer.toId)?.transfers.push(transfer);
  }

  let total = 0;
  const cards = items.map(wallet => {
    const activity = ledger.get(wallet.id);
    const balance = window.SaldoPlanning.walletBalance(wallet, activity.transactions, activity.transfers);
    total += balance;

    return `<article class="panel panel-pad plan-card">
      <div class="plan-card-top"><div><h3>${escapeHTML(wallet.name)}</h3><p>${wallet.id === 'general' ? 'Movimientos sin bolsillo asignado' : 'Saldo inicial: ' + formatMoney(wallet.openingBalance)}</p></div>
      ${wallet.id === 'general' ? '' : editPlanButton('wallets', wallet.id, wallet.name)}</div>
      <strong class="plan-amount">${formatMoney(balance)}</strong>
      ${renderWalletHistory(wallet, activity.transactions, activity.transfers, opened.has(wallet.id))}
      ${wallet.id === existingNequi?.id ? renderNequiComparison() : ''}</article>`;
  });

  return `<div class="page-title-row"><div><h2>Tus bolsillos</h2><p>Organiza efectivo, Nequi o una cuenta con tus registros manuales.</p></div>
    <div class="account-actions"><button class="primary-button" data-action="plan-edit" data-kind="wallets">${svg('plus')} Nuevo bolsillo</button><button class="secondary-button" data-action="plan-edit" data-kind="transfers" ${items.length < 2 ? 'disabled title="Agrega otro bolsillo primero"' : ''}>Transferir</button><button class="text-button" data-action="plan-nequi">Configurar Nequi</button></div></div>
    <section class="panel panel-pad wallet-total" aria-labelledby="wallet-total-title"><div><h3 id="wallet-total-title">Total registrado</h3><p>Incluye saldos iniciales y movimientos de cualquier fecha. Cada transferencia se registra como salida de un bolsillo y entrada de otro.</p></div><strong class="plan-amount">${formatMoney(total)}</strong></section>
    <div class="plan-grid wallet-grid">${cards.join('')}</div>
    <section class="panel panel-pad activity-panel"><div class="section-heading"><div><h2>Transferencias</h2><p>Consulta y edita los traspasos entre bolsillos.</p></div></div>
      ${transfers.length ? `<ul class="plan-compact">${transfers.map(item => `<li><span><strong>${escapeHTML(walletLabel(item.fromId))} → ${escapeHTML(walletLabel(item.toId))}</strong><small>${formatDate(item.date)}${item.note ? ' · ' + escapeHTML(item.note) : ''}</small></span><span class="plan-transfer-value"><strong>${formatMoney(item.amount)}</strong>${editPlanButton('transfers', item.id, 'transferencia')}</span></li>`).join('')}</ul>` : planEmpty('Las transferencias entre bolsillos aparecerán aquí.')}</section>`;
}

function reviewNequiBalance(form) {
  const wallet = nequiWallet();
  if (!wallet || !form.reportValidity()) return;
  const [pesos, decimals = ''] = form.elements.balance.value.replace(',', '.').split('.');
  const enteredCents = Number(pesos) * 100 + Number(decimals.padEnd(2, '0'));
  const today = todayString();
  const transactions = state.transactions.filter(tx => tx.date <= today);
  const transfers = Object.values(state.transfers).filter(item => item.date <= today);
  const recorded = window.SaldoPlanning.walletBalance(wallet, transactions, transfers);
  const differenceCents = enteredCents - recorded * 100;
  const gap = Math.abs(differenceCents) / 100;
  const formattedGap = differenceCents % 100 === 0 ? formatMoney(gap) : new Intl.NumberFormat('es-CO', {
    style: 'currency', currency: 'COP', minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(gap);
  form.querySelector('output').textContent = differenceCents === 0 ? 'Los saldos coinciden en ' + formatMoney(recorded) + '.'
    : 'Tu saldo en Nequi es ' + formattedGap + (differenceCents > 0 ? ' mayor' : ' menor') + ' que el registrado en Saldo (' + formatMoney(recorded) + ').';
}

document.addEventListener('input', event => {
  if (event.target.id === 'wallet-nequi-balance') event.target.form.querySelector('output').textContent = '';
});

document.addEventListener('submit', event => {
  if (event.target.id !== 'wallet-nequi-compare') return;
  event.preventDefault();
  reviewNequiBalance(event.target);
});

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
  scheduled: 'Movimiento programado', wallets: 'Bolsillo', transfers: 'Transferencia',
  goals: 'Meta de ahorro', contribution: 'Anotar aporte', categoryRules: 'Regla de categoría',
});

function planCollection(kind) {
  if (kind === 'scheduled') return 'recurring';
  return kind === 'contribution' ? 'goals' : kind;
}

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

  if (kind === 'wallets') return toolText('wallet-name', 'name', 'Nombre', existing?.name || (modal.setupNequi ? 'Nequi' : ''))
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
  return toolText('scheduled-title', 'title', 'Concepto', existing?.title, 80)
    + toolSelect('scheduled-type', 'type', 'Tipo', `<option value="expense" ${type === 'expense' ? 'selected' : ''}>Gasto</option><option value="income" ${type === 'income' ? 'selected' : ''}>Ingreso</option>`)
    + toolSelect('scheduled-category', 'category', 'Categoría', categoryOptions(type, existing?.category))
    + toolNumber('scheduled-amount', 'amount', 'Valor (COP)', existing?.amount)
    + toolSelect('scheduled-wallet', 'walletId', 'Bolsillo', walletOptions(existing?.walletId))
    + toolDate('scheduled-date', 'nextDue', 'Fecha programada', existing?.nextDue || todayString())
    + toolNumber('scheduled-lead', 'leadDays', 'Avisar con días de anticipación', existing?.leadDays ?? 1, { min: 0, max: 7 })
    + '<p class="field-help">Si activaste las notificaciones push, Saldo te avisa a las 8:00 a. m. de Colombia. Con 0 días, el aviso llega el día programado.</p>'
    + `<label class="plan-checkbox"><input type="checkbox" name="active" ${existing?.active === false ? '' : 'checked'}/> Movimiento activo</label>`;
}

function renderToolModal() {
  const { kind, id } = modal;
  const existing = state[planCollection(kind)]?.[id];
  return `<div class="modal-backdrop" data-action="backdrop-close"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
    <div class="modal-header"><div><h2 id="modal-title">${toolTitles[kind]}</h2>${kind === 'contribution' ? `<p>${escapeHTML(existing?.name)}</p>` : ''}</div><button class="icon-button" data-action="close-modal" aria-label="Cerrar">${svg('close')}</button></div>
    <div class="modal-body"><form class="modal-form" id="plan-form">${renderToolFields(kind, existing)}
    <div class="modal-form-actions">${id && kind !== 'contribution' ? '<button class="danger-button" type="button" data-action="plan-remove">Eliminar</button>' : ''}<button type="button" class="secondary-button" data-action="close-modal">Cancelar</button><button class="primary-button" type="submit">${kind === 'contribution' ? 'Guardar aporte' : 'Guardar'}</button></div></form></div></section></div>`;
}

function saveToolForm(form) {
  const { kind, setupNequi } = modal;
  const data = new FormData(form);
  const text = name => String(data.get(name) || '').trim();
  const initialNequi = setupNequi && !modal.id && searchable(text('name')) === 'nequi';
  const existingNequi = initialNequi ? nequiWallet() : null;
  if (existingNequi) {
    modal.id = existingNequi.id;
    render();
    toast('Ya tienes un bolsillo Nequi. Puedes revisar su saldo inicial.', 'info');
    return;
  }
  const id = modal.id || (initialNequi && !Object.hasOwn(state.wallets, 'nequi') ? 'nequi' : crypto.randomUUID());
  const number = name => Number(data.get(name));
  const draft = kind === 'wallets' ? { id, name: text('name'), openingBalance: number('openingBalance') }
    : kind === 'transfers' ? { id, fromId: text('fromId'), toId: text('toId'), amount: number('amount'), date: text('date'), note: text('note') }
    : kind === 'goals' ? { id, name: text('name'), target: number('target'), saved: number('saved'), deadline: text('deadline') }
    : kind === 'categoryRules' ? { id, pattern: text('pattern'), match: text('match'), type: text('type'), category: text('category'), active: data.has('active') }
    : kind === 'contribution' ? { ...state.goals[id], saved: (state.goals[id]?.saved || 0) + number('amount') }
    : {
      id, title: text('title'), type: text('type'), category: text('category'), amount: number('amount'),
      nextDue: text('nextDue'), frequency: 'once', leadDays: number('leadDays'),
      active: data.has('active'), walletId: text('walletId'),
    };
  const collection = planCollection(kind);
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
  if (action === 'plan-nequi') {
    modal = { type: 'planning', kind: 'wallets', id: nequiWallet()?.id, setupNequi: true };
    render();
    root.querySelector('#wallet-opening')?.focus({ preventScroll: true });
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
    const { kind: itemKind, id: itemId } = modal;
    const collection = planCollection(itemKind);
    if (collection === 'wallets' && (
      state.transactions.some(tx => tx.walletId === itemId) ||
      Object.values(state.transfers).some(item => item.fromId === itemId || item.toId === itemId) ||
      Object.values(state.recurring).some(item => item.walletId === itemId)
    )) { toast('Este bolsillo está en uso. Primero cambia sus movimientos, transferencias o movimientos programados.', 'info'); return true; }
    if (!confirm(itemKind === 'scheduled' ? '¿Eliminar este movimiento del calendario?' : '¿Eliminar este registro?')) return true;
    delete state[collection][itemId];
    persist();
    modal = null;
    render();
    toast('Registro eliminado.');
    return true;
  }
  if (action === 'confirm-scheduled') {
    const item = state.recurring[id];
    if (!item?.active || item.nextDue !== due) return true;
    const sentence = item.type === 'income' ? '¿Registrar cobro' : '¿Registrar pago';
    if (!confirm(sentence + ' de ' + formatMoney(item.amount) + ' con fecha ' + formatDate(item.nextDue) + '?')) return true;
    const occurrence = window.SaldoRecurrence.confirmRecurring({ ...item, frequency: 'once' });
    if (!occurrence) { toast('No se pudo preparar este vencimiento.', 'error'); return true; }
    const { transaction, next } = occurrence;
    if (!state.transactions.some(tx => tx.id === transaction.id)) state.transactions.push(transaction);
    state.recurring[id] = next;
    const alert = transaction.type === 'expense' ? checkBudgetAlerts(transaction.date.slice(0, 7), transaction.category) : '';
    persist();
    render();
    toast(alert || 'Movimiento registrado.', alert ? 'info' : 'success');
    return true;
  }
  return false;
}
