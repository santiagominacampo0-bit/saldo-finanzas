// Release checks use a disposable guest ledger and never call production Supabase.
const assert = require('node:assert/strict');
const { chromium } = require(process.env.SALDO_PLAYWRIGHT_MODULE || 'playwright');
const address = process.env.SALDO_QA_URL || 'http://localhost:4173/';
const today = new Intl.DateTimeFormat('sv-SE', { timeZone:'America/Bogota' }).format(new Date());
const dayOfMonth = Number(today.slice(-2));
const amount = dayOfMonth * 1000;

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN });
  let passed = 0;
  const check = (condition, label) => { assert.ok(condition,label); passed++; };
  try {
    const context = await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});
    await context.route('https://odveqruhywtrdajuxcts.supabase.co/**',r=>r.abort());
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e=>errors.push(e.message));
    await page.addInitScript(({today,amount})=>{
      if (!localStorage.getItem('saldo-personal-v1')) localStorage.setItem('saldo-personal-v1',JSON.stringify({
        wallets:{ nequi:{id:'nequi',name:'Nequi',openingBalance:200000} },
        transactions:[
          { id:'example',title:'Compra de prueba', date:today,category:'Alimentación',type:'expense',amount,walletId:'nequi' },
          { id:'wage',title:'Pago de ejemplo',date:today,category:'Salario',type:'income',amount:100000 },
        ],
        transfers:{cash:{id:'cash',date:today,fromId:'general',toId:'nequi',amount:5000}},
      }));
    },{today,amount});
    await page.goto(address);
    await page.locator('[data-action="guest"]').click();
    check(await page.getByText('3 registros hoy',{exact:true}).isVisible(),'actividad de la fecha incluye transferencia');
    const balance = await page.locator('.balance-amount').textContent();
    check(balance.includes((100000-amount).toLocaleString('es-CO')),'balance del mes excluye transferencia y saldo inicial');
    const nav = tab=>page.locator('.nav-button:visible[data-tab="'+tab+'"]').click();
    await nav('reports');
    check((await page.getByText('Gasto diario promedio').locator('..').textContent()).includes('1.000'),'promedio histórico usa días transcurridos');
    await nav('movements');
    await page.locator('#movement-search').fill(today);
    check(await page.getByText('Compra de prueba',{exact:true}).isVisible(),'buscar fecha ISO');
    await page.locator('#movement-search').fill('1990-01-01');
    check(await page.getByText('No hay resultados',{exact:true}).isVisible(),'búsqueda sin fecha coincidente');
    await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
    check((await page.evaluate(()=>caches.keys())).includes('saldo-static-v7.1'),'caché v7.1 activa');
    await context.setOffline(true);
    await page.reload();
    const installedIcons = await page.evaluate(async () => {
      const url = document.querySelector('link[rel="manifest"]').href;
      const manifest = await (await fetch(url)).json();
      const apple = document.querySelector('link[rel="apple-touch-icon"]');
      const icons = manifest.icons.map(icon => ({ ...icon, url: new URL(icon.src, url).href }));
      icons.push({ url: apple.href, sizes: apple.sizes.value, purpose: 'apple' });
      for (const icon of icons) {
        const img = new Image();
        img.src = icon.url;
        await img.decode();
        if (icon.sizes !== 'any' && icon.sizes !== img.naturalWidth + 'x' + img.naturalHeight) return false;
      }
      return manifest.id === './' && manifest.start_url === './' && icons.some(icon => icon.purpose === 'maskable');
    });
    check(installedIcons, 'iconos de instalación disponibles sin conexión con el tamaño y la identidad esperados');
    await page.locator('[data-action="guest"]').click();
    check(await page.getByText('3 registros hoy',{exact:true}).isVisible(),'libro disponible sin conexión');
    await page.evaluate(()=>{
      const save = Storage.prototype.setItem;
      window.restoreFixtureStorage = ()=>{Storage.prototype.setItem=save};
      Storage.prototype.setItem=function(key,data) {
        if (key === 'saldo-personal-v1') throw new DOMException('test quota','QuotaExceededError');
        return save.call(this,key,data);
      };
    });
    await page.locator('.topbar [data-action="new-transaction"]').click();
    await page.getByLabel('Valor en pesos').fill('1500');
    await page.getByLabel('Concepto').fill('Compra sin conexión');
    await page.getByRole('button',{name:'Guardar movimiento'}).click();
    check(await page.getByRole('alert').getByText('No se pudo guardar en este dispositivo.').isVisible(),'aviso persistente por cuota');
    const [copy]=await Promise.all([page.waitForEvent('download'),page.getByRole('alert').getByRole('button',{name:'Descargar copia'}).click()]);
    check(copy.suggestedFilename().endsWith('.json'),'copia de rescate disponible');
    await page.evaluate(()=>window.restoreFixtureStorage());
    await page.getByRole('button',{name:'Reintentar guardado'}).click();
    check(await page.getByRole('alert').count()===0,'reintento resuelve aviso');
    await page.reload();
    await page.locator('[data-action="guest"]').click();
    await nav('movements');
    check(await page.getByText('Compra sin conexión',{exact:true}).isVisible(),'reintento conserva movimiento');
    check(errors.length===0,'sin errores de la app');
    console.log(passed+' comprobaciones de cierre correctas.');
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1});
