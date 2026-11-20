// Two independent browser sessions and a shared synthetic cloud ledger.
const assert = require('node:assert/strict');
const { chromium } = require(process.env.SALDO_PLAYWRIGHT_MODULE || 'playwright');
const { normalize } = require('../saldo-state.js');

const url = process.env.SALDO_QA_URL || 'http://localhost:4173/';
const api = 'https://odveqruhywtrdajuxcts.supabase.co';
const user = { id: '0976c504-5dcd-4a97-bea6-a5276ac403f6', email: 'sync.qa@example.invalid', role: 'authenticated' };
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const token = encode({ alg: 'HS256', typ: 'JWT' }) + '.' + encode({
  sub: user.id, aud: 'authenticated', role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 7200,
}) + '.syntheticsignature';
const today = new Intl.DateTimeFormat('sv-SE', { dateStyle: 'short', timeZone: 'America/Bogota' }).format(new Date());
const expense = (id, title, amount) => ({ id, title, amount, category: 'Otros gastos', type: 'expense', date: today });

function sharedCloud() {
  const cloud = {
    row: {
      user_id: user.id,
      version: 1,
      updated_at: new Date().toISOString(),
      payload: normalize({ transactions: [expense('one', 'Mercado inicial', 30000), expense('two', 'Farmacia inicial', 20000)] }),
    },
    mutations: 0,
  };
  async function intercept(route, connection) {
    const request = route.request();
    const requestUrl = new URL(request.url());
    const method = request.method();
    const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS' };
    const json = (body, status = 200) => route.fulfill({ status, headers, json: body });
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (requestUrl.pathname === '/auth/v1/token') {
      return json({ user, access_token: token, refresh_token: 'synthetic-token', token_type: 'bearer', expires_in: 7200 });
    }
    if (requestUrl.pathname === '/rest/v1/rpc/saldo_admin_access') return json({ allowed: false, verified: false });
    if (requestUrl.pathname === '/functions/v1/saldo-notify') return json({ vapidPublicKey: 'B' + 'a'.repeat(86) });
    if (requestUrl.pathname === '/rest/v1/saldo_data') {
      if (!connection.online) return route.abort('internetdisconnected');
      if (requestUrl.searchParams.get('user_id') !== 'eq.' + user.id) return json({ code: 'invalid_fixture_request' }, 403);
      if (method === 'GET') return json([cloud.row]);
      if (method === 'PATCH' && requestUrl.searchParams.get('version') === 'eq.' + cloud.row.version) {
        cloud.row = { ...cloud.row, ...request.postDataJSON() };
        cloud.mutations += 1;
        return json([{ version: cloud.row.version, updated_at: cloud.row.updated_at }]);
      }
      return json([]);
    }
    return json({ code: 'unexpected_endpoint' }, 404);
  }
  return { cloud, intercept };
}

async function signIn(page) {
  await page.goto(url);
  await page.locator('#auth-email').fill(user.email);
  await page.locator('#auth-password').fill('synthetic-qa-password');
  await page.locator('#auth-form [type="submit"]').click();
  await page.locator('.private-pill [data-cloud-status]').getByText('Sincronizado', { exact: true }).waitFor();
}

async function tab(page, name) {
  await page.locator('.mobile-nav [data-tab="' + name + '"]').click();
}

async function editMovement(page, before, after, amount) {
  await page.getByRole('button', { name: 'Editar ' + before, exact: true }).click();
  await page.locator('#tx-title').fill(after);
  await page.locator('#tx-amount').fill(String(amount));
  await page.locator('#transaction-form [type="submit"]').click();
  await page.locator('#transaction-form').waitFor({ state: 'hidden' });
}

async function manualSync(page, status = 'Sincronizado') {
  await tab(page,'account');
  await page.getByRole('button', { name: 'Sincronizar ahora' }).click();
  await page.locator('.cloud-account [data-cloud-status]').getByText(status, { exact: true }).waitFor();
}

function setBackup(page, name, value) {
  return page.locator('#import-file').setInputFiles({
    name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)),
  });
}

async function confirmBackup(page, name, value, accept) {
  const confirmation = page.waitForEvent('dialog').then(dialog => {
    assert.match(dialog.message(), /reemplazará los datos de tu cuenta/);
    return accept ? dialog.accept() : dialog.dismiss();
  });
  await Promise.all([confirmation, setBackup(page, name, value)]);
}

async function main() {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN });
  const options = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, timezoneId: 'America/Bogota', reducedMotion: 'reduce' };
  const { cloud, intercept } = sharedCloud();
  const firstNetwork = { online: true };
  const errors = [];
  let passed = 0;
  const check = (value, label) => { assert.ok(value, label); passed++; console.log('OK ' + label); };

  try {
    const firstContext = await browser.newContext(options);
    const secondContext = await browser.newContext(options);
    await firstContext.route(api + '/**', route => intercept(route, firstNetwork));
    await secondContext.route(api + '/**', route => intercept(route, { online: true }));
    const first = await firstContext.newPage();
    const second = await secondContext.newPage();
    for (const page of [first, second]) {
      page.setDefaultTimeout(9000);
      page.on('pageerror', error => errors.push(error.message));
      await signIn(page);
      await tab(page, 'movements');
      check(await page.getByText('Mercado inicial', { exact: true }).isVisible(), 'el dispositivo carga los datos de la misma cuenta');
    }

    firstNetwork.online = false;
    await editMovement(first, 'Mercado inicial', 'Mercado local', 31000);
    await editMovement(first, 'Farmacia inicial', 'Farmacia local', 21000);
    await first.locator('.topbar [data-action="new-transaction"]').click();
    await first.locator('#tx-title').fill('Compra sin conexión');
    await first.locator('#tx-amount').fill('5000');
    await first.locator('#transaction-form [type="submit"]').click();
    await first.locator('#transaction-form').waitFor({ state: 'hidden' });
    await manualSync(first, 'Sin conexión con la nube');
    check(cloud.mutations === 0, 'la pérdida de conexión conserva las ediciones solo en el dispositivo');
    await first.reload();
    await first.locator('.app-shell').waitFor();
    await tab(first, 'movements');
    check(await first.getByText('Compra sin conexión', { exact: true }).isVisible(), 'la recarga conserva los cambios pendientes');
    check(await first.getByText('Mercado local', { exact: true }).isVisible(), 'la recarga conserva la edición del movimiento existente');

    await editMovement(second, 'Mercado inicial', 'Mercado nube', 32000);
    await editMovement(second, 'Farmacia inicial', 'Farmacia nube', 22000);
    await manualSync(second);
    check(cloud.row.payload.transactions.some(tx => tx.title === 'Farmacia nube'), 'el segundo dispositivo guarda su edición en la nube');
    const beforeConflict = cloud.row.version;
    firstNetwork.online = true;
    await manualSync(first, 'Revisa los cambios en Cuenta');
    const firstChoice = first.getByRole('heading', { name: 'Dos cambios en el mismo movimiento' }).locator('..')
      .filter({ hasText: 'Mercado local' });
    const secondChoice = first.getByRole('heading', { name: 'Dos cambios en el mismo movimiento' }).locator('..')
      .filter({ hasText: 'Farmacia local' });
    check(await first.getByRole('heading', { name: 'Dos cambios en el mismo movimiento' }).count() === 2, 'se pide una decisión para cada movimiento editado dos veces');
    check(cloud.row.version === beforeConflict, 'se espera una elección antes de cambiar la nube');
    check(await firstChoice.getByText(/Nube · Mercado nube/).isVisible(), 'la comparación muestra la versión de la nube');
    await firstChoice.getByRole('button', { name: 'Usar este dispositivo' }).click();
    await secondChoice.getByRole('button', { name: 'Usar la nube' }).click();
    await manualSync(first);
    check(cloud.row.payload.transactions.some(tx => tx.id === 'one' && tx.title === 'Mercado local' && tx.amount === 31000), 'conserva la versión del dispositivo al elegirla');
    check(cloud.row.payload.transactions.some(tx => tx.id === 'two' && tx.title === 'Farmacia nube' && tx.amount === 22000), 'conserva la versión de la nube al elegirla');
    check(cloud.row.payload.transactions.some(tx => tx.title === 'Compra sin conexión'), 'sincroniza los cambios pendientes que no tienen conflicto');
    await manualSync(second);
    await tab(second, 'movements');
    check(await second.getByText('Mercado local', { exact: true }).isVisible(), 'el segundo dispositivo recibe la resolución');

    await first.locator('#data-panel > summary').click();
    const [copy] = await Promise.all([first.waitForEvent('download'), first.locator('[data-action="export-json"]').click()]);
    const stream = await copy.createReadStream();
    let text = '';
    for await (const chunk of stream) text += chunk.toString('utf8');
    const restored = JSON.parse(text);
    check(restored.format === 'saldo-backup-v1' && restored.state.transactions.length === 3, 'exporta una copia con la versión resuelta');
    const invalid = structuredClone(restored);
    invalid.state.transactions[0].amount = 0;
    const beforeInvalid = cloud.row.version;
    await setBackup(first, 'saldo-invalida.json', invalid);
    await first.getByText('No se pudo leer esa copia de seguridad.', { exact: true }).waitFor();
    check(cloud.row.version === beforeInvalid && cloud.row.payload.transactions.length === 3, 'rechaza la copia inválida y conserva los movimientos');

    await tab(first, 'movements');
    await editMovement(first, 'Mercado local', 'Mercado cambiado después de exportar', 40000);
    await manualSync(first);
    if (await first.locator('#data-panel').getAttribute('open') === null) await first.locator('#data-panel > summary').click();
    await confirmBackup(first, 'saldo-cancelada.json', restored, false);
    await tab(first, 'movements');
    check(await first.getByText('Mercado cambiado después de exportar', { exact: true }).isVisible(), 'cancelar la confirmación mantiene el movimiento actual');
    await tab(first, 'account');
    await confirmBackup(first, 'saldo-restaurada.json', restored, true);
    await first.getByText('Copia importada correctamente.', { exact: true }).waitFor();
    await manualSync(first);
    check(cloud.row.payload.transactions.some(tx => tx.id === 'one' && tx.title === 'Mercado local' && tx.amount === 31000), 'la restauración válida recupera los valores de la copia en la nube');
    check(!cloud.row.payload.transactions.some(tx => tx.title.includes('después de exportar')), 'se reemplaza el registro modificado después de exportar');
    await manualSync(second);
    await tab(second, 'movements');
    check(await second.getByText('Mercado local', { exact: true }).isVisible(), 'la copia restaurada se sincroniza con el segundo dispositivo');
    check(errors.length === 0, 'sin errores JavaScript durante los flujos (' + errors.join(', ') + ')');
    console.log(passed + ' comprobaciones de sincronización y recuperación correctas.');
  } finally {
    await browser.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
