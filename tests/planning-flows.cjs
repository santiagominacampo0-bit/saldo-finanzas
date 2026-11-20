// Browser flows with synthetic guest data. No requests reach production Supabase.
const assert = require('node:assert/strict');
const { chromium } = require(process.env.SALDO_PLAYWRIGHT_MODULE || 'playwright');
const url = process.env.SALDO_QA_URL || 'http://localhost:4173/';
const sizes = [{ width: 320, height: 640 }, { width: 390, height: 844 }, { width: 850, height: 400 }, { width: 1440, height: 900 }];

function check(value, label) { assert.ok(value, label); }

async function examine(browser, viewport) {
  const context = await browser.newContext({ viewport, isMobile: viewport.width <= 640, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [];
  let count = 0;
  const test = (value, label) => { check(value, label); count++; };
  const nav = name => page.locator('.nav-button[data-tab="' + name + '"]:visible').click();
  const plan = name => page.locator('.planner-nav [data-view="' + name + '"]').click();
  const dialog = () => page.getByRole('dialog');
  const save = () => dialog().locator('[type=submit]').click();
  const text = selector => page.locator(selector).first().textContent();
  const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
  page.on('pageerror', error => errors.push(error.message));
  await context.route('https://odveqruhywtrdajuxcts.supabase.co/**', route => route.abort());
  try {
    await page.goto(url);
    await page.locator('[data-action="guest"]').click();
    test(await page.getByText('Balance del mes', {exact:true}).isVisible(), 'balance del mes destacado');
    test(await page.getByText('Próximos vencimientos', {exact:true}).isVisible(), 'inicio anticipa vencimientos');
    await nav('budgets');
    test(await page.locator('.planner-nav button').count() === 5, 'cinco secciones de planificación');
    test(await fits(), 'pestañas completas en el ancho');
    test(!await page.locator('.content [data-action="export-csv"]').count(), 'presupuesto no duplica exportación');
    await plan('wallets');
    test(await page.getByRole('heading',{ name:'General',exact:true }).isVisible(), 'bolsillo general visible');
    test(await page.getByRole('button',{ name:'Transferir',exact:true }).isDisabled(), 'transferencias necesitan dos bolsillos');
    await page.getByRole('button',{name:'Nuevo bolsillo'}).click();
    await dialog().getByLabel('Nombre').fill('Efectivo QA');
    await dialog().getByLabel('Saldo inicial (COP)').fill('120000');
    await save();
    test((await page.getByRole('heading',{name:'Efectivo QA'}).locator('xpath=ancestor::article').textContent()).includes('120.000'), 'saldo inicial visible');
    test(await fits(), 'tarjetas de bolsillo sin desborde');

    await page.getByRole('button',{name:'Transferir',exact:true}).click();
    const walletId = await page.locator('#transfer-from option').filter({ hasText: 'Efectivo QA' }).getAttribute('value');
    await dialog().getByLabel('Bolsillo de origen').selectOption(walletId);
    await dialog().getByLabel('Bolsillo de destino').selectOption(walletId);
    await dialog().getByLabel('Valor (COP)').fill('20000');
    await save();
    test(await page.getByText('Elige dos bolsillos distintos.').isVisible(), 'rechaza origen igual al destino');
    await dialog().getByLabel('Bolsillo de destino').selectOption('general');
    await save();
    test(await page.getByText('Efectivo QA → General').isVisible(), 'muestra historial de transferencias');
    test((await page.getByRole('heading',{name:'Efectivo QA'}).locator('xpath=ancestor::article').textContent()).includes('100.000'), 'resta del bolsillo de origen');
    test((await page.getByRole('heading',{name:'General',exact:true}).locator('xpath=ancestor::article').textContent()).includes('20.000'), 'suma al bolsillo de destino');
    await nav('home');
    test(!/[12]0\.000/.test(await text('.balance-amount')), 'transferencia queda fuera del balance mensual');
    await page.locator('.topbar [data-action="new-transaction"]').click();
    await dialog().getByLabel('Bolsillo',{exact:true}).selectOption(walletId);
    await dialog().getByLabel('Valor en pesos').fill('5000');
    await dialog().getByLabel('Concepto').fill('Compra QA');
    await save();
    await nav('budgets');
    await plan('wallets');
    test((await page.getByRole('heading',{name:'Efectivo QA'}).locator('xpath=ancestor::article').textContent()).includes('95.000'), 'gasto se asigna al bolsillo elegido');

    await plan('recurring');
    await page.getByRole('button',{ name:'Nuevo recurrente' }).click();
    await dialog().getByLabel('Concepto').fill('Arriendo QA');
    await dialog().getByLabel('Valor (COP)').fill('9000');
    await dialog().getByLabel('Avisar con días de anticipación').fill('2');
    const occurrence = await dialog().getByLabel('Próximo vencimiento').inputValue();
    await save();
    test(await page.getByRole('heading',{name:'Arriendo QA'}).isVisible(), 'crea pago recurrente');
    await nav('home');
    test(await page.getByText('Arriendo QA',{exact:true}).isVisible(), 'próximo pago mostrado en inicio');
    await nav('movements');
    test(await page.getByText('Arriendo QA',{exact:true}).count() === 0, 'programar no contabiliza el pago');
    await nav('budgets');
    await plan('recurring');
    await page.getByRole('button',{ name:'Registrar pago' }).click();
    // Playwright requires accepting the in-app confirmation instead of default dismissal.
    let rule = page.getByRole('button',{name:'Registrar pago'});
    test(await rule.getAttribute('data-due') === occurrence, 'cancelar mantiene el mismo vencimiento');
    page.once('dialog', d => d.accept());
    await rule.click();
    test(await rule.getAttribute('data-due') > occurrence, 'confirmar adelanta al próximo vencimiento');
    await nav('movements');
    test(await page.getByText('Arriendo QA',{exact:true}).count() === 1, 'confirmar registra exactamente un pago');

    await nav('budgets');
    await plan('goals');
    await page.getByRole('button',{name:'Nueva meta'}).click();
    await dialog().getByLabel('Nombre').fill('Viaje QA');
    await dialog().getByLabel('Meta (COP)').fill('10000');
    await dialog().getByLabel('Ahorrado hasta hoy (COP)').fill('3500');
    await save();
    let progress = page.getByRole('progressbar', {name:'Avance de Viaje QA'});
    test(await progress.getAttribute('aria-valuenow') === '35', 'progreso inicial correcto');
    await page.getByRole('button',{name:'Anotar aporte'}).click();
    await dialog().getByLabel('Aporte (COP)').fill('1500');
    await save();
    test(await progress.getAttribute('aria-valuenow') === '50', 'aporte actualiza avance');
    test(await fits(), 'metas caben en pantalla');
    await page.reload();
    await page.locator('[data-action="guest"]').click();
    await nav('budgets');
    await plan('goals');
    test(await progress.getAttribute('aria-valuenow') === '50', 'progreso persiste al recargar');
    test(errors.length === 0, 'sin errores JavaScript en planificación');
    return count;
  } finally { await context.close(); }
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN });
  try {
    let total = 0;
    for (const size of sizes) {
      const count = await examine(browser, size);
      total += count;
      console.log(size.width + '×' + size.height + ': ' + count + ' comprobaciones');
    }
    console.log(total + ' comprobaciones de planificación correctas');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
