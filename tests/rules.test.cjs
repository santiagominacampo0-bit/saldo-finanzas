const assert = require('node:assert/strict');
const test = require('node:test');
const { normalizeRules, suggestCategory } = require('../saldo-rules.js');

const categories = {
  income: ['Salario', 'Ventas', 'Freelance', 'Inversiones', 'Otros ingresos'],
  expense: ['Alimentación', 'Transporte', 'Hogar', 'Salud', 'Educación', 'Ocio', 'Servicios', 'Deudas', 'Otros gastos'],
};

function entry(id, overrides = {}) {
  return { id, pattern: 'Farmacia', match: 'contains', type: 'expense', category: 'Salud', active: true, ...overrides };
}

function rules(...list) {
  return Object.fromEntries(list.map(item => [item.id, item]));
}

function suggestion(merchant, list = [], overrides = {}, allowed = categories) {
  return suggestCategory({ merchant, type: 'expense', ...overrides }, rules(...list), allowed);
}

test('la regla personalizada Farmacia asigna Salud', () => {
  assert.deepEqual(suggestion('Farmacia La 14', [entry('farma')]), {
    category: 'Salud', source: 'custom', pattern: 'Farmacia', ruleId: 'farma',
  });
});

test('regla exacta precede a coincidencias parciales aunque se guarde después', () => {
  const partial = entry('a', { category: 'Otros gastos' });
  const exact = entry('z', { pattern: 'Farmacia Central', match: 'exact' });
  assert.equal(suggestion('Farmacia Central', [partial, exact]).ruleId, 'z');
});

test('regla exacta no coincide con texto adicional', () => {
  assert.equal(suggestion('Farmacia Central', [entry('exacta', { match: 'exact' })]), null);
});

test('coincide exactamente aunque cambien tildes, puntuación y mayúsculas', () => {
  const item = entry('exacta', { pattern: 'Droguería, La 14', match: 'exact' });
  assert.equal(suggestion(' DRoGUERIA / la 14 ', [item]).ruleId, 'exacta');
});

test('entre coincidencias parciales prefiere el patrón más largo', () => {
  const short = entry('a');
  const long = entry('z', { pattern: 'Farmacia Animal', category: 'Otros gastos' });
  assert.equal(suggestion('Farmacia Animal 24H', [short, long]).ruleId, 'z');
});

test('el desempate por identificador es estable aunque cambie el orden de los datos', () => {
  const first = entry('a', { pattern: 'Farma', category: 'Otros gastos' });
  const last = entry('z', { pattern: 'Central' });
  const tied = entry('b', { pattern: 'Centr' });
  assert.equal(suggestion('Farmacia Central', [tied, first]).ruleId, 'a');
  assert.equal(suggestion('Farmacia Central', [first, tied]).ruleId, 'a');
  assert.equal(suggestion('Farmacia Central', [first, last, tied]).ruleId, 'z');
});

test('una regla desactivada no bloquea una sugerencia incorporada', () => {
  const inactive = entry('apagada', { pattern: 'Supermercado', category: 'Hogar', active: false });
  assert.equal(suggestion('Supermercado Nacional', [inactive]).category, 'Alimentación');
});

test('una regla personalizada activa prevalece sobre la categoría incorporada', () => {
  const custom = entry('hogar', { pattern: 'Supermercado', category: 'Hogar' });
  assert.deepEqual(suggestion('Supermercado Nacional', [custom]), {
    category: 'Hogar', source: 'custom', pattern: 'Supermercado', ruleId: 'hogar',
  });
});

test('si se escribe comercio no se usa el concepto para sugerir', () => {
  const custom = entry('farmacia');
  assert.equal(suggestion('Comercio Navarro', [custom], { title: 'Farmacia y supermercado' }), null);
  assert.equal(suggestion('Farmacia La 14', [custom], { title: 'Parqueadero' }).category, 'Salud');
});

test('si el comercio está vacío se usa el concepto', () => {
  assert.equal(suggestion('  ', [], { title: 'Mercado en supermercado' }).category, 'Alimentación');
  assert.equal(suggestion(undefined, [entry('farmacia')], { title: 'Pago en FARMACIA' }).ruleId, 'farmacia');
});

test('un comercio informado con signos no cae silenciosamente al concepto', () => {
  assert.equal(suggestion('?!', [entry('farmacia')], { title: 'Farmacia' }), null);
});

test('las reglas se aplican solo al tipo al que pertenecen', () => {
  assert.equal(suggestion('Farmacia', [entry('farmacia')], { type: 'income' }), null);
  assert.equal(suggestion('Nómina', [], { type: 'expense' }), null);
  assert.equal(suggestion('Nómina', [], { type: 'income' }).category, 'Salario');
});

test('permite reglas personalizadas de ingreso con categorías de ingreso', () => {
  const item = entry('facturas', { pattern: 'Comisión', type: 'income', category: 'Freelance' });
  assert.equal(suggestion('Comisión cliente', [item], { type: 'income' }).category, 'Freelance');
});

test('los patrones incorporados requieren términos completos', () => {
  assert.equal(suggestion('Hipersupermercado'), null);
  assert.equal(suggestion('Supermercadológico'), null);
});

test('reconoce términos después de guiones y antes de números separados por signos', () => {
  assert.equal(suggestion('Almacén-supermercado #12').category, 'Alimentación');
});

test('acepta el plural Supermercados como una etiqueta explícita', () => {
  assert.equal(suggestion('Supermercados Las Palmas').category, 'Alimentación');
});

test('los valores predeterminados no se aplican a textos vagos', () => {
  for (const description of ['Compra', 'Banco', 'Pago', 'Mercado', 'Recibo']) assert.equal(suggestion(description), null);
});

test('si los patrones incorporados apuntan a categorías distintas no se adivina', () => {
  assert.equal(suggestion('Parqueadero supermercado'), null);
});

test('si coinciden dos patrones incorporados de la misma categoría se usa el más específico', () => {
  assert.deepEqual(suggestion('Pago peaje y parqueadero'), { category: 'Transporte', source: 'builtin', pattern: 'Parqueadero' });
});

for (const [merchant, category] of [['Panaderia Ana', 'Alimentación'], ['Droguería El Sol', 'Salud'], ['Peaje Andes', 'Transporte'], ['Factura de energia', 'Servicios'], ['Matrícula escolar febrero', 'Educación']]) {
  test(`categoría incorporada de ${merchant}`, () => assert.equal(suggestion(merchant).category, category));
}

test('no sugiere una categoría incorporada cuando el catálogo ya no la contiene', () => {
  assert.equal(suggestion('Supermercado', [], {}, { expense: ['Otros gastos'] }), null);
});

test('normaliza las propiedades esperadas y descarta campos adicionales', () => {
  const original = entry('farmacia', { pattern: '  Farmacia  ', active: undefined, otraCosa: 1 });
  assert.deepEqual(normalizeRules(rules(original), categories), rules(entry('farmacia')));
});

test('el patrón se limita a 64 caracteres y no puede ser solo espacios o signos', () => {
  const clean = normalizeRules(rules(entry('largo', { pattern: '  x'.padEnd(100, 'x') }), entry('vacia', { pattern: '  !  ' })), categories);
  assert.equal(clean.largo.pattern.length, 64);
  assert.equal(Object.hasOwn(clean, 'vacia'), false);
});

test('la categoría debe pertenecer al tipo y el operador tiene que ser válido', () => {
  const invalid = rules(entry('a', { type: 'income', category: 'Salud' }), entry('b', { match: 'starts' }), entry('c', { category: 'Inventada' }));
  assert.deepEqual(normalizeRules(invalid, categories), {});
  assert.equal(suggestion('Farmacia', Object.values(invalid)), null);
});

test('ignora objetos vacíos, arreglos y claves mal formadas o heredadas', () => {
  const unsafe = JSON.parse('{"__proto__":{"id":"__proto__","pattern":"Farmacia","match":"contains","type":"expense","category":"Salud"},"constructor":{"id":"constructor","pattern":"Farmacia","match":"contains","type":"expense","category":"Salud"}}');
  for (const data of [null, [], false, 'reglas', unsafe, { fuera: entry('dentro') }, { 'mal/id': entry('mal/id') }]) {
    assert.deepEqual(normalizeRules(data, categories), {});
  }
});

test('un valor no booleano para activo no enciende una regla', () => {
  const item = entry('mal-activo', { active: 'true' });
  assert.equal(normalizeRules(rules(item), categories)['mal-activo'].active, false);
  assert.equal(suggestion('Farmacia', [item]), null);
});

test('una entrada sin texto o sin tipo compatible no provoca una sugerencia', () => {
  assert.equal(suggestCategory(null, {}, categories), null);
  assert.equal(suggestion('', [entry('farmacia')]), null);
  assert.equal(suggestion('Supermercado', [], { type: 'transfer' }), null);
});
