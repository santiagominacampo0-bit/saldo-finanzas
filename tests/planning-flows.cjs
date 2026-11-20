// Browser flows with synthetic guest data. No requests reach production Supabase.
const assert = require('node:assert/strict');
const { chromium } = require(process.env.SALDO_PLAYWRIGHT_MODULE || 'playwright');
const url = process.env.SALDO_QA_URL || 'http://localhost:4173/';
const sizes = [{ width: 320, height: 640 }, { width: 390, height: 844 }, { width: 850, height: 400 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }];

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
    test(await page.getByText('Disponible después de pagos', {exact:true}).isVisible(), 'inicio anticipa disponibilidad');
    test(await page.getByText('Ver recurrentes', {exact:true}).count() === 0, 'inicio usa una sola entrada de calendario');
    await nav('budgets');
    test(await page.locator('.planner-nav button').count() === 4, 'cuatro secciones de planificación');
    test(await fits(), 'pestañas completas en el ancho');
    test(await page.locator('.planner-nav [data-view=recurring]').count() === 0, 'sin pestaña separada de recurrentes');
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

    await plan('calendar');
    const calendarRow = title => page.locator('.calendar-row').filter({ has: page.getByText(title, { exact: true }) });
    const createSchedule = async (title, amount) => {
      await page.getByRole('button', { name: 'Programar movimiento' }).click();
      await dialog().getByLabel('Concepto').fill(title);
      await dialog().getByLabel('Valor (COP)').fill(amount);
    };
    await createSchedule('Arriendo QA', '9000');
    test(await dialog().getByLabel('Frecuencia').count() === 0, 'el formulario programa una sola fecha');
    await dialog().getByLabel('Avisar con días de anticipación').fill('2');
    const occurrence = await dialog().getByLabel('Fecha programada').inputValue();
    await save();
    const rent = calendarRow('Arriendo QA');
    test(await rent.getByText('Pendiente', { exact: true }).isVisible(), 'crea un pago para una fecha');
    await nav('movements');
    test(await page.getByText('Arriendo QA', { exact: true }).count() === 0, 'programar no contabiliza el pago');
    await nav('budgets');
    await plan('calendar');
    const confirmRent = rent.getByRole('button', { name: 'Registrar pago' });
    await confirmRent.click();
    test(await confirmRent.getAttribute('data-due') === occurrence, 'cancelar mantiene el pago pendiente');
    page.once('dialog', dialog => dialog.accept());
    await confirmRent.click();
    test(await rent.getByText('Registrado', { exact: true }).isVisible(), 'confirmar marca el movimiento registrado');
    test(await confirmRent.count() === 0, 'un pago registrado no se confirma otra vez');
    await page.getByRole('button', { name: 'Todas las fechas' }).click();
    test(await rent.count() === 1, 'un pago confirmado no agrega otra fecha');
    await nav('movements');
    test(await page.getByText('Arriendo QA', { exact: true }).count() === 1, 'confirmar registra exactamente un pago');

    await nav('budgets');
    await plan('calendar');
    await createSchedule('Ingreso lejano QA', '50000');
    await dialog().getByLabel('Tipo', { exact: true }).selectOption('income');
    test(await dialog().getByLabel('Categoría').locator('option').filter({ hasText: 'Salario' }).count() === 1, 'actualiza categorías para un cobro');
    const future = new Date(Date.parse(occurrence + 'T00:00:00Z') + 45 * 86400000).toISOString().slice(0, 10);
    await dialog().getByLabel('Fecha programada').fill(future);
    await save();
    const far = calendarRow('Ingreso lejano QA');
    test(await far.getByRole('button', { name: 'Registrar cobro' }).isVisible(), 'todas las fechas muestra cobros más allá de treinta días');
    await page.getByRole('button', { name: '30 días' }).click();
    test(await far.count() === 0, 'la ventana de treinta días excluye el cobro lejano');
    await page.getByRole('button', { name: 'Todas las fechas' }).click();
    await far.getByRole('button', { name: 'Editar Ingreso lejano QA' }).click();
    await dialog().getByLabel('Movimiento activo').uncheck();
    await save();
    test(await far.getByText('En pausa', { exact: true }).isVisible(), 'puede pausar un cobro previsto');
    test(await far.getByRole('button', { name: 'Registrar cobro' }).count() === 0, 'un cobro en pausa no se puede registrar');
    await far.getByRole('button', { name: 'Editar Ingreso lejano QA' }).click();
    page.once('dialog', dialog => dialog.accept());
    await dialog().getByRole('button', {name: 'Eliminar'}).click();
    test(await far.count() === 0, 'puede eliminar del calendario un cobro lejano');
    test(await fits(), 'el calendario y sus controles caben en el ancho');

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
