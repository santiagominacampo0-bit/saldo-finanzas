/* Reglas de bolsillos, transferencias y metas compartidas por la app y las pruebas. */
(function (root) {
  const MAX_AMOUNT = 999999999999;
  const GENERAL_WALLET = Object.freeze({ id: 'general', name: 'General', openingBalance: 0 });

  function record(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  function plainText(value, maxLength) {
    return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
  }

  function validId(id) {
    return typeof id === 'string' && /^[a-z0-9][a-z0-9-]{0,79}$/i.test(id) &&
      id !== 'prototype' && !Object.hasOwn(Object.prototype, id);
  }

  function validAmount(value, minimum) {
    return Number.isSafeInteger(value) && value >= minimum && value <= MAX_AMOUNT;
  }

  function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(value + 'T00:00:00Z');
    return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
  }

  function normalizeCollection(input, normalizeEntry) {
    const output = {};
    for (const [id, value] of Object.entries(record(input))) {
      const entry = record(value);
      if (!validId(id) || entry.id !== id) continue;
      const normalized = normalizeEntry(entry);
      if (normalized) output[id] = normalized;
    }
    return output;
  }

  function normalizeWallets(input) {
    return normalizeCollection(input, ({ id, name, openingBalance = 0 }) => {
      const label = plainText(name, 48);
      if (id === GENERAL_WALLET.id || !label || !validAmount(openingBalance, -MAX_AMOUNT)) return null;
      return { id, name: label, openingBalance: openingBalance || 0 };
    });
  }

  function normalizeTransfers(input, wallets) {
    const knownWallets = wallets === undefined ? null : record(wallets);
    function validWallet(id) {
      return id === GENERAL_WALLET.id || (validId(id) && (!knownWallets || Object.hasOwn(knownWallets, id)));
    }
    return normalizeCollection(input, ({ id, fromId, toId, amount, date, note }) => {
      if (fromId === toId || !validWallet(fromId) || !validWallet(toId) || !validAmount(amount, 1) || !validDate(date)) return null;
      return { id, fromId, toId, amount, date, note: plainText(note, 120) };
    });
  }

  function normalizeGoals(input) {
    return normalizeCollection(input, ({ id, name, target, saved = 0, deadline }) => {
      const label = plainText(name, 48);
      if (!label || !validAmount(target, 1) || !validAmount(saved, 0)) return null;
      return { id, name: label, target, saved: saved || 0, deadline: validDate(deadline) ? deadline : '' };
    });
  }

  function walletBalance(wallet, transactions, transfers) {
    if (!wallet || !validId(wallet.id)) return 0;
    let balance = validAmount(wallet.openingBalance, -MAX_AMOUNT) ? wallet.openingBalance : 0;
    for (const transaction of Array.isArray(transactions) ? transactions : []) {
      if (!transaction || (transaction.walletId || GENERAL_WALLET.id) !== wallet.id || !validAmount(transaction.amount, 1)) continue;
      if (transaction.type === 'income') balance += transaction.amount;
      if (transaction.type === 'expense') balance -= transaction.amount;
    }

    const movements = Array.isArray(transfers) ? transfers : Object.values(record(transfers));
    for (const transfer of movements) {
      if (!transfer || !validAmount(transfer.amount, 1) || !validId(transfer.fromId) || !validId(transfer.toId) || transfer.fromId === transfer.toId) continue;
      if (transfer.fromId === wallet.id) balance -= transfer.amount;
      if (transfer.toId === wallet.id) balance += transfer.amount;
    }
    return balance;
  }

  function goalProgress(goal) {
    if (!goal || !validAmount(goal.target, 1)) return { remaining: 0, percent: 0, barPercent: 0, complete: false };
    const saved = validAmount(goal.saved, 0) ? goal.saved : 0;
    const percent = Math.floor(saved * 100 / goal.target);
    return {
      remaining: Math.max(0, goal.target - saved),
      percent,
      barPercent: Math.min(100, percent),
      complete: saved >= goal.target,
    };
  }

  const api = Object.freeze({ GENERAL_WALLET, normalizeWallets, normalizeTransfers, normalizeGoals, walletBalance, goalProgress });
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SaldoPlanning = api;
})(globalThis);
