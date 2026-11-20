#!/usr/bin/env bash
set -euo pipefail

android_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source_dir="$android_dir/src/main"

: "${SALDO_ANDROID_JAR:?Configura SALDO_ANDROID_JAR con android.jar de API 36}"
: "${SALDO_ANDROID_BUILD_TOOLS:?Configura SALDO_ANDROID_BUILD_TOOLS con build-tools 36.0.0}"
: "${SALDO_SIGNING_KEYSTORE:?Configura SALDO_SIGNING_KEYSTORE con la ruta del almacén privado}"
: "${SALDO_SIGNING_PASSWORD_FILE:?Configura SALDO_SIGNING_PASSWORD_FILE con un archivo privado que contenga la contraseña}"

if [[ $# != 1 ]]; then
  printf 'Uso: bash android/build-apk.sh /ruta/Saldo-Android.apk\n' >&2
  exit 2
fi

if [[ -n ${SALDO_JDK_DIR:-} ]]; then
  export PATH="$SALDO_JDK_DIR/bin:$PATH"
fi

output_path="$(realpath -m -- "$1")"
scratch_dir="$(mktemp -d -t saldo-android.XXXXXXXX)"
trap 'rm -r -- "$scratch_dir"' EXIT
mkdir -p "$scratch_dir/res/mipmap-xxxhdpi" "$scratch_dir/gen" "$scratch_dir/classes" "$scratch_dir/dex"
cp -R -- "$source_dir/res/." "$scratch_dir/res/"
cp -- "$android_dir/../icons/icon-512.png" "$scratch_dir/res/mipmap-xxxhdpi/ic_saldo.png"

"$SALDO_ANDROID_BUILD_TOOLS/aapt2" compile --dir "$scratch_dir/res" -o "$scratch_dir/resources.zip"
"$SALDO_ANDROID_BUILD_TOOLS/aapt2" link \
  -I "$SALDO_ANDROID_JAR" \
  --manifest "$source_dir/AndroidManifest.xml" \
  --min-sdk-version 26 --target-sdk-version 36 \
  --java "$scratch_dir/gen" \
  -o "$scratch_dir/unsigned.apk" "$scratch_dir/resources.zip"

app_package="io/github/santiagominacampo0bit/saldo"
javac --release 11 -encoding UTF-8 -cp "$SALDO_ANDROID_JAR" -d "$scratch_dir/classes" \
  "$scratch_dir/gen/$app_package/R.java" "$source_dir/java/$app_package/LauncherActivity.java"
jar --create --file "$scratch_dir/classes.jar" -C "$scratch_dir/classes" .
"$SALDO_ANDROID_BUILD_TOOLS/d8" --lib "$SALDO_ANDROID_JAR" --min-api 26 \
  --output "$scratch_dir/dex" "$scratch_dir/classes.jar"
zip -q -j "$scratch_dir/unsigned.apk" "$scratch_dir/dex/classes.dex"
"$SALDO_ANDROID_BUILD_TOOLS/zipalign" -p 4 "$scratch_dir/unsigned.apk" "$scratch_dir/aligned.apk"

mkdir -p -- "$(dirname -- "$output_path")"
"$SALDO_ANDROID_BUILD_TOOLS/apksigner" sign \
  --ks "$SALDO_SIGNING_KEYSTORE" --ks-key-alias saldo \
  --ks-pass "file:$SALDO_SIGNING_PASSWORD_FILE" \
  --out "$scratch_dir/signed.apk" "$scratch_dir/aligned.apk"
"$SALDO_ANDROID_BUILD_TOOLS/apksigner" verify "$scratch_dir/signed.apk"
install -m 644 -- "$scratch_dir/signed.apk" "$output_path"
printf '%s\n' "$output_path"
