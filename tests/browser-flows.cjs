// Real browser with synthetic records; network calls to Supabase are stubbed.
const assert = require('node:assert/strict');
const { chromium } = require(process.env.SALDO_PLAYWRIGHT_MODULE || 'playwright');

const url = process.env.SALDO_QA_URL || 'http://localhost:4173/';
const pageSize = { width: 390, height: 844 };
const api = 'https://odveqruhywtrdajuxcts.supabase.co';
const user = { id: '85283d36-ac06-4b45-a6d6-0b65cb58d444', email: 'qa@example.invalid', role: 'authenticated' };
const segment = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const token = segment({ alg: 'HS256', typ: 'JWT' }) + '.' + segment({
  sub: user.id, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 7200,
}) + '.syntheticsignature';
let passed = 0;

function check(condition, message) {
  assert.ok(condition, message);
  passed += 1;
  console.log('OK ' + message);
}

async function enterGuest(page) {
  await page.locator('[data-action="guest"]').click();
  await page.locator('.app-shell').waitFor();
}

async function tab(page, name) {
  await page.locator('.mobile-nav [data-tab="' + name + '"]').click();
}

async function addExpense(page, amount, title) {
  await page.locator('.topbar [data-action="new-transaction"]').click();
  await page.locator('#tx-amount').fill(amount);
  await page.locator('#tx-title').fill(title);
  await page.locator('#transaction-form button[type="submit"]').click();
  await page.locator('#transaction-form').waitFor({ state: 'hidden' });
}

async function main() {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN });
  const browserContext = await browser.newContext({ viewport: pageSize, isMobile: true, hasTouch: true, timezoneId: 'America/Bogota', reducedMotion: 'reduce' });
  const page = await browserContext.newPage();
  page.setDefaultTimeout(9000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const fake = { row: null, requests: [], signedIn: false };
  await browserContext.route(api + '/**', async route => {
    const request = route.request();
    const target = new URL(request.url());
    const method = request.method();
    const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, PATCH' };
    const json = (body, status = 200) => route.fulfill({ status, headers, json: body });
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers });
    fake.requests.push(method + ' ' + target.pathname);
    if (target.pathname === '/auth/v1/token') {
      if (request.postDataJSON().password !== 'synthetic-qa-password') return json({ code: 'invalid_credentials', msg: 'Invalid credentials' }, 400);
      fake.signedIn = true;
      return json({ user, access_token: token, refresh_token: 'synthetic-token', token_type: 'bearer', expires_in: 7200 });
    }
    if (target.pathname === '/auth/v1/logout') {
      fake.signedIn = false;
      return route.fulfill({ status: 204, headers });
    }
    if (target.pathname === '/auth/v1/recover') return json({});
    if (target.pathname === '/auth/v1/signup') return json({ ...user, identities: [{ user_id: user.id }] });
    if (target.pathname === '/rest/v1/saldo_data') {
      if (!fake.signedIn) return json({ code: '42501', message: 'Forbidden' }, 401);
      if (method === 'GET') return json(fake.row ? [fake.row] : []);
      if (method === 'POST') { fake.row = request.postDataJSON(); return route.fulfill({ status: 201, headers }); }
      if (method === 'PATCH' && target.searchParams.get('version') === 'eq.' + fake.row?.version) {
        fake.row = { ...fake.row, ...request.postDataJSON() };
        return json([{ version: fake.row.version }]);
      }
      return json([]);
    }
    if (target.pathname === '/rest/v1/rpc/saldo_admin_access') return json({ allowed: false, verified: false });
    if (target.pathname === '/functions/v1/saldo-notify') return json({ vapidPublicKey: 'B' + 'a'.repeat(86) });
    return json({ code: 'unexpected_endpoint' }, 404);
  });
  try {
    check((await page.goto(url)).ok(), 'carga del sitio');
    await page.locator('[data-action="guest"]').waitFor();
    check(await page.locator('h2').textContent() === 'Inicia sesión', 'la pantalla inicial pide acceso');
    check(await page.locator('.app-shell').count() === 0, 'el tablero aún no se muestra');
    if (process.env.SALDO_QA_SCREENSHOT) await page.screenshot({ path: process.env.SALDO_QA_SCREENSHOT });
    await enterGuest(page);
    await addExpense(page, '55000', 'Compra ficticia QA');
    await tab(page, 'movements');
    check(await page.getByText('Compra ficticia QA', { exact: true }).count() === 1, 'crear gasto como invitado');
    await page.locator('#movement-search').fill('sin coincidencia');
    check(await page.getByText('Compra ficticia QA', { exact: true }).count() === 0, 'filtrar movimientos');
    await page.locator('#movement-search').fill('Compra');
    check(await page.getByText('Compra ficticia QA', { exact: true }).count() === 1, 'restaurar resultados al encontrar coincidencia');
    await tab(page, 'budgets');
    await page.locator('[data-action="edit-budget"][data-category="Alimentación"]').first().click();
    await page.locator('#budget-amount').fill('60000');
    await page.locator('#budget-form button[type="submit"]').click();
    check(await page.getByText('92% utilizado', { exact: true }).count() === 1, 'presupuesto calcula el porcentaje');
    await tab(page, 'reports');
    check(await page.getByRole('img', { name: 'Comparación de ingresos y gastos mensuales' }).count() === 1, 'reporte muestra gráfica con movimientos');
    const [csv] = await Promise.all([page.waitForEvent('download'), page.locator('[data-action="export-csv"]').first().click()]);
    check(csv.suggestedFilename().endsWith('.csv'), 'exporta CSV');
    await tab(page, 'account');
    const [copy] = await Promise.all([page.waitForEvent('download'), page.locator('[data-action="export-json"]').click()]);
    check(copy.suggestedFilename().endsWith('.json'), 'descarga copia JSON');
    await page.locator('[data-action="toggle-reminders"]').click();
    check(await page.locator('[data-action="toggle-reminders"]').getAttribute('aria-checked') === 'true', 'activa recordatorio');
    await page.locator('[data-action="auth-mode"][data-mode="signin"]').first().click();
    await page.locator('#auth-email').fill(user.email);
    await page.locator('#auth-password').fill('wrong');
    await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
    await page.locator('#auth-feedback').getByText(/No pudimos iniciar/).waitFor();
    check(true, 'credenciales inválidas muestran un error sin entrar');
    await page.locator('[data-action="auth-mode"][data-mode="recovery"]').click();
    await page.locator('#auth-email').fill(user.email);
    await page.locator('#auth-form button[type="submit"]').click();
    await page.locator('#auth-feedback').getByText(/recibirás el enlace/).waitFor();
    check(fake.requests.includes('POST /auth/v1/recover'), 'recuperación llama a Supabase Auth simulado');
    await page.locator('[data-action="auth-mode"][data-mode="signin"]').first().click();
    await page.locator('[data-action="auth-mode"][data-mode="signup"]').click();
    await page.locator('#auth-email').fill(user.email);
    await page.locator('#auth-password').fill('synthetic-qa-password');
    await page.locator('#auth-form button[type="submit"]').click();
    await page.locator('#auth-feedback').getByText(/Revisa tu correo/).waitFor();
    check(fake.requests.includes('POST /auth/v1/signup'), 'alta muestra paso de confirmación simulado');
    await page.locator('[data-action="auth-mode"][data-mode="signin"]').first().click();
    await page.locator('#auth-email').fill(user.email);
    await page.locator('#auth-password').fill('synthetic-qa-password');
    await page.locator('#auth-form button[type="submit"]').click();
    await page.locator('.app-shell').waitFor();
    await tab(page, 'movements');
    check(await page.getByText('Compra ficticia QA', { exact: true }).count() === 0, 'datos de invitado quedan separados de la cuenta');
    check(fake.signedIn, 'inicio de sesión con respuesta de Auth simulada');
    await addExpense(page, '8000', 'Movimiento de cuenta QA');
    await tab(page, 'account');
    await page.locator('[data-action="sync-now"]').click();
    await page.locator('small[data-cloud-status]').getByText('Sincronizado', { exact: true }).waitFor();
    check(fake.row?.payload.transactions.some(tx => tx.title === 'Movimiento de cuenta QA'), 'guarda movimientos de la cuenta en REST simulado');
    check(fake.row?.user_id === user.id, 'guarda la fila con el ID autenticado');
    await page.locator('[data-action="sign-out"]').click();
    await page.locator('[data-action="guest"]').waitFor();
    check(!fake.signedIn, 'cierre de sesión devuelve al acceso');
    await page.locator('[data-action="auth-mode"][data-mode="admin"]').click();
    await page.locator('#auth-email').fill(user.email);
    await page.locator('#auth-password').fill('synthetic-qa-password');
    await page.locator('#auth-form button[type="submit"]').click();
    await page.getByText('Esta cuenta no tiene acceso al panel administrativo.').waitFor();
    check(await page.getByText('Cuentas confirmadas', { exact: true }).count() === 0, 'cuenta normal no muestra datos administrativos');
    check(errors.length === 0, 'ningún error JavaScript en los flujos (' + errors.join(', ') + ')');
    console.log(passed + ' comprobaciones del flujo completadas.');
  } finally {
    await browser.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
