// Runs against synthetic guest wallets at mobile and desktop widths.
const assert = require('node:assert/strict');
const { chromium } = require(process.env.SALDO_PLAYWRIGHT_MODULE || 'playwright');
const address = process.env.SALDO_QA_URL || 'http://localhost:4173/';
const viewports = [{ width: 280, height: 653 }, { width: 390, height: 844 }, { width: 1440, height: 900 }];
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Bogota' });
const day = offset => new Date(Date.parse(today + 'T12:00:00Z') + offset * 86400000).toISOString().slice(0, 10);
const fixture = {
  wallets: {
    nequi: { id: 'nequi', name: 'NéQUI', openingBalance: 20000 },
    efectivo: { id: 'efectivo', name: 'Efectivo', openingBalance: 100000 },
    ahorros: { id: 'ahorros', name: 'Ahorros', openingBalance: -10000 },
  },
  transactions: [
    { id: 'a', title: 'En efectivo', type: 'expense', category: 'Alimentación', amount: 10000, walletId: 'efectivo', date: day(-1) },
    { id: 'b', title: 'Ingreso de hoy', type: 'income', category: 'Salario', amount: 50000, walletId: 'nequi', date: today },
    { id: 'c', title: 'Mercado local', type: 'expense', category: 'Alimentación', merchant: 'Supermercado', amount: 3000, walletId: 'nequi', date: day(-2) },
    { id: 'd', title: 'Ingreso futuro', type: 'income', category: 'Salario', amount: 7000, walletId: 'nequi', date: day(1) },
    { id: 'e', title: 'Ingreso sin asignar', type: 'income', category: 'Salario', amount: 3000, date: today },
  ],
  transfers: {
    actual: { id: 'actual', fromId: 'efectivo', toId: 'nequi', amount: 15000, date: today, note: 'Traspaso de prueba' },
    futuro: { id: 'futuro', fromId: 'nequi', toId: 'efectivo', amount: 4000, date: day(2) },
  },
};

async function startPage(context, ledger) {
  await context.route('https://odveqruhywtrdajuxcts.supabase.co/**', route => route.abort());
  if (ledger) await context.addInitScript(value => localStorage.setItem('saldo-personal-v1', JSON.stringify(value)), ledger);
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  await page.goto(address);
  await page.locator('[data-action="guest"]').click();
  await page.locator('.nav-button:visible[data-tab="budgets"]').click();
  await page.getByRole('button', { name: 'Bolsillos', exact: true }).click();
  return page;
}

async function examine(browser, viewport) {
  const options = { viewport, isMobile: viewport.width < 650, reducedMotion: 'reduce' };
  const existing = await browser.newContext(options);
  const empty = await browser.newContext(options);
  let checked = 0;
  function verify(condition, message) {
    assert.ok(condition, message);
    checked += 1;
  }
  try {
    const page = await startPage(existing, fixture);
    const total = page.locator('.wallet-total strong');
    const amount = id => page.locator('.wallet-grid article').filter({ has: page.locator('[data-wallet-history="' + id + '"]') }).locator('.plan-amount');
    const history = id => page.locator('[data-wallet-history="' + id + '"]');
    const open = id => history(id).locator('summary').click();
    const entries = id => history(id).locator('li');
    const text = element => element.innerText();
    const hasText = (element, expected) => text(element).then(value => value.includes(expected));
    verify(await hasText(total, '157.000'), 'el total suma saldos iniciales y movimientos sin duplicar transferencias');
    verify(await hasText(amount('efectivo'), '79.000'), 'efectivo refleja transferencias de salida y entrada');
    verify(await hasText(amount('nequi'), '85.000'), 'Nequi refleja registros de cualquier fecha en el saldo total');
    verify(await hasText(amount('ahorros'), '10.000'), 'el bolsillo vacío conserva su saldo inicial');
    verify(await entries('nequi').filter({ visible: true }).count() === 0, 'historial contraído al abrir');
    await open('nequi');
    verify(await entries('nequi').count() === 5, 'Nequi muestra tres movimientos y dos transferencias');
    verify((await text(entries('nequi').first())).includes('Transferencia a Efectivo'), 'las fechas recientes se ordenan primero');
    verify(await entries('nequi').first().locator('time').getAttribute('datetime') === day(2), 'la salida de transferencia tiene su fecha exacta');
    verify((await text(entries('nequi').last())).includes('Mercado local'), 'la fecha más antigua está al final');
    verify(await hasText(entries('nequi').filter({ hasText: 'Transferencia a Efectivo' }), '−$'), 'la transferencia saliente tiene signo negativo');
    verify(await hasText(entries('nequi').filter({ hasText: 'Transferencia desde Efectivo' }), '+$'), 'la transferencia recibida tiene signo positivo');
    verify(await hasText(entries('nequi').filter({ hasText: 'Mercado local' }), 'Supermercado'), 'incluye comercio cuando está disponible');
    await open('efectivo');
    verify(await entries('efectivo').count() === 3, 'cada historial se limita al bolsillo correspondiente');
    verify(await hasText(entries('efectivo').filter({ hasText: 'Transferencia a NéQUI' }), '15.000'), 'la misma transferencia aparece desde el bolsillo de origen');
    await open('general');
    verify(await hasText(entries('general').first(), 'Ingreso sin asignar'), 'General recoge movimientos sin bolsillo');
    await open('ahorros');
    verify(await history('ahorros').locator('p').isVisible(), 'bolsillo sin actividad tiene mensaje útil');

    await page.getByRole('button', { name: 'Configurar Nequi', exact: true }).click();
    verify(await page.getByRole('dialog').getByLabel('Nombre').inputValue() === 'NéQUI', 'el acceso directo reconoce en variantes de caso y acentos');
    verify(await page.getByRole('dialog').getByLabel('Saldo inicial (COP)').inputValue() === '20000', 'reutiliza el saldo existente');
    await page.getByRole('dialog').getByRole('button', { name: 'Guardar', exact: true }).click();
    verify(await page.locator('.wallet-grid article').count() === 4, 'guardar la configuración no duplica el bolsillo');
    verify(await history('nequi').getAttribute('open') !== null, 'se conserva el historial abierto al editar');
    await page.getByText('Comparar con Nequi', { exact: true }).click();
    const comparison = page.locator('#wallet-nequi-compare');
    const balance = comparison.getByLabel('Saldo de hoy en Nequi (COP)');
    const result = comparison.locator('output');
    const compare = value => balance.fill(value).then(() => comparison.getByRole('button', { name: 'Comparar', exact: true }).click());
    const beforeCompare = await page.evaluate(() => localStorage.getItem('saldo-personal-v1'));
    await compare('82000');
    verify(await hasText(result, 'Los saldos coinciden') && await hasText(result, '82.000'), 'comparación excluye movimientos y transferencias después de hoy');
    await compare('83000');
    verify(await hasText(result, 'mayor') && await hasText(result, '1.000'), 'compara una diferencia positiva');
    await compare('81000');
    verify(await hasText(result, 'menor') && await hasText(result, '1.000'), 'compara una diferencia negativa');
    await balance.fill('0');
    await balance.press('Enter');
    verify(await hasText(result, 'menor') && (await text(result)).match(/82\.000/g)?.length === 2, 'acepta cero con envío desde el teclado');
    await compare('123.45');
    verify(await hasText(result, 'menor') && await hasText(result, '81.876,55'), 'acepta centavos con punto y muestra el cálculo con formato colombiano');
    await compare('82000,01');
    verify(await hasText(result, 'mayor') && await hasText(result, '0,01'), 'acepta centavos con coma y muestra una diferencia de un centavo');
    for (const invalid of ['', '-1', '123.456', 'abc', '1234567890123']) {
      await compare(invalid);
      verify(!await balance.evaluate(element => element.validity.valid) && await text(result) === '', 'rechaza entrada no válida ' + invalid);
    }
    verify(await page.evaluate(() => localStorage.getItem('saldo-personal-v1')) === beforeCompare, 'comparar deja intactos los registros y el saldo inicial');
    verify((await page.getByRole('link', { name: 'Cómo descargar extractos de Nequi' }).getAttribute('href')).startsWith('https://ayuda.nequi.com.co/'), 'ayuda de extractos enlaza al sitio oficial');
    verify(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'historial y comparación caben con todos los bolsillos abiertos');

    const fresh = await startPage(empty);
    await fresh.getByRole('button', { name: 'Configurar Nequi', exact: true }).click();
    const newWallet = fresh.getByRole('dialog');
    verify(await newWallet.getByLabel('Nombre').inputValue() === 'Nequi', 'nuevo bolsillo viene con nombre prellenado');
    await newWallet.getByLabel('Saldo inicial (COP)').fill('45000');
    await newWallet.getByRole('button', { name: 'Guardar', exact: true }).click();
    verify(await fresh.locator('.wallet-grid article').count() === 2, 'crea un bolsillo Nequi además de General');
    verify(await hasText(fresh.locator('.wallet-total strong'), '45.000'), 'el saldo inicial suma al total');
    await fresh.getByRole('button', { name: 'Configurar Nequi', exact: true }).click();
    verify(await newWallet.getByLabel('Saldo inicial (COP)').inputValue() === '45000', 'nuevo acceso vuelve a abrir el mismo bolsillo');
    await newWallet.getByLabel('Saldo inicial (COP)').fill('50000');
    await newWallet.getByRole('button', { name: 'Guardar', exact: true }).click();
    verify(await fresh.locator('.wallet-grid article').count() === 2, 'edita un bolsillo existente sin sumar otro');
    verify(await hasText(fresh.locator('.wallet-total strong'), '50.000'), 'permite corregir el saldo inicial');
    return checked;
  } finally { await Promise.all([existing.close(), empty.close()]); }
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN });
  try {
    let total = 0;
    for (const viewport of viewports) {
      const checked = await examine(browser, viewport);
      total += checked;
      console.log(viewport.width + ' × ' + viewport.height + ' · ' + checked + ' comprobaciones de bolsillos');
    }
    console.log(total + ' comprobaciones de bolsillos correctas.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
