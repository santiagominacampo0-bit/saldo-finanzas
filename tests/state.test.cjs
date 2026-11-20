const test = require('node:test');
const assert = require('node:assert/strict');
const { normalize, merge, validDate, positiveAmount } = require('../saldo-state.js');

const validDates = ['2024-02-29', '2000-02-29', '2026-01-01', '2026-12-31', '2026-04-30', '2026-10-25'];
const invalidDates = ['2026-02-29', '1900-02-29', '2026-02-31', '2026-00-01', '2026-01-00', '2026-13-12', '2026-04-31', '2026-11-00', '2026-11-31', '2026-01-32', '26-11-11', '2026-1-1', '2026-01-01T00:00:00Z', '2026-01-01 ', null, {}];
for (const date of validDates) test('fecha válida ' + date, () => assert.equal(validDate(date), true));
for (const date of invalidDates) test('fecha inválida ' + JSON.stringify(date), () => assert.equal(validDate(date), false));
for (const amount of [1, 500, 100000, 999999999999]) test('valor COP válido ' + amount, () => assert.equal(positiveAmount(amount), true));
for (const amount of [0, -1, 0.2, 1000000000000, Infinity, '50', NaN, null]) test('valor COP inválido ' + String(amount), () => assert.equal(positiveAmount(amount), false));

const transaction = (id, amount = 500) => ({ id, title: 'Mercado', type: 'expense', date: '2026-11-20', category: 'Alimentación', note: '', amount });
const state = ({ tx = [], budget = {}, reminder, name = '', enabled = false } = {}) => normalize({
  profile: { name }, transactions: tx, budgets: { '2026-11': budget }, settings: { reminderTime: reminder, notificationsEnabled: enabled },
});

test('estado vacío mantiene defaults', () => assert.equal(state().settings.timeZone, 'America/Bogota'));
test('forma incorrecta se descarta', () => assert.deepEqual(normalize(42), normalize(null)));
test('mueve categoría desconocida a otros gastos', () => assert.equal(state({ tx: [{ ...transaction('a'), category: '___' }] }).transactions[0].category, 'Otros gastos'));
test('mueve categoría desconocida a otros ingresos', () => assert.equal(state({ tx: [{ ...transaction('a'), category: '___', type: 'income' }] }).transactions[0].category, 'Otros ingresos'));
test('recorta el nombre a 48 caracteres', () => assert.equal(state({ name: 'x'.repeat(100) }).profile.name.length, 48));
test('el nombre requiere texto', () => assert.equal(state({ name: { unexpected: 1 } }).profile.name, ''));
test('normaliza hora fuera de rango', () => assert.equal(state({ reminder: '25:72' }).settings.reminderTime, '19:00'));
test('normaliza una hora válida', () => assert.equal(state({ reminder: '06:45' }).settings.reminderTime, '06:45'));
test('limita recordatorio al día 28', () => assert.equal(normalize({ settings: { reminderDay: '29' } }).settings.reminderDay, '1'));
test('acepta el día 28', () => assert.equal(normalize({ settings: { reminderDay: 28 } }).settings.reminderDay, '28'));
test('ignora texto en un interruptor', () => assert.equal(normalize({ settings: { notificationsEnabled: 'true' } }).settings.notificationsEnabled, false));
test('conserva solo presupuestos válidos', () => assert.deepEqual(state({ budget: { Hogar: 300, Salud: 0, Otro: 5 } }).budgets, { '2026-11': { Hogar: 300 } }));
test('ignora meses de presupuesto inválidos', () => assert.deepEqual(normalize({ budgets: { '2026-13': { Hogar: 5 } } }).budgets, {}));
test('ignora claves de objeto inesperadas', () => assert.deepEqual(normalize(JSON.parse('{"budgets":{"__proto__":{"polluted":true}}}')).budgets, {}));
test('descarta movimientos sin concepto', () => assert.equal(state({ tx: [{ ...transaction('a'), title: ' ' }] }).transactions.length, 0));
test('descarta movimientos de forma inesperada', () => assert.equal(state({ tx: [null, 'bad', []] }).transactions.length, 0));
test('conserva el último movimiento repetido', () => assert.deepEqual(state({ tx: [transaction('a'), transaction('a', 800)] }).transactions, [transaction('a', 800)]));
test('orden estable de movimientos entre dispositivos', () => assert.deepEqual(state({ tx: [transaction('b'), transaction('a')] }).transactions.map(item => item.id), ['a', 'b']));
test('dos teléfonos añaden movimientos sin perder datos', () => assert.equal(merge(state(), state({ tx: [transaction('a')] }), state({ tx: [transaction('b')] })).transactions.length, 2));
test('borrado local conserva otras altas de la nube', () => assert.deepEqual(merge(state({ tx: [transaction('a')] }), state(), state({ tx: [transaction('a'), transaction('b')] })).transactions, [transaction('b')]));
test('no revive un movimiento borrado en la nube', () => assert.deepEqual(merge(state({ tx: [transaction('a')] }), state({ tx: [transaction('a'), transaction('b')] }), state()).transactions, [transaction('b')]));
test('una edición local aplica sobre el último registro', () => assert.equal(merge(state({ tx: [transaction('a')] }), state({ tx: [transaction('a', 600)] }), state({ tx: [transaction('a', 800)] })).transactions[0].amount, 600));
test('una edición de otra cuenta queda fuera del estado local', () => assert.equal(state().transactions.length, 0));
test('cambios de distintas categorías se conservan', () => assert.deepEqual(merge(state(), state({ budget: { Hogar: 300 } }), state({ budget: { Salud: 500 } })).budgets['2026-11'], { Hogar: 300, Salud: 500 }));
test('quitar un límite elimina la categoría', () => assert.deepEqual(merge(state({ budget: { Hogar: 300 } }), state(), state({ budget: { Hogar: 300 } })).budgets, {}));
test('aplica nombre y recordatorio de dispositivos distintos', () => {
  const result = merge(state(), state({ name: 'Perfil' }), state({ reminder: '07:05' }));
  assert.equal(result.profile.name, 'Perfil');
  assert.equal(result.settings.reminderTime, '07:05');
});
test('apagar avisos se sincroniza aunque exista otro cambio', () => {
  const result = merge(state({ enabled: true }), state(), state({ enabled: true, name: 'Perfil' }));
  assert.equal(result.settings.notificationsEnabled, false);
  assert.equal(result.profile.name, 'Perfil');
});
