/* Shared state rules for the browser and the regression tests. */
(function (root) {
  const categories = {
    income: ['Salario', 'Ventas', 'Freelance', 'Inversiones', 'Otros ingresos'],
    expense: ['Alimentación', 'Transporte', 'Hogar', 'Salud', 'Educación', 'Ocio', 'Servicios', 'Deudas', 'Otros gastos'],
  };
  const commonJS = typeof module === 'object' && module.exports;
  const planning = commonJS ? require('./saldo-planning.js') : root.SaldoPlanning;
  const recurrence = commonJS ? require('./saldo-recurrence.js') : root.SaldoRecurrence;
  const record = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const plainText = (value, limit) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
  const validMonth = value => /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
  const positiveAmount = value => Number.isSafeInteger(value) && value > 0 && value <= 999999999999;
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  function validDate(date) {
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
    const parsed = new Date(date + 'T00:00:00Z');
    return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === date;
  }

  function normalize(input) {
    const data = record(input);
    const wallets = planning.normalizeWallets(data.wallets);
    const transactions = new Map();
    for (const raw of Array.isArray(data.transactions) ? data.transactions : []) {
      const tx = record(raw);
      const id = plainText(tx.id, 80);
      const title = plainText(tx.title, 80);
      const type = tx.type === 'expense' || tx.type === 'income' ? tx.type : '';
      if (!id || !title || !type || !positiveAmount(tx.amount) || !validDate(tx.date)) continue;
      const allowed = categories[type];
      transactions.set(id, {
        id, type, title, date: tx.date, amount: tx.amount,
        category: allowed.includes(tx.category) ? tx.category : allowed.at(-1),
        note: plainText(tx.note, 120),
        ...(Object.hasOwn(wallets, tx.walletId) ? { walletId: tx.walletId } : {}),
      });
    }
    const budgets = {};
    for (const [month, raw] of Object.entries(record(data.budgets))) {
      if (!validMonth(month)) continue;
      const entries = Object.entries(record(raw)).filter(([category, amount]) =>
        categories.expense.includes(category) && positiveAmount(amount));
      if (entries.length) budgets[month] = Object.fromEntries(entries);
    }
    const alertedBudgets = {};
    for (const [key, stage] of Object.entries(record(data.alertedBudgets))) {
      if (validMonth(key.slice(0, 7)) && key[7] === ':' && categories.expense.includes(key.slice(8)) && [80, 100].includes(stage)) {
        alertedBudgets[key] = stage;
      }
    }
    const recurring = recurrence.normalizeRecurring(data.recurring, categories);
    for (const item of Object.values(recurring)) {
      if (item.walletId && !Object.hasOwn(wallets, item.walletId)) delete item.walletId;
    }
    const settings = record(data.settings);
    const day = String(settings.reminderDay ?? '');
    return {
      profile: { name: plainText(record(data.profile).name, 48) },
      transactions: [...transactions.values()].sort((a, b) => a.id.localeCompare(b.id)),
      budgets,
      wallets,
      transfers: planning.normalizeTransfers(data.transfers, wallets),
      recurring,
      goals: planning.normalizeGoals(data.goals),
      settings: {
        notificationsEnabled: settings.notificationsEnabled === true,
        remindersEnabled: settings.remindersEnabled === true,
        reminderDay: /^(?:[1-9]|1[0-9]|2[0-8])$/.test(day) ? day : '1',
        reminderTime: typeof settings.reminderTime === 'string' && /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/.test(settings.reminderTime) ? settings.reminderTime : '19:00',
        timeZone: 'America/Bogota',
      },
      alertedBudgets,
      lastReminder: typeof data.lastReminder === 'string' && /^\d{4}-\d{1,2}$/.test(data.lastReminder) ? data.lastReminder : '',
    };
  }

  function mergeMap(base, local, remote) {
    const result = new Map(remote);
    for (const id of new Set([...base.keys(), ...local.keys()])) {
      if (equal(base.get(id), local.get(id))) continue;
      if (local.has(id)) result.set(id, local.get(id));
      else result.delete(id);
    }
    return result;
  }

  const map = value => new Map(Object.entries(value));
  const mergeCollection = (base, local, remote) => Object.fromEntries(mergeMap(map(base || {}), map(local || {}), map(remote || {})));
  const txMap = entries => new Map(entries.map(tx => [tx.id, tx]));

  // Apply the changes made on this device over the latest cloud snapshot.
  function merge(base, local, remote) {
    const budgets = {};
    const months = new Set([...Object.keys(base.budgets), ...Object.keys(local.budgets), ...Object.keys(remote.budgets)]);
    for (const month of months) {
      const values = mergeMap(map(base.budgets[month] || {}), map(local.budgets[month] || {}), map(remote.budgets[month] || {}));
      if (values.size) budgets[month] = Object.fromEntries(values);
    }
    return normalize({
      profile: Object.fromEntries(mergeMap(map(base.profile), map(local.profile), map(remote.profile))),
      transactions: [...mergeMap(txMap(base.transactions), txMap(local.transactions), txMap(remote.transactions)).values()],
      budgets,
      wallets: mergeCollection(base.wallets, local.wallets, remote.wallets),
      transfers: mergeCollection(base.transfers, local.transfers, remote.transfers),
      recurring: mergeCollection(base.recurring, local.recurring, remote.recurring),
      goals: mergeCollection(base.goals, local.goals, remote.goals),
      settings: Object.fromEntries(mergeMap(map(base.settings), map(local.settings), map(remote.settings))),
      alertedBudgets: Object.fromEntries(mergeMap(map(base.alertedBudgets), map(local.alertedBudgets), map(remote.alertedBudgets))),
      lastReminder: local.lastReminder === base.lastReminder ? remote.lastReminder : local.lastReminder,
    });
  }

  const api = Object.freeze({ categories, normalize, merge, equal, validDate, positiveAmount });
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SaldoState = api;
})(globalThis);
