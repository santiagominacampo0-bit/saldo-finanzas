# Saldo

Saldo organiza ingresos, gastos, presupuestos y reportes mensuales en pesos colombianos. Es una aplicación web instalable con modo de invitado, cuenta de Supabase y exportaciones CSV y JSON.

## Abrir e instalar

- [Abrir Saldo](https://santiagominacampo0-bit.github.io/saldo-finanzas/).
- Android: en Chrome, abre el menú y elige **Instalar aplicación**. El directorio `android/` también permite compilar un acceso APK que abre el sitio en el navegador del dispositivo.
- iPhone: en Safari, usa **Compartir → Añadir a pantalla de inicio**.

## Planificación

- En **Presupuestos → Calendario**, revisa los pagos y cobros en vistas de 7 y 30 días y registra los vencimientos al confirmarlos. Inicio estima cuánto queda después de descontar los pagos pendientes hasta el cierre del mes.
- En **Presupuestos → Recurrentes**, programa un ingreso o gasto semanal, cada dos semanas o mensual. Confirmar una fecha registra un movimiento y avanza la siguiente. El aviso llega alrededor de las 8:00 a. m. en Colombia según la anticipación que elijas, si activaste push en un dispositivo.
- En **Presupuestos → Bolsillos**, añade saldos manuales para efectivo, Nequi o una cuenta. Los movimientos anteriores están en General. Las transferencias mueven dinero entre dos bolsillos y quedan fuera de los totales de ingresos y gastos.
- En **Presupuestos → Metas**, registra el monto objetivo y anota tus aportes. El avance de la meta es independiente del saldo de los bolsillos.

## Movimientos

- Busca por concepto o comercio y combina los filtros de bolsillo, categoría y tipo. **Exportar CSV** incluye los resultados del mes y filtros visibles.
- Saldo reconoce comercios comunes, como «Supermercado» para Alimentación. En **Movimientos → Reglas de categorías**, crea, edita o pausa tus reglas. Por ejemplo, cuando el comercio contiene «Farmacia», sugiere Salud. Saldo también puede usar el concepto si dejas el comercio vacío. Puedes cambiar la categoría antes de guardar.
- Al editar un movimiento, **Duplicar** prepara un borrador con fecha de hoy. Los movimientos nuevos recuerdan el último bolsillo usado en ese dispositivo.

## Cuenta y sincronización

El modo de invitado guarda los datos solo en ese navegador. Para sincronizar, crea tu cuenta, confirma el correo e inicia sesión. Desde **Cuenta**, puedes importar los movimientos de invitado con tu autorización. La aplicación guarda los cambios pendientes de conexión por cuenta, comprueba la versión de la fila al escribir y combina cambios de dispositivos distintos. Si dos dispositivos editan el mismo movimiento a la vez, se conserva la última edición sincronizada.

La app usa una clave publicable. Postgres limita el acceso a las filas mediante RLS. Con la confirmación de correo activa, el proveedor de correo predeterminado de Supabase se limita a los miembros del proyecto. Para registro público y recuperación en otros correos, el titular debe configurar SMTP propio en Supabase. [Documentación de SMTP](https://supabase.com/docs/guides/auth/auth-smtp).

## Operación

1. Aplica las migraciones en `supabase/migrations`, en orden, al proyecto de Supabase. Configura en Auth la URL HTTPS del sitio y sus redirecciones.
2. El proyecto puede reservar el panel para el correo verificado del propietario en `saldo_private.owner_access`. El propietario también puede autorizar un UUID ya confirmado en `saldo_private.admins`. Abre **Cuenta → Panel del dueño** con la misma cuenta. El panel requiere TOTP y únicamente devuelve contadores agregados. La app muestra un QR para escanear desde otro dispositivo y una clave manual si estás usando el mismo teléfono. La sección **Estado de los avisos** muestra cuándo corrió el programador y cuántas entregas aceptó el proveedor o tuvieron fallos.
3. Para push, aplica la migración de Vault, despliega `saldo-notify` con la verificación de usuario y cron que implementa la función, y aplica `supabase/schedule-reminders.sql`. Supabase genera las claves y las conserva cifradas en Vault. La app solicita solo la clave pública al iniciar sesión.
4. En GitHub, configura Pages con **GitHub Actions**. El flujo publica únicamente los archivos de la aplicación.

Con Saldo abierto, los avisos y el recordatorio de la hora de Colombia pueden verse en la app. Para la entrega con Saldo cerrado, se requiere el servicio push, permiso en cada dispositivo y un navegador compatible. En iPhone/iPad, Web Push requiere iOS/iPadOS 16.4 o posterior y añadir Saldo a la pantalla de inicio. [Requisitos de Web Push](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/).

## Desarrollo y pruebas

Usa `python3 -m http.server 4173` en la raíz y abre `http://localhost:4173`.

- `node --test tests/state.test.cjs tests/planning.test.cjs tests/recurrence.test.cjs tests/calendar.test.cjs tests/rules.test.cjs`.
- `node --disable-warning=ExperimentalWarning supabase/functions/saldo-notify/index.test.mjs`.
- `node tests/browser-flows.cjs` con Playwright y el servidor local activo. Las solicitudes de cuenta se simulan.
- `node tests/planning-flows.cjs` y `node tests/quick-flows.cjs` con Playwright y el servidor local activo.
- `node tests/mobile-layout.cjs` con Playwright Chromium instalado, o define `CHROME_BIN` para usar Chrome. Las pruebas visuales usan datos ficticios.

Lee la [política de privacidad](./privacy.html) antes de activar la sincronización.
