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

  function dayInterval(rule) {
    return rule.frequency === 'weekly' ? 7 : 14;
  }

  function occurrenceAt(rule, index) {
    if (!index) return rule.nextDue;
    if (rule.frequency !== 'monthly') return addDays(rule.nextDue, index * dayInterval(rule));

    const date = utcDate(rule.nextDue);
    date.setUTCMonth(date.getUTCMonth() + index - 1, 1);
    // Advance from the preceding month to reuse the rule's day-of-month behavior.
    const previousMonth = isoDate(date);
    return previousMonth ? recurrence.advanceRecurring({ ...rule, nextDue: previousMonth })?.nextDue || null : null;
  }

  function countThrough(rule, through) {
    if (!through || through < rule.nextDue) return 0;
    const end = utcDate(through);
    const start = utcDate(rule.nextDue);
    if (rule.frequency !== 'monthly') return Math.floor((end - start) / (dayMs * dayInterval(rule))) + 1;

    const month = (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + end.getUTCMonth() - start.getUTCMonth();
    return month + Number(occurrenceAt(rule, month) <= through);
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

  function unrecordedEntry(rule, date, today) {
    const { id: ruleId, title, type, amount } = rule;
    return {
      id: occurrenceId(ruleId, date), ruleId, title, type, amount, date,
      status: date < today ? 'overdue' : 'pending', canConfirm: date === rule.nextDue,
    };
  }

  function calendarEntries(recurring, transactions, today, days = 7) {
    if (!validDate(today) || !Number.isInteger(days) || days < 1 || days > 30) return [];
    const before = addDays(today, 1 - days) || firstDate;
    const end = addDays(today, days - 1) || lastDate;
    const previous = addDays(today, -1);
    const recorded = recordedOccurrences(transactions);
    const entries = [];

    for (const rule of Object.values(recurrence.normalizeRecurring(recurring))) {
      if (!rule.active || rule.nextDue > end) continue;

      let firstUnrecorded = rule;
      while (firstUnrecorded?.nextDue < today && recorded.has(occurrenceId(rule.id, firstUnrecorded.nextDue))) {
        firstUnrecorded = recurrence.advanceRecurring(firstUnrecorded);
      }
      if (firstUnrecorded?.nextDue < today) entries.push(unrecordedEntry(rule, firstUnrecorded.nextDue, today));

      // Jump past old occurrences instead of replaying the whole rule history.
      const firstUpcoming = occurrenceAt(rule, countThrough(rule, previous));
      let upcoming = firstUpcoming && { ...rule, nextDue: firstUpcoming };
      while (upcoming && upcoming.nextDue <= end) {
        const date = upcoming.nextDue;
        if (!recorded.has(occurrenceId(rule.id, date))) entries.push(unrecordedEntry(rule, date, today));
        upcoming = recurrence.advanceRecurring(upcoming);
      }
    }

    for (const item of recorded.values()) {
      if (item.date >= before && item.date <= end) entries.push(item);
    }
    return entries.sort((left, right) => left.date.localeCompare(right.date) || left.id.localeCompare(right.id));
  }

  function monthForecast(state, today) {
    if (!validDate(today)) return { registered: 0, pending: 0, available: 0 };
    const end = utcDate(today);
    end.setUTCMonth(end.getUTCMonth() + 1, 0);
    const lastDay = isoDate(end);
    const transactions = Array.isArray(state?.transactions) ? state.transactions : [];
    let registered = 0;
    for (const wallet of Object.values(state?.wallets || {})) {
      const opening = wallet?.openingBalance;
      if (Number.isSafeInteger(opening) && Math.abs(opening) <= maxAmount) registered += opening;
    }
    for (const tx of transactions) {
      if (!tx || !validDate(tx.date) || tx.date > today || !isAmount(tx.amount)) continue;
      if (tx.type === 'income') registered += tx.amount;
      if (tx.type === 'expense') registered -= tx.amount;
    }

    const rules = recurrence.normalizeRecurring(state?.recurring);
    let pending = 0;
    for (const rule of Object.values(rules)) {
      if (rule.active && rule.type === 'expense') pending += countThrough(rule, lastDay) * rule.amount;
    }
    for (const { ruleId, date } of recordedOccurrences(transactions).values()) {
      const rule = Object.hasOwn(rules, ruleId) ? rules[ruleId] : null;
      if (!rule?.active || rule.type !== 'expense' || date < rule.nextDue || date > lastDay) continue;
      const index = countThrough(rule, date) - 1;
      if (index >= 0 && occurrenceAt(rule, index) === date) pending -= rule.amount;
    }

    return { registered, pending, available: registered - pending };
  }

  const api = Object.freeze({ calendarEntries, monthForecast });
  if (commonJS) module.exports = api;
  else root.SaldoCalendar = api;
})(globalThis);
