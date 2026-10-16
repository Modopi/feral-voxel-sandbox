#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
FERAL_SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-../toolchain/sdk}}"
if [[ -d "$FERAL_SDK/build-tools" ]]; then
 FERAL_BT="$(find "$FERAL_SDK/build-tools" -mindepth 1 -maxdepth 1 -type d | sort -V | tail -1)"
else
 FERAL_BT="$FERAL_SDK/android-15"
fi
if [[ -f "$FERAL_SDK/platforms/android-35/android.jar" ]]; then
 FERAL_JAR="$FERAL_SDK/platforms/android-35/android.jar"
else
 FERAL_JAR="$FERAL_SDK/android-35/android.jar"
fi
if [[ ! -x "$FERAL_BT/aapt2" || ! -f "$FERAL_JAR" ]]; then
 echo 'Android SDK 35 / Build Tools 35.0.0 required. Set ANDROID_HOME.' >&2
 exit 1
fi
mkdir -p build/classes build/dex signing
"$FERAL_BT/aapt2" compile --dir app/src/main/res -o build/resources.zip
"$FERAL_BT/aapt2" link -o build/base.apk -I "$FERAL_JAR" --manifest app/src/main/AndroidManifest.xml -R build/resources.zip -A app/src/main/assets --auto-add-overlay
java com.sun.tools.javac.Main -source 8 -target 8 -Xlint:-options -encoding UTF-8 -classpath "$FERAL_JAR" -d build/classes app/src/main/java/com/kgb/feral/MainActivity.java
FERAL_CLASSES=()
while IFS= read -r FERAL_CLASS; do FERAL_CLASSES+=("$FERAL_CLASS"); done < <(find build/classes -name '*.class' -type f)
"$FERAL_BT/d8" --lib "$FERAL_JAR" --min-api 26 --output build/dex "${FERAL_CLASSES[@]}"
python3 - <<'PY'
import zipfile, shutil
shutil.copyfile('build/base.apk','build/unsigned.apk')
with zipfile.ZipFile('build/unsigned.apk','a',compression=zipfile.ZIP_DEFLATED) as z:
    z.write('build/dex/classes.dex','classes.dex')
PY
if [[ ! -f signing/prototype.keystore ]]; then
 keytool -genkeypair -keystore signing/prototype.keystore -alias feral -keyalg RSA -keysize 2048 -validity 10000 -storepass android -keypass android -dname 'CN=FERAL Prototype,O=KGB,C=KR'
fi
"$FERAL_BT/zipalign" -f -p 4 build/unsigned.apk build/aligned.apk
"$FERAL_BT/apksigner" sign --ks signing/prototype.keystore --ks-key-alias feral --ks-pass pass:android --key-pass pass:android --out build/Feral-0.1-android.apk build/aligned.apk
"$FERAL_BT/apksigner" verify --verbose build/Feral-0.1-android.apk
"$FERAL_BT/zipalign" -c -p 4 build/Feral-0.1-android.apk
printf 'APK ready: %s/build/Feral-0.1-android.apk\n' "$PWD"
