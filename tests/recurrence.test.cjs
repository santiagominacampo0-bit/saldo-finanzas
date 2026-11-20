const assert = require('node:assert/strict');
const test = require('node:test');
const {
  normalizeRecurring, advanceRecurring, upcomingRecurring, confirmRecurring,
} = require('../saldo-recurrence.js');

const rule = (changes = {}) => ({
  id: 'arriendo', title: 'Arriendo', amount: 900000, type: 'expense', category: 'Hogar',
  nextDue: '2026-01-31', frequency: 'monthly', dayOfMonth: 31, leadDays: 2, active: true,
  ...changes,
});

test('normaliza reglas válidas y elimina propiedades ajenas', () => {
  const item = rule({ title: '  Arriendo  ', walletId: 'nequi', externalToken: 'no guardar' });
  assert.deepEqual(normalizeRecurring({ arriendo: item }), { arriendo: rule({ walletId: 'nequi' }) });
});

test('las entradas ausentes y las colecciones de tipo incorrecto se tratan como vacías', () => {
  for (const value of [undefined, null, false, 12, 'arriendo', [rule()]]) assert.deepEqual(normalizeRecurring(value), {});
});

test('rechaza identificadores con barras, espacios o una clave que no coincide', () => {
  assert.deepEqual(normalizeRecurring({
    'otro-id': rule(), 'malo/id': rule({ id: 'malo/id' }), 'con espacio': rule({ id: 'con espacio' }),
  }), {});
});

test('rechaza claves de prototipo incluso cuando llegaron como propiedades JSON', () => {
  const entries = Object.fromEntries(['__proto__', 'prototype', 'constructor', 'toString'].map(id => [id, rule({ id })]));
  assert.deepEqual(normalizeRecurring(entries), {});
});

test('el ID más largo admitido conserva una clave de transacción de 80 caracteres', () => {
  const length65 = 'x'.repeat(65);
  const length66 = 'x'.repeat(66);
  assert.equal(confirmRecurring(rule({ id: length65 })).transaction.id.length, 80);
  assert.deepEqual(normalizeRecurring({ [length66]: rule({ id: length66 }) }), {});
});

test('limpia el concepto y descarta registros sin título', () => {
  assert.equal(normalizeRecurring({ arriendo: rule({ title: 'x'.repeat(100) }) }).arriendo.title.length, 80);
  for (const title of ['  ', null, {}]) assert.deepEqual(normalizeRecurring({ arriendo: rule({ title }) }), {});
});

test('solo admite importes positivos enteros dentro del límite de Saldo', () => {
  for (const amount of [0, -1, 2.5, Infinity, '1000', 1000000000000]) {
    assert.deepEqual(normalizeRecurring({ arriendo: rule({ amount }) }), {});
  }
  assert.equal(normalizeRecurring({ arriendo: rule({ amount: 999999999999 }) }).arriendo.amount, 999999999999);
});

test('descarta tipo o frecuencia no reconocidos', () => {
  for (const changes of [{ type: 'transfer' }, { frequency: 'daily' }, { frequency: 'annual' }]) {
    assert.deepEqual(normalizeRecurring({ arriendo: rule(changes) }), {});
  }
});

test('elige una categoría del tipo de movimiento cuando recibe el catálogo de Saldo', () => {
  const catalog = { income: ['Salario', 'Otros ingresos'], expense: ['Hogar', 'Otros gastos'] };
  assert.equal(normalizeRecurring({ arriendo: rule({ type: 'income' }) }, catalog).arriendo.category, 'Otros ingresos');
  assert.equal(normalizeRecurring({ arriendo: rule() }, catalog).arriendo.category, 'Hogar');
});

test('las categorías faltantes tienen un valor predeterminado sin catálogo', () => {
  assert.equal(normalizeRecurring({ arriendo: rule({ category: ' ' }) }).arriendo.category, 'Otros gastos');
  assert.equal(normalizeRecurring({ arriendo: rule({ type: 'income', category: null }) }).arriendo.category, 'Otros ingresos');
});

test('las fechas deben ser reales, incluir ceros y tener año de cuatro cifras', () => {
  for (const nextDue of ['2026-02-29', '2028-02-30', '2028-13-01', '2028-2-01', '0000-01-01', '10000-01-01']) {
    assert.deepEqual(normalizeRecurring({ arriendo: rule({ nextDue }) }), {});
  }
  assert.equal(normalizeRecurring({ arriendo: rule({ nextDue: '2028-02-29' }) }).arriendo.nextDue, '2028-02-29');
});

test('recupera el día de anclaje y el aviso para reglas sin esos campos', () => {
  const { arriendo } = normalizeRecurring({ arriendo: rule({ dayOfMonth: undefined, leadDays: undefined }) });
  assert.equal(arriendo.dayOfMonth, 31);
  assert.equal(arriendo.leadDays, 1);
});

test('rechaza días fuera del rango y conserva los extremos válidos del aviso', () => {
  for (const changes of [{ dayOfMonth: 0 }, { dayOfMonth: 32 }, { dayOfMonth: '31' }, { leadDays: -1 }, { leadDays: 8 }, { leadDays: 1.5 }]) {
    assert.deepEqual(normalizeRecurring({ arriendo: rule(changes) }), {});
  }
  for (const leadDays of [0, 7]) assert.equal(normalizeRecurring({ arriendo: rule({ leadDays }) }).arriendo.leadDays, leadDays);
});

test('solo activa una regla con el booleano explícito true', () => {
  for (const active of [false, undefined, 'true', 1]) assert.equal(normalizeRecurring({ arriendo: rule({ active }) }).arriendo.active, false);
});

test('ignora un bolsillo inválido y trata General como el bolsillo predeterminado', () => {
  for (const walletId of ['general', 'constructor', 'x/y', null]) {
    assert.equal(Object.hasOwn(normalizeRecurring({ arriendo: rule({ walletId }) }).arriendo, 'walletId'), false);
  }
  assert.equal(normalizeRecurring({ arriendo: rule({ walletId: 'nequi' }) }).arriendo.walletId, 'nequi');
});

test('mantiene el vencimiento mensual del día 31 al pasar por febrero', () => {
  const february = advanceRecurring(rule());
  assert.equal(february.nextDue, '2026-02-28');
  assert.equal(february.dayOfMonth, 31);
  assert.equal(advanceRecurring(february).nextDue, '2026-03-31');
});

test('usa el día 29 de febrero en año bisiesto y vuelve al día 30 en marzo', () => {
  const february = advanceRecurring(rule({ nextDue: '2028-01-30', dayOfMonth: 30 }));
  assert.equal(february.nextDue, '2028-02-29');
  assert.equal(advanceRecurring(february).nextDue, '2028-03-30');
});

test('una regla mensual cruza años sin alterar su día de anclaje', () => {
  assert.equal(advanceRecurring(rule({ nextDue: '2026-12-31' })).nextDue, '2027-01-31');
});

test('la frecuencia semanal cruza diciembre con siete días exactos', () => {
  assert.equal(advanceRecurring(rule({ nextDue: '2026-12-28', frequency: 'weekly' })).nextDue, '2027-01-04');
});

test('la frecuencia bisemanal suma catorce días al pasar por el día bisiesto', () => {
  assert.equal(advanceRecurring(rule({ nextDue: '2028-02-24', frequency: 'biweekly' })).nextDue, '2028-03-09');
});

test('rechaza avanzar reglas inválidas o fechas que excederían el formato del calendario', () => {
  assert.equal(advanceRecurring(null), null);
  assert.equal(advanceRecurring(rule({ frequency: 'weekly', nextDue: '9999-12-31' })), null);
});

test('la lista muestra vencidos, de hoy y futuros en orden y excluye reglas pausadas', () => {
  const items = {
    futuro: rule({ id: 'futuro', nextDue: '2026-05-30' }),
    hoy: rule({ id: 'hoy', nextDue: '2026-03-01' }),
    arriendo: rule(),
    pausado: rule({ id: 'pausado', nextDue: '2025-11-01', active: false }),
    mal: rule({ id: 'mal', amount: 0 }),
  };
  assert.deepEqual(upcomingRecurring(items, '2026-03-01').map(item => item.id), ['arriendo', 'hoy', 'futuro']);
});

test('desempata vencimientos del mismo día por identificador', () => {
  const items = { zebra: rule({ id: 'zebra' }), alfa: rule({ id: 'alfa' }) };
  assert.deepEqual(upcomingRecurring(items, '2026-01-31').map(item => item.id), ['alfa', 'zebra']);
  assert.deepEqual(upcomingRecurring(items, '2026-02-30'), []);
});

test('confirmar devuelve una transacción con el importe, categoría, bolsillo y fecha del vencimiento', () => {
  const item = Object.freeze(rule({ walletId: 'nequi' }));
  const result = confirmRecurring(item);
  assert.deepEqual(result.transaction, {
    id: 'rec-arriendo-2026-01-31', type: 'expense', title: 'Arriendo', amount: 900000,
    category: 'Hogar', date: '2026-01-31', note: '', walletId: 'nequi',
  });
  assert.equal(result.occurrenceDate, '2026-01-31');
  assert.deepEqual(result.next, { ...item, nextDue: '2026-02-28' });
  assert.equal(item.nextDue, '2026-01-31');
});

test('la misma ocurrencia conserva su identificador y el próximo vencimiento obtiene otro', () => {
  const first = confirmRecurring(rule());
  const retry = confirmRecurring(rule({ title: 'Arriendo actualizado' }));
  const second = confirmRecurring(first.next);
  assert.equal(retry.transaction.id, first.transaction.id);
  assert.notEqual(second.transaction.id, first.transaction.id);
  assert.equal(second.transaction.date, '2026-02-28');
});

test('confirmar funciona para ingresos y no agrega un bolsillo cuando corresponde a General', () => {
  const { transaction } = confirmRecurring(rule({ type: 'income', category: 'Salario', walletId: 'general' }));
  assert.equal(transaction.type, 'income');
  assert.equal(transaction.category, 'Salario');
  assert.equal(Object.hasOwn(transaction, 'walletId'), false);
});

test('confirmar descarta entradas en pausa, inválidas o sin siguiente fecha válida', () => {
  for (const item of [null, rule({ active: false }), rule({ amount: 0 }), rule({ nextDue: '9999-12-31' })]) {
    assert.equal(confirmRecurring(item), null);
  }
});

test('listar y adelantar el calendario no generan transacciones automáticamente', () => {
  const item = Object.freeze(rule({ nextDue: '2099-01-31' }));
  assert.deepEqual(upcomingRecurring({ arriendo: item }, '2026-01-31'), [item]);
  assert.equal(Object.hasOwn(advanceRecurring(item), 'transaction'), false);
  assert.equal(confirmRecurring(item).transaction.date, '2099-01-31');
});
