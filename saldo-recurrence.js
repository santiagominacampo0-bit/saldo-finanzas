/* Reglas de movimientos recurrentes compartidas por la app y las pruebas. */
(function (root) {
  const frequencies = new Set(['weekly', 'biweekly', 'monthly']);
  const fallbackCategories = { income: 'Otros ingresos', expense: 'Otros gastos' };
  const maxAmount = 999999999999;

  function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function validId(id, maxLength) {
    return typeof id === 'string' && id.length <= maxLength && /^[a-z0-9][a-z0-9-]*$/i.test(id) &&
      id !== 'prototype' && !Object.hasOwn(Object.prototype, id);
  }

  function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
    const date = new Date(value + 'T00:00:00Z');
    return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
  }

  function normalizeItem(value, categories) {
    if (!isRecord(value)) return null;
    const { id, amount, type, nextDue, frequency, walletId } = value;
    const title = typeof value.title === 'string' ? value.title.trim().slice(0, 80) : '';
    // Reserve space for the date and prefix in the transaction ID.
    if (!validId(id, 65) || !title || !validDate(nextDue) || !frequencies.has(frequency)) return null;
    if ((type !== 'income' && type !== 'expense') || !Number.isSafeInteger(amount) || amount < 1 || amount > maxAmount) return null;

    const dayOfMonth = value.dayOfMonth === undefined ? Number(nextDue.slice(-2)) : value.dayOfMonth;
    const leadDays = value.leadDays === undefined ? 1 : value.leadDays;
    if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) return null;
    if (!Number.isInteger(leadDays) || leadDays < 0 || leadDays > 7) return null;

    const allowed = categories?.[type];
    const requested = typeof value.category === 'string' ? value.category.trim().slice(0, 48) : '';
    const category = Array.isArray(allowed)
      ? (allowed.includes(requested) ? requested : allowed.at(-1) || fallbackCategories[type])
      : requested || fallbackCategories[type];

    return {
      id, title, amount, type, category, nextDue, frequency, dayOfMonth, leadDays,
      active: value.active === true,
      ...(validId(walletId, 80) && walletId !== 'general' ? { walletId } : {}),
    };
  }

  function normalizeRecurring(input, categories) {
    const result = {};
    if (!isRecord(input)) return result;
    for (const [id, value] of Object.entries(input)) {
      if (!isRecord(value) || value.id !== id) continue;
      const item = normalizeItem(value, categories);
      if (item) result[id] = item;
    }
    return result;
  }

  function advanceRecurring(value) {
    const item = normalizeItem(value);
    if (!item) return null;
    const date = new Date(item.nextDue + 'T00:00:00Z');

    if (item.frequency === 'monthly') {
      date.setUTCMonth(date.getUTCMonth() + 1, 1);
      const lastDayOfMonth = new Date(date);
      lastDayOfMonth.setUTCMonth(date.getUTCMonth() + 1, 0);
      date.setUTCDate(Math.min(item.dayOfMonth, lastDayOfMonth.getUTCDate()));
    } else {
      date.setUTCDate(date.getUTCDate() + (item.frequency === 'weekly' ? 7 : 14));
    }

    const nextDue = date.toISOString().slice(0, 10);
    return validDate(nextDue) ? { ...item, nextDue } : null;
  }

  function upcomingRecurring(items, date) {
    if (date !== undefined && !validDate(date)) return [];
    return Object.values(normalizeRecurring(items)).filter(item => item.active)
      .sort((left, right) => left.nextDue.localeCompare(right.nextDue) || left.id.localeCompare(right.id));
  }

  function confirmRecurring(value) {
    const next = advanceRecurring(value);
    if (!next?.active) return null;
    const occurrenceDate = value.nextDue;
    const { id, type, title, amount, category, walletId } = next;
    const transaction = {
      id: `rec-${id}-${occurrenceDate}`, type, title, amount, category, date: occurrenceDate, note: '',
      ...(walletId ? { walletId } : {}),
    };
    return { transaction, next, occurrenceDate };
  }

  const api = Object.freeze({ normalizeRecurring, advanceRecurring, upcomingRecurring, confirmRecurring });
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SaldoRecurrence = api;
})(globalThis);
