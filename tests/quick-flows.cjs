// Tests run against a guest session with synthetic COP records.
const assert = require('node:assert/strict');
const { chromium } = require(process.env.SALDO_PLAYWRIGHT_MODULE || 'playwright');
const address = process.env.SALDO_QA_URL || 'http://localhost:4173/';
const widths = [{ width: 320, height: 640 }, { width: 390, height: 844 }, { width: 1440, height: 900 }];
const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Bogota', dateStyle: 'short' }).format(new Date());
const later = new Date(Date.parse(today + 'T12:00:00Z') + 10 * 86400000).toISOString().slice(0,10);

async function examine(browser, viewport) {
  const context = await browser.newContext({ viewport, isMobile: viewport.width < 650, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const nav = id => page.locator('.nav-button:visible[data-tab="' + id + '"]').click();
  const dialog = () => page.getByRole('dialog');
  const save = () => dialog().locator('[type=submit]').click();
  const add = () => page.locator('.topbar [data-action="new-transaction"]').click();
  let count = 0;
  const check = (ok, message) => { assert.ok(ok,message); count++; };
  const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
  await context.route('https://odveqruhywtrdajuxcts.supabase.co/**', route => route.abort());
  await page.addInitScript(({today,later}) => {
    localStorage.setItem('saldo-personal-v1', JSON.stringify({
      wallets:{ nequi:{id:'nequi',name:'Nequi',openingBalance:620000}, efectivo:{id:'efectivo',name:'Efectivo',openingBalance:0} },
      transactions:[
        { id:'a', type:'expense', title:'Sin receta', merchant:'Droguería', category:'Salud', amount:10000, date:today, walletId:'nequi' },
        { id:'b', type:'expense', title:'Compra local', category:'Alimentación', amount:10000, date:today, walletId:'efectivo' },
      ],
      recurring:{
        inmediato:{id:'inmediato',title:'Pago de hoy',type:'expense',category:'Hogar',amount:200000,nextDue:today,frequency:'monthly',active:true,leadDays:1},
        lejano:{id:'lejano',title:'Próximo cobro',type:'income',category:'Salario',amount:400000,nextDue:later,frequency:'monthly',active:true,leadDays:1},
      }
    }));
  },{today,later});
  try {
    await page.goto(address);
    await page.locator('[data-action="guest"]').click();
    check((await page.locator('[data-forecast="registered"]').textContent()).includes('600.000'),'saldo registrado incluye saldos iniciales');
    check((await page.locator('[data-forecast="pending"]').textContent()).includes('200.000'),'pagos pendientes excluyen ingresos futuros');
    check((await page.locator('[data-forecast="available"]').textContent()).includes('400.000'),'estimación resta solo pagos pendientes');
    await page.getByRole('button',{name:'Ver calendario'}).click();
    check(await page.getByText('Próximo cobro',{exact:true}).count() === 0,'cobro fuera de siete días');
    check(await page.getByText('Pago de hoy',{exact:true}).isVisible(),'vencimiento de hoy visible');
    await page.getByRole('button',{name:'30 días'}).click();
    check(await page.getByText('Próximo cobro',{exact:true}).isVisible(),'rango de 30 días incluye cobro');
    check(await fits(),'calendario cabe en el ancho');
    page.once('dialog',d=>d.accept());
    await page.locator('.calendar-row').filter({hasText:'Pago de hoy'}).getByRole('button',{name:'Registrar pago'}).click();
    check(await page.locator('.calendar-row').filter({hasText:'Pago de hoy'}).getByText('Registrado',{exact:true}).isVisible(),'el pago confirmado aparece como registrado');

    await nav('movements');
    await page.locator('#filter-wallet').selectOption('nequi');
    check(await page.getByText('Sin receta',{exact:true}).isVisible(),'filtro muestra movimiento de Nequi');
    check(await page.getByText('Compra local',{exact:true}).count()===0,'filtro excluye Efectivo');
    await page.locator('#filter-category').selectOption('Salud');
    await page.locator('#movement-search').fill('drogueria');
    check(await page.getByText('Sin receta',{exact:true}).isVisible(),'busca comercio sin tildes junto a filtros');
    const [csv]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'Exportar CSV'}).click()]);
    const stream=await csv.createReadStream(); let data=''; for await(const chunk of stream) data+=chunk.toString('utf8');
    check(data.includes('Comercio')&&data.includes('Bolsillo')&&data.includes('Sin receta')&&!data.includes('Compra local'),'CSV respeta filtros y contiene comercio y bolsillo');
    await page.getByRole('button',{name:'Limpiar filtros'}).click();
    check(await page.getByText('Compra local',{exact:true}).isVisible(),'limpiar filtros restaura lista');
    await page.getByRole('button',{name:'Reglas de categorías'}).click();
    await page.getByRole('button',{name:'Nueva regla'}).click();
    await dialog().getByLabel('Comercio o texto del concepto').fill('Farmacia');
    await dialog().getByLabel('Categoría',{exact:true}).selectOption('Salud');
    await save();
    check(await page.getByText('Farmacia → Salud',{exact:true}).isVisible(),'guarda regla personalizada');
    await add();
    await dialog().getByLabel('Concepto').fill('Compra mensual');
    await dialog().getByLabel('Comercio (opcional)').fill('Supermercado Bogotá');
    check(await dialog().getByLabel('Categoría',{exact:true}).inputValue()==='Alimentación','regla incorporada clasifica Supermercado');
    await dialog().getByLabel('Comercio (opcional)').fill('Farmacia Centro');
    check(await dialog().getByLabel('Categoría',{exact:true}).inputValue()==='Salud','regla propia clasifica Farmacia');
    await dialog().getByLabel('Categoría',{exact:true}).selectOption('Otros gastos');
    await dialog().getByLabel('Comercio (opcional)').fill('Farmacia Norte');
    check(await dialog().getByLabel('Categoría',{exact:true}).inputValue()==='Otros gastos','elección manual se respeta');
    await dialog().getByLabel('Bolsillo',{exact:true}).selectOption('nequi');
    await dialog().getByLabel('Valor en pesos').fill('7000');
    await save();
    await nav('movements');
    await page.getByRole('button',{name:'Editar Compra mensual'}).click();
    await dialog().getByRole('button',{name:'Duplicar',exact:true}).click();
    check(await dialog().getByRole('heading',{name:'Duplicar movimiento'}).isVisible(),'duplicar abre un borrador');
    check(await dialog().getByLabel('Comercio (opcional)').inputValue()==='Farmacia Norte','duplicado conserva comercio');
    check(await dialog().getByLabel('Fecha',{exact:true}).inputValue()===today,'duplicado usa fecha de hoy');
    await save();
    check(await page.getByText('Compra mensual',{exact:true}).count()===2,'duplicar crea un segundo movimiento');
    await add();
    check(await dialog().getByLabel('Bolsillo',{exact:true}).inputValue()==='nequi','recuerda bolsillo anterior');
    await dialog().getByRole('button',{name:'Cancelar'}).click();
    check(await fits(),'movimientos y filtros caben en pantalla');
    check(errors.length===0,'no hay errores JavaScript');
    return count;
  } finally { await context.close(); }
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN });
  try {
    let total = 0;
    for (const viewport of widths) {
      const tested = await examine(browser,viewport);
      total += tested;
      console.log(viewport.width + '×' + viewport.height + ': ' + tested + ' pruebas de calendario, filtros y reglas');
    }
    console.log(total + ' comprobaciones de registro rápido correctas');
  } finally { await browser.close(); }
})().catch(error=>{ console.error(error);process.exitCode=1; });
