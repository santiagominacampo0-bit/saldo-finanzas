/* Calendario y estimación mensual para fechas de Colombia. */
(function (root) {
  const commonJS = typeof module === 'object' && module.exports;
  const recurrence = commonJS ? require('./saldo-recurrence.js') : root.SaldoRecurrence;
  const dayMs = 86_400_000;
  const maxAmount = 999_999_999_999;
  const firstDate = '0001-01-01';
  const lastDate = '9999-12-31';
  const occurrencePattern = /^rec-([a-z0-9][a-z0-9-]{0,64})-(\d{4}-\d{2}-\d{2})$/i;

  function utcDate(value) {
    return new Date(value + 'T00:00:00Z');
  }

  function isoDate(date) {
    if (!(date.getUTCFullYear() >= 1 && date.getUTCFullYear() <= 9999)) return null;
    return date.toISOString().slice(0, 10);
  }

  function validDate(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && isoDate(utcDate(value)) === value;
  }

  function addDays(value, days) {
    return isoDate(new Date(utcDate(value).valueOf() + days * dayMs));
  }

  function isAmount(value) {
    return Number.isSafeInteger(value) && value > 0 && value <= maxAmount;
  }

  function occurrenceId(ruleId, date) {
    return `rec-${ruleId}-${date}`;
  }

  function recordedOccurrences(transactions) {
    const recorded = new Map();
    for (const tx of Array.isArray(transactions) ? transactions : []) {
      if (!tx || typeof tx.id !== 'string' || (tx.type !== 'income' && tx.type !== 'expense') || !isAmount(tx.amount)) continue;
      const match = occurrencePattern.exec(tx.id);
      if (!match || !validDate(match[2]) || match[1] === 'prototype' || Object.hasOwn(Object.prototype, match[1])) continue;
      const [, ruleId, date] = match;
      const title = typeof tx.title === 'string' ? tx.title.trim().slice(0, 80) : '';
      if (!title) continue;
      const id = occurrenceId(ruleId, date);
      recorded.set(id, { id, ruleId, title, type: tx.type, amount: tx.amount, date, status: 'recorded', canConfirm: false });
    }
    return recorded;
  }

  function calendarEntries(recurring, transactions, today, days = 7) {
    const allDates = days === 'all';
    if (!validDate(today) || (!allDates && (!Number.isInteger(days) || days < 1 || days > 30))) return [];
    const before = allDates ? firstDate : addDays(today, 1 - days) || firstDate;
    const end = allDates ? lastDate : addDays(today, days - 1) || lastDate;
    const recorded = recordedOccurrences(transactions);
    const entries = [];

    for (const rule of Object.values(recurrence.normalizeRecurring(recurring))) {
      const { id: ruleId, title, type, amount, nextDue: date, active } = rule;
      const id = occurrenceId(ruleId, date);
      if (date > end || recorded.has(id) || (!active && date < before)) continue;
      entries.push({
        id, ruleId, title, type, amount, date,
        status: !active ? 'paused' : date < today ? 'overdue' : 'pending',
        canConfirm: active,
      });
    }

    for (const item of recorded.values()) {
      if (item.date >= before && item.date <= end) entries.push(item);
    }
    return entries.sort((left, right) => left.date.localeCompare(right.date) || left.id.localeCompare(right.id));
  }

  function monthForecast(state, today) {
    if (!validDate(today)) return { registered: 0, pending: 0, futureRecorded: 0, available: 0 };
    const end = utcDate(today);
    end.setUTCMonth(end.getUTCMonth() + 1, 0);
    const lastDay = isoDate(end);
    const transactions = Array.isArray(state?.transactions) ? state.transactions : [];
    let registered = 0;
    let futureRecorded = 0;
    for (const wallet of Object.values(state?.wallets || {})) {
      const opening = wallet?.openingBalance;
      if (Number.isSafeInteger(opening) && Math.abs(opening) <= maxAmount) registered += opening;
    }
    for (const tx of transactions) {
      if (!tx || !validDate(tx.date) || !isAmount(tx.amount)) continue;
      if (tx.date > today) {
        if (tx.type === 'expense' && tx.date <= lastDay) futureRecorded += tx.amount;
        continue;
      }
      if (tx.type === 'income') registered += tx.amount;
      if (tx.type === 'expense') registered -= tx.amount;
    }

    const recorded = recordedOccurrences(transactions);
    let pending = 0;
    for (const rule of Object.values(recurrence.normalizeRecurring(state?.recurring))) {
      if (rule.active && rule.type === 'expense' && rule.nextDue <= lastDay && !recorded.has(occurrenceId(rule.id, rule.nextDue))) {
        pending += rule.amount;
      }
    }

    return { registered, pending, futureRecorded, available: registered - pending - futureRecorded };
  }

  const api = Object.freeze({ calendarEntries, monthForecast });
  if (commonJS) module.exports = api;
  else root.SaldoCalendar = api;
})(globalThis);
