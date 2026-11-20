const assert = require('node:assert/strict');
const test = require('node:test');
const { calendarEntries, monthForecast } = require('../saldo-calendar.js');
const { normalizeRecurring, advanceRecurring, confirmRecurring } = require('../saldo-recurrence.js');

const rule = (id, nextDue, changes = {}) => ({
  id, title: id, amount: 100, type: 'expense', category: 'Hogar', nextDue,
  frequency: 'weekly', active: true, ...changes,
});

const transaction = (id, date, changes = {}) => ({ id, title: id, date, type: 'expense', amount: 100, ...changes });
const occurrence = (id, due, changes = {}) => transaction('rec-' + id + '-' + due, due, { title: id, ...changes });
const fromItems = (...items) => Object.fromEntries(items.map(item => [item.id, item]));
const dates = entries => entries.map(item => item.date);

test('el calendario sin reglas ni movimientos está vacío', () => {
  assert.deepEqual(calendarEntries(undefined, undefined, '2026-05-20'), []);
});

test('el rango de siete días incluye hoy y los seis días siguientes', () => {
  const rules = fromItems(rule('hoy', '2026-05-20'), rule('limite', '2026-05-26'), rule('fuera', '2026-05-27'));
  assert.deepEqual(dates(calendarEntries(rules, [], '2026-05-20', 7)), ['2026-05-20', '2026-05-26']);
});

test('el rango de treinta días incluye el día treinta y cruza al siguiente mes', () => {
  const rules = fromItems(rule('limite', '2026-06-18'), rule('fuera', '2026-06-19'));
  assert.deepEqual(dates(calendarEntries(rules, [], '2026-05-20', 30)), ['2026-06-18']);
});

test('un vencimiento de hoy figura pendiente y se puede confirmar', () => {
  const entries = calendarEntries(fromItems(rule('servicio', '2026-05-20')), [], '2026-05-20');
  assert.deepEqual(entries, [{
    id: 'rec-servicio-2026-05-20', ruleId: 'servicio', title: 'servicio', type: 'expense',
    amount: 100, date: '2026-05-20', status: 'pending', canConfirm: true,
  }]);
});

test('una regla anterior muestra su fecha vencida sin proyectar otra', () => {
  const rules = fromItems(rule('servicio', '2026-05-01'));
  const entries = calendarEntries(rules, [], '2026-05-20');
  assert.deepEqual(entries.map(({ date, status, canConfirm }) => [date, status, canConfirm]), [
    ['2026-05-01', 'overdue', true],
  ]);
});

test('un próximo vencimiento activo permite confirmar solo su primera fecha', () => {
  const entries = calendarEntries(fromItems(rule('cobro', '2026-05-21', { type: 'income' })), [], '2026-05-20', 30);
  assert.deepEqual(dates(entries), ['2026-05-21']);
  assert.deepEqual(entries.map(entry => entry.canConfirm), [true]);
  assert.ok(entries.every(entry => entry.type === 'income'));
});

test('si la fecha está registrada, muestra el movimiento sin programar otra fecha', () => {
  const rules = fromItems(rule('servicio', '2026-05-01'));
  const entries = calendarEntries(rules, [occurrence('servicio', '2026-05-01')], '2026-05-20', 30);
  assert.deepEqual(entries.map(({ date, status, canConfirm }) => [date, status, canConfirm]), [
    ['2026-05-01', 'recorded', false],
  ]);
});

test('un registro reemplaza la vista previa del mismo día y conserva el importe registrado', () => {
  const rules = fromItems(rule('servicio', '2026-05-20'));
  const entries = calendarEntries(rules, [occurrence('servicio', '2026-05-20', { amount: 225 })], '2026-05-20');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].amount, 225);
  assert.equal(entries[0].status, 'recorded');
  assert.equal(entries[0].canConfirm, false);
});

test('conserva registrados aunque se elimine o pause la regla original', () => {
  const rules = fromItems(rule('pausado', '2026-05-20', { active: false }));
  const entries = calendarEntries(rules, [occurrence('borrado', '2026-05-19'), occurrence('pausado', '2026-05-20')], '2026-05-20');
  assert.deepEqual(entries.map(({ ruleId, status }) => [ruleId, status]), [['borrado', 'recorded'], ['pausado', 'recorded']]);
});

test('usa la fecha de ocurrencia del identificador aunque se cambie la fecha del movimiento', () => {
  const entries = calendarEntries({}, [occurrence('regla-con-guiones', '2026-05-19', { date: '2026-05-18' })], '2026-05-20');
  assert.equal(entries[0].ruleId, 'regla-con-guiones');
  assert.equal(entries[0].date, '2026-05-19');
});

test('incluye registros recientes hasta los límites y omite fuera del rango', () => {
  const transactions = ['2026-05-13', '2026-05-14', '2026-05-26', '2026-05-27'].map(date => occurrence('servicio', date));
  assert.deepEqual(dates(calendarEntries({}, transactions, '2026-05-20')), ['2026-05-14', '2026-05-26']);
});

test('ignora movimientos ordinarios, fechas inválidas e identificadores inseguros', () => {
  const transactions = [transaction('uuid-1', '2026-05-20'), occurrence('servicio', '2026-02-30'), occurrence('constructor', '2026-05-20')];
  assert.deepEqual(calendarEntries({}, transactions, '2026-05-20'), []);
});

test('incluye una fecha única de febrero bisiesto y conserva los vencimientos de enero', () => {
  const rules = fromItems(rule('servicio', '2028-01-31', { frequency: 'monthly', dayOfMonth: 31 }),
    rule('febrero', '2028-02-29', { frequency: 'once' }));
  assert.deepEqual(dates(calendarEntries(rules, [], '2028-02-05', 30)), ['2028-01-31', '2028-02-29']);
  assert.deepEqual(dates(calendarEntries(rules, [], '2028-03-25', 7)), ['2028-01-31', '2028-02-29']);
});

test('el calendario limita los extremos del año aceptado sin cambiar el estado de hoy', () => {
  const early = calendarEntries(fromItems(rule('inicio', '0001-01-01')), [], '0001-01-01', 30);
  assert.equal(early[0].status, 'pending');
  const late = calendarEntries(fromItems(rule('fin', '9999-12-31')), [], '9999-12-31', 30);
  assert.deepEqual(dates(late), ['9999-12-31']);
});

test('una regla semanal muy antigua muestra solo su vencimiento pendiente', () => {
  const entries = calendarEntries(fromItems(rule('antiguo', '0001-01-01')), [], '2026-05-20');
  assert.deepEqual(dates(entries), ['0001-01-01']);
});

test('las fechas inválidas o un número de días fuera de rango devuelven una lista vacía', () => {
  const rules = fromItems(rule('servicio', '2026-05-20'));
  assert.deepEqual(calendarEntries(rules, [], '2026-02-30'), []);
  for (const days of [0, 31, '7', 7.5]) assert.deepEqual(calendarEntries(rules, [], '2026-05-20', days), []);
});

test('el estimado combina saldos iniciales positivos y negativos con ingresos y gastos hasta hoy', () => {
  const state = {
    wallets: { banco: { openingBalance: 500 }, efectivo: { openingBalance: -100 } },
    transactions: [transaction('sueldo', '2026-05-01', { type: 'income', amount: 200 }), transaction('compra', '2026-05-20')],
    transfers: { interno: { fromId: 'banco', toId: 'efectivo', amount: 300, date: '2026-05-19' } },
  };
  assert.deepEqual(monthForecast(state, '2026-05-20'), { registered: 500, pending: 0, futureRecorded: 0, available: 500 });
});

test('el saldo de hoy no incluye movimientos que tienen fecha futura', () => {
  const state = { transactions: [transaction('futuro', '2026-05-21', { type: 'income', amount: 500 }), transaction('hoy', '2026-05-20')] };
  assert.deepEqual(monthForecast(state, '2026-05-20'), { registered: -100, pending: 0, futureRecorded: 0, available: -100 });
});

test('el estimado reserva pagos únicos hasta fin de mes, incluidos los vencidos', () => {
  const state = { recurring: fromItems(rule('semanal', '2026-04-24'), rule('junio', '2026-06-01')) };
  assert.deepEqual(monthForecast(state, '2026-05-20'), { registered: 0, pending: 100, futureRecorded: 0, available: -100 });
});

test('el estimado del mes solo cuenta una fecha por cada programación antigua', () => {
  const state = { recurring: fromItems(rule('mensual', '2028-01-31', { frequency: 'monthly', dayOfMonth: 31 })) };
  assert.equal(monthForecast(state, '2028-02-01').pending, 100);
  assert.equal(monthForecast(state, '2028-03-01').pending, 100);
});

test('las reglas de ingreso y las reglas pausadas no reducen la disponibilidad', () => {
  const state = { recurring: fromItems(rule('cobro', '2026-05-20', { type: 'income' }), rule('pausa', '2026-05-20', { active: false })) };
  assert.deepEqual(monthForecast(state, '2026-05-20'), { registered: 0, pending: 0, futureRecorded: 0, available: 0 });
});

test('un pago registrado queda fuera del total pendiente aunque la regla siga activa', () => {
  const state = { recurring: fromItems(rule('servicio', '2026-05-01')), transactions: [occurrence('servicio', '2026-05-01')] };
  assert.deepEqual(monthForecast(state, '2026-05-20'), { registered: -100, pending: 0, futureRecorded: 0, available: -100 });
});

test('un registro de otro día no descuenta un vencimiento que no le corresponde', () => {
  const state = { recurring: fromItems(rule('servicio', '2026-05-01')), transactions: [occurrence('servicio', '2026-05-02')] };
  assert.equal(monthForecast(state, '2026-05-20').pending, 100);
});

test('un pago registrado con fecha anterior al próximo vencimiento no reduce dos veces el estimado', () => {
  const state = { recurring: fromItems(rule('servicio', '2026-05-08')), transactions: [occurrence('servicio', '2026-05-01')] };
  assert.deepEqual(monthForecast(state, '2026-05-20'), { registered: -100, pending: 100, futureRecorded: 0, available: -200 });
});

test('el estimado omite entradas incompletas o sin importes y responde a un día inexistente', () => {
  const state = { wallets: { invalido: { openingBalance: '300' } }, transactions: [null, transaction('cero', '2026-05-19', { amount: 0 })] };
  const empty = { registered: 0, pending: 0, futureRecorded: 0, available: 0 };
  assert.deepEqual(monthForecast(state, '2026-05-20'), empty);
  assert.deepEqual(monthForecast(state, '2026-05-99'), empty);
  assert.deepEqual(monthForecast(undefined, '2026-05-20'), empty);
});

test('todas las fechas incluye futuros lejanos, pausados antiguos e historial registrado', () => {
  const rules = fromItems(rule('lejano', '2027-11-05', { frequency: 'once' }),
    rule('pausado', '2026-01-01', { active: false }));
  const transactions = [occurrence('anterior', '2025-12-31')];
  assert.deepEqual(calendarEntries(rules, transactions, '2026-05-20', 30), []);
  assert.deepEqual(calendarEntries(rules, transactions, '2026-05-20', 'all').map(({ date, status }) => [date, status]), [
    ['2025-12-31', 'recorded'], ['2026-01-01', 'paused'], ['2027-11-05', 'pending'],
  ]);
});

test('una programación pausada nunca se puede registrar hasta que vuelva a estar activa', () => {
  const inactive = rule('pausa', '2026-05-21', { frequency: 'once', active: false });
  assert.equal(calendarEntries(fromItems(inactive), [], '2026-05-20')[0].canConfirm, false);
  assert.equal(confirmRecurring(inactive), null);
});

test('una programación única queda inactiva y conserva la fecha al confirmar', () => {
  const scheduled = rule('unico', '2026-05-20', { frequency: 'once', walletId: 'mi-bolsillo' });
  assert.equal(normalizeRecurring(fromItems(scheduled)).unico.frequency, 'once');
  assert.equal(advanceRecurring(scheduled), null);
  const { transaction, next } = confirmRecurring(scheduled);
  assert.equal(transaction.id, 'rec-unico-2026-05-20');
  assert.equal(transaction.walletId, 'mi-bolsillo');
  assert.equal(next.nextDue, '2026-05-20');
  assert.equal(next.active, false);
  assert.equal(confirmRecurring(next), null);
  assert.deepEqual(calendarEntries(fromItems(next), [transaction], '2026-05-20', 'all').map(item => item.status), ['recorded']);
});

test('confirmar antes de la fecha mantiene la disponibilidad estimada sin descontar dos veces', () => {
  const scheduled = rule('adelantado', '2026-05-21', { frequency: 'once' });
  const before = { wallets: { ahorros: { openingBalance: 250 } }, recurring: fromItems(scheduled) };
  const { transaction, next } = confirmRecurring(scheduled);
  const after = { ...before, recurring: fromItems(next), transactions: [transaction] };
  assert.deepEqual(monthForecast(before, '2026-05-20'), {
    registered: 250, pending: 100, futureRecorded: 0, available: 150,
  });
  assert.deepEqual(monthForecast(after, '2026-05-20'), {
    registered: 250, pending: 0, futureRecorded: 100, available: 150,
  });
  assert.deepEqual(monthForecast(after, '2026-05-21'), {
    registered: 150, pending: 0, futureRecorded: 0, available: 150,
  });
});

test('separa los gastos registrados a futuro de los ingresos previstos y del mes siguiente', () => {
  const transactions = [
    transaction('manual', '2026-05-30', { amount: 75 }),
    transaction('cobro', '2026-05-31', { type: 'income', amount: 200 }),
    transaction('junio', '2026-06-01', { amount: 90 }),
  ];
  assert.deepEqual(monthForecast({ transactions }, '2026-05-20'), {
    registered: 0, pending: 0, futureRecorded: 75, available: -75,
  });
});
