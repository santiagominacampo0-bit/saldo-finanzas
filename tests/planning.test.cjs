const assert = require('node:assert/strict');
const test = require('node:test');
const {
  GENERAL_WALLET, normalizeWallets, normalizeTransfers, normalizeGoals, walletBalance, goalProgress,
} = require('../saldo-planning.js');

const wallet = (id, extra = {}) => ({ id, name: id, openingBalance: 0, ...extra });
const transfer = (extra = {}) => ({ id: 'traslado', fromId: 'general', toId: 'nequi', amount: 50000, date: '2026-02-14', note: '', ...extra });
const goal = (extra = {}) => ({ id: 'viaje', name: 'Viaje', target: 100000, saved: 58000, deadline: '2026-09-30', ...extra });
const allowedWallets = { nequi: wallet('nequi'), banco: wallet('banco') };

test('el bolsillo General es virtual e inmutable', () => {
  assert.deepEqual(GENERAL_WALLET, { id: 'general', name: 'General', openingBalance: 0 });
  assert.equal(Object.isFrozen(GENERAL_WALLET), true);
  assert.deepEqual(normalizeWallets({ general: wallet('general') }), {});
});

test('normaliza un bolsillo y conserva su saldo inicial negativo', () => {
  const pockets = normalizeWallets({ nequi: wallet('nequi', { name: ' Mi Nequi ', openingBalance: -3000, bankToken: 'ignorar' }) });
  assert.deepEqual(pockets, { nequi: { id: 'nequi', name: 'Mi Nequi', openingBalance: -3000 } });
});

test('usa cero cuando falta un saldo inicial', () => {
  assert.equal(normalizeWallets({ nequi: { id: 'nequi', name: 'Nequi' } }).nequi.openingBalance, 0);
});

test('rechaza identificadores inválidos o que no coinciden con su clave', () => {
  assert.deepEqual(normalizeWallets({ nequi: wallet('banco'), '/x': wallet('/x'), '-suelo': wallet('-suelo') }), {});
});

test('rechaza las claves heredadas y evita contaminación del prototipo', () => {
  const candidates = JSON.parse('{"__proto__":{"id":"__proto__","name":"Falso"},"constructor":{"id":"constructor","name":"Falso"},"prototype":{"id":"prototype","name":"Falso"}}');
  assert.deepEqual(normalizeWallets(candidates), {});
  assert.deepEqual(normalizeTransfers(candidates), {});
  assert.deepEqual(normalizeGoals(candidates), {});
});

test('las colecciones ausentes, nulas y los arreglos se tratan como vacíos', () => {
  for (const normalize of [normalizeWallets, normalizeTransfers, normalizeGoals]) {
    for (const invalid of [null, undefined, false, 'falso', []]) assert.deepEqual(normalize(invalid), {});
  }
});

test('limita el nombre de un bolsillo a 48 caracteres y evita nombres vacíos', () => {
  const pockets = normalizeWallets({ nequi: wallet('nequi', { name: 'a'.repeat(60) }), vacio: wallet('vacio', { name: '  ' }) });
  assert.equal(pockets.nequi.name.length, 48);
  assert.equal(Object.hasOwn(pockets, 'vacio'), false);
});

for (const openingBalance of [0.25, Infinity, 1000000000000, '10000']) {
  test(`rechaza un saldo inicial inválido ${openingBalance}`, () => {
    assert.deepEqual(normalizeWallets({ nequi: wallet('nequi', { openingBalance }) }), {});
  });
}

test('normaliza un traslado y permite usar General en cualquiera de los extremos', () => {
  const toNequi = transfer({ note: ' Ahorro del mes ' });
  const toGeneral = transfer({ id: 'regreso', fromId: 'banco', toId: 'general' });
  const movements = normalizeTransfers({ traslado: toNequi, regreso: toGeneral }, allowedWallets);
  assert.deepEqual(movements, { traslado: { ...toNequi, note: 'Ahorro del mes' }, regreso: toGeneral });
});

test('rechaza traslados hacia o desde bolsillos inexistentes cuando se conoce el catálogo', () => {
  assert.deepEqual(normalizeTransfers({ traslado: transfer({ toId: 'borrado' }) }, allowedWallets), {});
  assert.deepEqual(normalizeTransfers({ traslado: transfer({ fromId: 'borrado' }) }, allowedWallets), {});
});

test('admite validar un traslado sin catálogo de bolsillos', () => {
  assert.deepEqual(normalizeTransfers({ traslado: transfer() }), { traslado: transfer() });
});

test('rechaza traslados al mismo bolsillo y notas sin texto estructurado', () => {
  assert.deepEqual(normalizeTransfers({ traslado: transfer({ toId: 'general' }) }, allowedWallets), {});
  assert.equal(normalizeTransfers({ traslado: transfer({ note: { texto: 'nota' } }) }, allowedWallets).traslado.note, '');
});

for (const amount of [0, -1000, 1.5, '50000']) {
  test(`rechaza un importe de traslado inválido ${amount}`, () => {
    assert.deepEqual(normalizeTransfers({ traslado: transfer({ amount }) }, allowedWallets), {});
  });
}

test('valida fechas reales y acepta 29 de febrero en año bisiesto', () => {
  const invalid = transfer({ date: '2026-02-29' });
  const valid = transfer({ id: 'bisiesto', date: '2028-02-29' });
  assert.deepEqual(normalizeTransfers({ traslado: invalid, bisiesto: valid }, allowedWallets), { bisiesto: valid });
});

test('limita las notas del traslado a 120 caracteres', () => {
  const movements = normalizeTransfers({ traslado: transfer({ note: 'x'.repeat(200) }) }, allowedWallets);
  assert.equal(movements.traslado.note.length, 120);
});

test('un traslado mueve dinero entre bolsillos sin cambiar el saldo total', () => {
  const transactions = [
    { type: 'income', amount: 200000 },
    { type: 'expense', amount: 25000 },
    { type: 'expense', amount: 10000, walletId: 'nequi' },
    { type: 'income', amount: 40000, walletId: 'banco' },
  ];
  const transfers = { traslado: transfer() };
  assert.equal(walletBalance(GENERAL_WALLET, transactions, transfers), 125000);
  assert.equal(walletBalance(allowedWallets.nequi, transactions, transfers), 40000);
  const pockets = [GENERAL_WALLET, ...Object.values(allowedWallets)];
  assert.equal(pockets.reduce((total, pocket) => total + walletBalance(pocket, transactions, transfers), 0), 205000);
});

test('combina saldo inicial con entradas, salidas y traslados del bolsillo', () => {
  const nequi = wallet('nequi', { openingBalance: 100000 });
  const transactions = [{ type: 'income', amount: 15000, walletId: 'nequi' }, { type: 'expense', amount: 3000, walletId: 'nequi' }];
  const movements = [transfer(), transfer({ id: 'saliente', toId: 'banco', fromId: 'nequi', amount: 20000 })];
  assert.equal(walletBalance(nequi, transactions, movements), 142000);
});

test('ignora importes inválidos, tipos desconocidos y traslados contablemente vacíos', () => {
  const invalidTransactions = [{ type: 'income', amount: NaN }, { type: 'expense', amount: -2000 }, { type: 'refund', amount: 5000 }];
  const invalidTransfers = [transfer({ toId: 'general' }), transfer({ toId: 'bad/endpoint' }), transfer({ amount: -200 })];
  assert.equal(walletBalance(GENERAL_WALLET, invalidTransactions, invalidTransfers), 0);
});

test('conserva el avance de una meta cuando supera el objetivo', () => {
  const item = goal({ saved: 115000 });
  assert.deepEqual(normalizeGoals({ viaje: item }), { viaje: item });
  assert.deepEqual(goalProgress(item), { remaining: 0, percent: 115, barPercent: 100, complete: true });
});

test('una meta puede comenzar sin ahorro ni fecha', () => {
  const result = normalizeGoals({ viaje: { id: 'viaje', name: 'Viaje', target: 100000 } });
  assert.deepEqual(result.viaje, goal({ saved: 0, deadline: '' }));
  assert.deepEqual(goalProgress(result.viaje), { remaining: 100000, percent: 0, barPercent: 0, complete: false });
});

test('limpia una fecha límite inválida sin eliminar la meta', () => {
  assert.equal(normalizeGoals({ viaje: goal({ deadline: '2026-04-31' }) }).viaje.deadline, '');
});

test('rechaza objetivos nulos y ahorros negativos o fraccionarios', () => {
  for (const invalid of [goal({ target: 0 }), goal({ saved: -1 }), goal({ saved: 0.2 })]) {
    assert.deepEqual(normalizeGoals({ viaje: invalid }), {});
  }
});

test('el progreso porcentual entero y el dinero pendiente coinciden', () => {
  assert.deepEqual(goalProgress(goal()), { remaining: 42000, percent: 58, barPercent: 58, complete: false });
});

test('el porcentaje no muestra 100 hasta completar el objetivo', () => {
  assert.deepEqual(goalProgress(goal({ saved: 99999 })), { remaining: 1, percent: 99, barPercent: 99, complete: false });
  assert.deepEqual(goalProgress(goal({ saved: 100000 })), { remaining: 0, percent: 100, barPercent: 100, complete: true });
});

test('una meta inválida no muestra un objetivo completado', () => {
  assert.deepEqual(goalProgress({ target: 0, saved: 5000 }), { remaining: 0, percent: 0, barPercent: 0, complete: false });
});
