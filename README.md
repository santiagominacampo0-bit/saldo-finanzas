# Saldo

Saldo organiza ingresos, gastos, presupuestos y reportes mensuales en pesos colombianos. Es una aplicación web instalable con modo de invitado, cuenta de Supabase y exportaciones CSV y JSON.

## Abrir e instalar

- [Abrir Saldo](https://santiagominacampo0-bit.github.io/saldo-finanzas/).
- Android: en Chrome, abre el menú y elige **Instalar aplicación**. El directorio `android/` también permite compilar un acceso APK que abre el sitio en el navegador del dispositivo.
- iPhone: en Safari, usa **Compartir → Añadir a pantalla de inicio**.

## Cuenta y sincronización

El modo de invitado guarda los datos solo en ese navegador. Para sincronizar, crea tu cuenta, confirma el correo e inicia sesión. Desde **Cuenta**, puedes importar los movimientos de invitado con tu autorización. La aplicación guarda los cambios pendientes de conexión por cuenta, comprueba la versión de la fila al escribir y combina cambios de dispositivos distintos. Si dos dispositivos editan el mismo movimiento a la vez, se conserva la última edición sincronizada.

La app usa una clave publicable. Postgres limita el acceso a las filas mediante RLS. Con la confirmación de correo activa, el proveedor de correo predeterminado de Supabase se limita a los miembros del proyecto. Para registro público y recuperación en otros correos, el titular debe configurar SMTP propio en Supabase. [Documentación de SMTP](https://supabase.com/docs/guides/auth/auth-smtp).

## Operación

1. Aplica las migraciones en `supabase/migrations`, en orden, al proyecto de Supabase. Configura en Auth la URL HTTPS del sitio y sus redirecciones.
2. Para habilitar una cuenta administrativa ya confirmada, el propietario autoriza su UUID en `saldo_private.admins`. El panel requiere TOTP y únicamente devuelve contadores agregados. El primer registro público nunca concede el rol automáticamente.
3. Para push, aplica la migración de Vault, despliega `saldo-notify` con la verificación de usuario y cron que implementa la función, y aplica `supabase/schedule-reminders.sql`. Supabase genera las claves y las conserva cifradas en Vault. La app solicita solo la clave pública al iniciar sesión.
4. En GitHub, configura Pages con **GitHub Actions**. El flujo publica únicamente los archivos de la aplicación.

Con Saldo abierto, los avisos y el recordatorio de la hora de Colombia pueden verse en la app. Para la entrega con Saldo cerrado, se requiere el servicio push, permiso en cada dispositivo y un navegador compatible. En iPhone/iPad, Web Push requiere iOS/iPadOS 16.4 o posterior y añadir Saldo a la pantalla de inicio. [Requisitos de Web Push](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/).

## Desarrollo y pruebas

Usa `python3 -m http.server 4173` en la raíz y abre `http://localhost:4173`.

- `node --test tests/state.test.cjs`.
- `node --disable-warning=ExperimentalWarning supabase/functions/saldo-notify/index.test.mjs`.
- `node tests/browser-flows.cjs` con Playwright y el servidor local activo. Las solicitudes de cuenta se simulan.
- `node tests/mobile-layout.cjs` con Playwright Chromium instalado, o define `CHROME_BIN` para usar Chrome. Las pruebas visuales usan datos ficticios.

Lee la [política de privacidad](./privacy.html) antes de activar la sincronización.
