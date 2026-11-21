# Saldo para Android

El APK añade un acceso a Saldo en el menú de aplicaciones de Android. Abre el sitio oficial en una pestaña del navegador del dispositivo, con las cookies, los datos y los permisos web del navegador. Las actualizaciones del sitio se reciben desde GitHub Pages. Los avisos requieren que el navegador admita Web Push y que los permitas en Saldo.

Para usar Saldo a pantalla completa, abre [la app](https://santiagominacampo0-bit.github.io/saldo-finanzas/) en Chrome y selecciona **Instalar aplicación** o **Añadir a pantalla de inicio** en su menú.

## Compilación

Se necesitan JDK 17 o superior, `zip`, Android SDK Platform 36 y Android SDK Build Tools 36.0.0. Usa un almacén de claves privado con el alias `saldo`. Guarda la contraseña de firma en un archivo privado, en la primera línea. Conserva el mismo almacén y alias para firmar las actualizaciones de este APK.

```bash
export SALDO_ANDROID_JAR=/ruta/al/sdk/platforms/android-36/android.jar
export SALDO_ANDROID_BUILD_TOOLS=/ruta/al/sdk/build-tools/36.0.0
export SALDO_SIGNING_KEYSTORE=/ruta/privada/saldo-android.p12
export SALDO_SIGNING_PASSWORD_FILE=/ruta/privada/saldo-android-pass.txt
bash android/build-apk.sh /ruta/Saldo-Android.apk
```

Si el JDK no está en `PATH`, define `SALDO_JDK_DIR` con la ruta de su carpeta. El script empaqueta las capas del icono exterior desde `icons/`, firma el APK y comprueba la firma. Android adapta la silueta al lanzador. Desde Android 13, los lanzadores compatibles también pueden aplicar al icono los colores del teléfono. La app requiere Android 8 o superior y un navegador con el que abrir el sitio.
