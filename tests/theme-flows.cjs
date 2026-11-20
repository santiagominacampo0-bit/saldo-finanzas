// Browser checks use only synthetic guest data.
const assert = require('node:assert/strict');
const { chromium } = require(process.env.SALDO_PLAYWRIGHT_MODULE || 'playwright');
const address = process.env.SALDO_QA_URL || 'http://localhost:4173/';
const viewports = [{ width: 280, height: 650 }, { width: 390, height: 844 }, { width: 1440, height: 900 }];
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Bogota' });

function luminance(color) {
  const rgb = color.match(/\d+(?:\.\d+)?/g).slice(0, 3).map(Number);
  return rgb.map(value => {
    const part = value / 255;
    return part <= 0.04045 ? part / 12.92 : ((part + 0.055) / 1.055) ** 2.4;
  }).reduce((sum, part, index) => sum + part * [0.2126, 0.7152, 0.0722][index], 0);
}

async function examine(browser, viewport) {
  const context = await browser.newContext({
    viewport, isMobile: viewport.width < 650, colorScheme: 'dark', reducedMotion: 'reduce'
  });
  let checked = 0;
  function verify(condition, message) {
    assert.ok(condition, message);
    checked += 1;
  }
  try {
    await context.route('https://odveqruhywtrdajuxcts.supabase.co/**', route => route.abort());
    await context.addInitScript(date => {
      if (localStorage.getItem('saldo-personal-v1')) return;
      localStorage.setItem('saldo-personal-v1', JSON.stringify({ transactions: [
        { id: 'income-theme', type: 'income', amount: 95000, title: 'Ejemplo de ingreso', category: 'Salario', date },
        { id: 'expense-theme', type: 'expense', amount: 31000, title: 'Ejemplo de gasto', category: 'Alimentación', date }
      ] }));
    }, today);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const nav = id => page.locator('.nav-button:visible[data-tab="' + id + '"]').click();
    const mode = () => page.locator('html').getAttribute('data-theme');
    const contrast = (selector, color = 'color', backgroundSelector = null, threshold = 4.5) =>
      page.locator(selector).first().evaluate((element, options) => {
        const backgroundElement = options.backgroundSelector ? document.querySelector(options.backgroundSelector) : element;
        return [getComputedStyle(element).getPropertyValue(options.color), getComputedStyle(backgroundElement).backgroundColor];
      }, { color, backgroundSelector }).then(([foreground, background]) => {
        const values = [luminance(foreground), luminance(background)];
        verify((Math.max(...values) + 0.05) / (Math.min(...values) + 0.05) >= threshold,
          'contraste suficiente para ' + selector + ' ' + color);
      });
    const fits = selector => page.locator(selector).evaluate(element => element.scrollWidth <= element.clientWidth + 1);
    await page.goto(address);
    await page.locator('.auth-card').waitFor();
    verify(await mode() === 'dark', 'el modo inicial sigue al sistema');
    verify(await page.locator('meta[name="theme-color"]').getAttribute('content') === '#111b17', 'tinte oscuro del navegador');
    verify(await page.locator('html').evaluate(element => getComputedStyle(element).colorScheme) === 'dark', 'controles nativos oscuros');
    await contrast('body');
    await contrast('.auth-card h2', 'color', '.auth-card');
    await contrast('.auth-card .primary-button');
    await contrast('.auth-card .field input', 'border-top-color', null, 3);
    verify(await fits('html'), 'vista de acceso no desborda');
    await page.locator('[data-action="guest"]').click();
    await nav('account');
    const select = page.getByLabel('Tema', { exact: true });
    verify(await select.inputValue() === 'system', 'Tema indica la opción automática');
    verify(await fits('html'), 'apariencia cabe en la pantalla');
    await contrast('#saldo-theme');
    verify(await select.evaluate(element => element.getBoundingClientRect().height >= 44), 'control táctil de 44 px');
    await page.emulateMedia({ colorScheme: 'light' });
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
    verify(await mode() === 'light', 'reacciona a cambio del sistema a claro');
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    verify(await mode() === 'dark', 'reacciona a cambio del sistema a oscuro');
    await select.selectOption('light');
    verify(await mode() === 'light', 'Claro prevalece sobre el sistema oscuro');
    verify(await page.locator('meta[name="theme-color"]').getAttribute('content') === '#f7f8f5', 'tinte claro del navegador');
    await select.selectOption('dark');
    await page.emulateMedia({ colorScheme: 'light' });
    verify(await mode() === 'dark', 'Oscuro prevalece sobre el sistema claro');
    await page.reload();
    await page.locator('.auth-card').waitFor();
    verify(await mode() === 'dark', 'Oscuro persiste tras recargar');
    await page.locator('[data-action="guest"]').click();
    await nav('account');
    verify(await select.inputValue() === 'dark', 'la opción persistida vuelve a mostrarse');
    await nav('reports');
    await page.locator('.report-chart').waitFor();
    await contrast('.report-bar.income', 'background-color', '.report-grid > .panel', 3);
    await contrast('.report-bar.expense', 'background-color', '.report-grid > .panel', 3);
    await page.locator('.topbar [data-action="new-transaction"]').click();
    await page.getByRole('dialog').waitFor();
    await contrast('#tx-amount', 'color');
    verify(await fits('.modal'), 'el cuadro oscuro de movimiento cabe en pantalla');
    await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
    await page.goto(new URL('privacy.html', address).href);
    verify(await mode() === 'dark', 'la política de privacidad aplica Oscuro');
    await contrast('.privacy-document p:not(.updated)', 'color', '.privacy-document');
    await contrast('.privacy-document a', 'color', '.privacy-document');
    verify(await fits('html'), 'la política de privacidad cabe en pantalla');
    verify(!errors.length, 'sin errores JavaScript');
    return checked;
  } finally { await context.close(); }
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN });
  try {
    let total = 0;
    for (const viewport of viewports) {
      const checked = await examine(browser, viewport);
      total += checked;
      console.log(viewport.width + ' × ' + viewport.height + ' · ' + checked + ' comprobaciones de tema');
    }
    console.log(total + ' comprobaciones de tema correctas.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
