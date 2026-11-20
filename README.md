# Saldo

App PWA móvil para registrar ingresos y gastos, fijar presupuestos y consultar reportes en COP. Funciona sin conexión después de la primera carga y guarda los movimientos en el almacenamiento de este dispositivo.

## Instalar en el teléfono

1. Publica el contenido de este repositorio con GitHub Pages usando el workflow incluido.
2. Abre la URL HTTPS de Pages en Safari (iPhone) o Chrome (Android).
3. iPhone: **Compartir → Añadir a pantalla de inicio**. Android: usa **Instalar aplicación** cuando aparezca el aviso del navegador.

GitHub Pages entrega la aplicación web instalable; no crea por sí mismo un paquete IPA/APK ni publica en App Store o Play Store.

## Datos, cuenta y avisos

- En esta primera versión, los datos financieros y el perfil permanecen en el almacenamiento local del navegador. No se transmiten a un servidor y no se sincronizan entre dispositivos.
- El perfil permite personalizar el nombre de saludo; el inicio de sesión y respaldo en la nube requieren conectar un proyecto de autenticación/backend del propietario.
- Los avisos del navegador funcionan tras conceder permiso. Los avisos por exceso de presupuesto se muestran mientras la app está abierta. Los recordatorios recurrentes se comprueban mientras la app está abierta; el navegador puede suspender una PWA cerrada.
- El service worker ya recibe eventos `push`, pero el envío push en segundo plano requiere configurar un servidor de notificaciones y guardar las suscripciones. GitHub Pages solo sirve archivos estáticos.

## Desarrollo local

Sirve esta carpeta desde un servidor local (por ejemplo, `python3 -m http.server 4173`) y abre `http://localhost:4173`. Para publicar, sube el contenido de esta carpeta a la raíz de un repositorio y habilita GitHub Actions en **Settings → Pages → Build and deployment → GitHub Actions**.

## Privacidad

Saldo no se conecta a bancos ni procesa pagos. Usa registro manual de movimientos. Exporta una copia desde **Cuenta** antes de borrar datos del navegador o cambiar de dispositivo.
