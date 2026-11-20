/* Sugerencias de categoría según el comercio o el concepto del movimiento. */
(function (root) {
  const BUILTIN = [
    ['expense', 'Supermercado', 'Alimentación'],
    ['expense', 'Supermercados', 'Alimentación'],
    ['expense', 'Panadería', 'Alimentación'],
    ['expense', 'Droguería', 'Salud'],
    ['expense', 'Gasolina', 'Transporte'],
    ['expense', 'Peaje', 'Transporte'],
    ['expense', 'Parqueadero', 'Transporte'],
    ['expense', 'Factura de internet', 'Servicios'],
    ['expense', 'Factura de energía', 'Servicios'],
    ['expense', 'Matrícula escolar', 'Educación'],
    ['income', 'Nómina', 'Salario'],
    ['income', 'Salario', 'Salario'],
  ].map(([type, pattern, category]) => ({ type, pattern, category, term: comparable(pattern) }))
    .sort((a, b) => b.term.length - a.term.length);

  function comparable(text) {
    return typeof text === 'string'
      ? text.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('es-CO').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
      : '';
  }

  function validId(id) {
    return /^[a-z0-9][a-z0-9-]{0,79}$/i.test(id) && id !== 'prototype' && !Object.hasOwn(Object.prototype, id);
  }

  function validCategory(type, category, categories) {
    return (type === 'income' || type === 'expense') && typeof category === 'string' &&
      Array.isArray(categories?.[type]) && categories[type].includes(category);
  }

  function normalizeRules(input, categories) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
    const output = {};
    for (const [id, raw] of Object.entries(input)) {
      if (!validId(id) || !raw || typeof raw !== 'object' || raw.id !== id) continue;
      const pattern = typeof raw.pattern === 'string' ? raw.pattern.trim().slice(0, 64) : '';
      const { match, type, category } = raw;
      if (!comparable(pattern) || (match !== 'contains' && match !== 'exact') || !validCategory(type, category, categories)) continue;
      const active = raw.active === undefined || raw.active === true;
      output[id] = { id, pattern, match, type, category, active };
    }
    return output;
  }

  function precedes(candidate, current) {
    if (!current) return true;
    if (candidate.match !== current.match) return candidate.match === 'exact';
    if (candidate.term.length !== current.term.length) return candidate.term.length > current.term.length;
    return candidate.id < current.id;
  }

  function suggestCategory(movement, rules, categories) {
    const { merchant, title, type } = movement || {};
    const term = comparable(typeof merchant === 'string' && merchant.trim() ? merchant : title);
    if (!term) return null;

    let winner = null;
    for (const rule of Object.values(normalizeRules(rules, categories))) {
      if (!rule.active || rule.type !== type) continue;
      const pattern = comparable(rule.pattern);
      const matched = rule.match === 'exact' ? term === pattern : term.includes(pattern);
      if (!matched) continue;
      const candidate = { ...rule, term: pattern };
      if (precedes(candidate, winner)) winner = candidate;
    }
    if (winner) return { category: winner.category, source: 'custom', pattern: winner.pattern, ruleId: winner.id };

    const wholeTerm = ` ${term} `;
    const matching = BUILTIN.filter(rule => rule.type === type && validCategory(type, rule.category, categories) && wholeTerm.includes(` ${rule.term} `));
    const first = matching[0];
    if (!first || matching.some(rule => rule.category !== first.category)) return null;
    return { category: first.category, source: 'builtin', pattern: first.pattern };
  }

  const api = Object.freeze({ normalizeRules, suggestCategory });
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SaldoRules = api;
})(globalThis);
