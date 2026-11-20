// Run with Playwright installed and CHROME_BIN pointing to Chrome, or install
// the Playwright Chromium build. No real account or Supabase data is used.
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require(process.env.SALDO_PLAYWRIGHT_MODULE || 'playwright');

const source = path.resolve(__dirname, '..');
const screens = [
  ['compacto', 280, 653], ['SE', 320, 568], ['Android pequeño', 360, 640],
  ['iPhone clásico', 375, 667], ['iPhone 13', 390, 844], ['Pixel', 412, 915],
  ['iPhone grande', 430, 932], ['corte móvil', 640, 800], ['corte tableta', 641, 800],
  ['iPad', 768, 1024], ['móvil horizontal', 844, 390], ['portátil', 1024, 768],
  ['escritorio', 1440, 900],
];
const contentTypes = {
  '.css': 'text/css', '.html': 'text/html', '.js': 'text/javascript',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml',
};
const tabs = ['home', 'movements', 'budgets', 'reports', 'account'];

let passed = 0;
const failures = [];

function check(screen, description, condition) {
  if (condition) passed += 1;
  else failures.push(`${screen}: ${description}`);
}

async function noHorizontalOverflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
}

async function inViewportWidth(locator) {
  return locator.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return rect.left >= -1 && rect.right <= document.documentElement.clientWidth + 1;
  });
}

async function doesNotOverlap(first, second) {
  const a = await first.boundingBox();
  const b = await second.boundingBox();
  return Boolean(a && b) && (a.x + a.width <= b.x + 1 || b.x + b.width <= a.x + 1 || a.y + a.height <= b.y + 1 || b.y + b.height <= a.y + 1);
}

async function startFixtureServer() {
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    const relativePath = url.pathname === '/' ? '/index.html' : url.pathname;
    const file = path.resolve(source, `.${relativePath}`);
    if (!file.startsWith(source + path.sep)) return response.writeHead(404).end();
    try {
      const body = await fs.readFile(file);
      const contentType = contentTypes[path.extname(file)] || 'application/octet-stream';
      response.writeHead(200, { 'Content-Type': contentType, 'Content-Length': body.length }).end(body);
    } catch (error) {
      response.writeHead(error.code === 'ENOENT' ? 404 : 500).end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server;
}

async function inspectScreen(browser, origin, [name, width, height]) {
  const label = `${name} ${width}×${height}`;
  const mobile = width <= 640;
  const context = await browser.newContext({
    viewport: { width, height }, isMobile: mobile, hasTouch: mobile,
    reducedMotion: 'reduce', serviceWorkers: 'block',
  });
  const page = await context.newPage();
  page.setDefaultTimeout(4500);
  page.setDefaultNavigationTimeout(8000);
  const before = passed;
  const errors = [];
  const guard = new Date();
  const fixtureDate = new Date(guard.getFullYear(), guard.getMonth(), 5, 12).toISOString().slice(0, 10);
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.addInitScript(({ fixtureDate }) => {
      localStorage.setItem('saldo-personal-v1', JSON.stringify({
        profile: { name: 'Camila' },
        transactions: [{
          id: 'qa-a', type: 'income', title: 'Un nombre largo para comprobar que el texto se ajusta',
          amount: 999999999, category: 'Salario', date: fixtureDate, note: 'Dato de prueba local',
        }],
      }));
    }, { fixtureDate });
    const response = await page.goto(origin);
    check(label, 'el sitio carga', response?.ok());
    check(label, 'tamaño del viewport correcto', await page.evaluate(() => window.innerWidth === document.documentElement.clientWidth));

    const guest = page.locator('[data-action="guest"]');
    const auth = page.locator('.auth-shell');
    await guest.waitFor({ state: 'visible' });
    check(label, 'pantalla de acceso visible', await auth.isVisible());
    check(label, 'acceso completo en anchura', await noHorizontalOverflow(page));
    check(label, 'correo visible', await auth.getByLabel('Correo electrónico').isVisible());
    check(label, 'contraseña visible', await auth.getByLabel('Contraseña', { exact: true }).isVisible());
    check(label, 'el logo del acceso se puede renderizar', await auth.locator('.auth-hero-mark img').evaluate(image => image.complete && image.naturalWidth > 0));
    await auth.locator('[data-mode="signup"]').click();
    check(label, 'permite abrir el formulario de registro', await auth.getByLabel('Contraseña', { exact: true }).getAttribute('autocomplete') === 'new-password');
    await auth.locator('[data-mode="signin"]').first().click();
    await auth.locator('[data-mode="recovery"]').click();
    check(label, 'recuperación solo pide correo', await auth.getByLabel('Correo electrónico').isVisible() && !await auth.getByLabel('Contraseña', { exact: true }).count());
    await auth.locator('[data-mode="signin"]').click();
    await auth.locator('[data-mode="admin"]').click();
    check(label, 'permite abrir acceso de administrador', await auth.getByRole('heading', { name: 'Acceso de administrador' }).isVisible());
    await auth.locator('[data-mode="signin"]').click();
    check(label, 'permite entrar en modo local', await guest.isVisible());
    if (process.env.SALDO_QA_SCREENSHOTS && width === 390) await page.screenshot({ path: path.join(process.env.SALDO_QA_SCREENSHOTS, 'saldo-acceso.png'), fullPage: true });
    await guest.click();

    const navigation = page.locator(mobile ? '.mobile-nav' : '.sidebar .nav-list');
    await navigation.waitFor({ state: 'visible' });
    check(label, 'navegación adecuada al ancho', await navigation.isVisible());
    check(label, 'solo se muestra una navegación', !await page.locator(mobile ? '.sidebar .nav-list' : '.mobile-nav').isVisible());
    check(label, 'los cinco destinos están presentes', await navigation.locator('button[data-tab]').count() === tabs.length);
    check(label, 'la navegación cabe en pantalla', await inViewportWidth(navigation));

    for (const tab of tabs) {
      const item = navigation.locator(`[data-tab="${tab}"]`);
      if (mobile) {
        const box = await item.boundingBox();
        check(label, `área táctil de ${tab} al menos 44×44`, box?.width >= 44 && box?.height >= 44);
      }
      await item.click();
      check(label, `${tab} queda activo para lectores de pantalla`, await item.getAttribute('aria-current') === 'page');
      check(label, `${tab} no desborda horizontalmente`, await noHorizontalOverflow(page));
      if (tab === 'home') {
        const month = page.locator('.topbar .month-picker');
        const movement = page.locator('.topbar [data-action="new-transaction"]');
        check(label, 'selector de mes y botón nuevo no se montan', await doesNotOverlap(month, movement));
        if (process.env.SALDO_QA_SCREENSHOTS && width === 390) await page.screenshot({ path: path.join(process.env.SALDO_QA_SCREENSHOTS, 'saldo-inicio.png'), fullPage: true });
      }
      if (tab === 'movements') {
        const row = page.locator('.movement-list .transaction-row').first();
        check(label, 'los movimientos muestran datos de prueba', await row.isVisible());
        check(label, 'importe y acción de editar no se montan', await doesNotOverlap(row.locator('.transaction-amount'), row.locator('[data-action="edit-transaction"]')));
      }
    }

    const mainAction = page.locator('.topbar [data-action="new-transaction"]');
    check(label, 'texto de nuevo movimiento visible', await mainAction.locator('span').isVisible());
    await mainAction.click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor({ state: 'visible' });
    check(label, 'el formulario aparece dentro del ancho del teléfono', await inViewportWidth(dialog));
    check(label, 'el campo de valor es utilizable', await dialog.locator('#tx-amount').isEditable());
    check(label, 'el diálogo conserva desplazamiento cuando no cabe', await dialog.evaluate(el => el.scrollHeight <= el.clientHeight || getComputedStyle(el).overflowY === 'auto'));
    await dialog.locator('[data-action="close-modal"]').first().click();
    check(label, 'el formulario se cierra', await dialog.count() === 0);

    const imageLoads = await page.evaluate(async () => {
      const img = new Image();
      img.src = './icons/saldo.svg';
      await img.decode().catch(() => {});
      return img.naturalWidth > 0 && img.naturalHeight > 0;
    });
    check(label, 'el nuevo logo se puede renderizar', imageLoads);
    check(label, `sin errores JavaScript (${errors.join(', ') || 'ninguno'})`, errors.length === 0);
  } catch (error) {
    failures.push(`${label}: ${error.message}${errors.length ? `\nErrores JS: ${errors.join('; ')}` : ''}`);
  } finally {
    await context.close();
    console.log(`${label}: ${passed - before} comprobaciones correctas`);
  }
}

(async () => {
  const fixture = await startFixtureServer();
  const origin = `http://127.0.0.1:${fixture.address().port}`;
  try {
    const browser = await chromium.launch({
      executablePath: process.env.CHROME_BIN,
      args: ['--disable-crashpad-for-testing', '--disable-dev-shm-usage', '--no-proxy-server', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'],
    });
    try {
      for (const screen of screens) await inspectScreen(browser, origin, screen);
    } finally {
      await browser.close();
    }
  } finally {
    fixture.close();
  }

  console.log(`${passed} comprobaciones correctas en ${screens.length} tamaños de pantalla.`);
  if (failures.length) {
    console.error(failures.join('\n'));
    process.exitCode = 1;
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
