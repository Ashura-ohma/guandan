#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
# Standard Android SDK tools, or equivalent official AOSP/Debian tools.
: "${AAPT:=aapt}" "${ZIPALIGN:=zipalign}" "${JAVA:=java}"
: "${ANDROID_JAR:?Set ANDROID_JAR to the Android SDK platform android.jar}"
: "${FRAMEWORK_RES:=$ANDROID_JAR}"
: "${D8_JAR:?Set D8_JAR to r8.jar or d8.jar}"
: "${APKSIGNER_JAR:?Set APKSIGNER_JAR to apksigner.jar}"
: "${SIGNING_KEYSTORE:?Set SIGNING_KEYSTORE to a private signing key outside the repository}"
: "${SIGNING_PASSWORD_FILE:?Set SIGNING_PASSWORD_FILE to a private password file}"
rm -rf build/classes build/dex
mkdir -p build/classes build/dex
exec > >(tee build/verification.txt) 2>&1
python3 prepare-assets.py
"$AAPT" package -f -M AndroidManifest.xml -S res -A build/assets -I "$FRAMEWORK_RES" -F build/unsigned.apk
"$JAVA" com.sun.tools.javac.Main -source 8 -target 8 -classpath "$ANDROID_JAR" -d build/classes src/io/neonguandan/game/MainActivity.java
mapfile -t CLASSES < <(find build/classes -name '*.class')
"$JAVA" -cp "$D8_JAR" com.android.tools.r8.D8 --min-api 26 --lib "$ANDROID_JAR" --output build/dex "${CLASSES[@]}"
(cd build/dex && zip -q -u ../unsigned.apk classes.dex)
"$ZIPALIGN" -f 4 build/unsigned.apk build/aligned.apk
"$JAVA" -jar "$APKSIGNER_JAR" sign --ks "$SIGNING_KEYSTORE" --ks-pass "file:$SIGNING_PASSWORD_FILE" --out build/guandan-1.0.0.apk build/aligned.apk
"$JAVA" -jar "$APKSIGNER_JAR" verify --verbose --print-certs build/guandan-1.0.0.apk
"$ZIPALIGN" -c 4 build/guandan-1.0.0.apk
"$AAPT" dump badging build/guandan-1.0.0.apk
python3 verify-package.py
unzip -t build/guandan-1.0.0.apk | tail -1
sha256sum build/guandan-1.0.0.apk > build/guandan-1.0.0.apk.sha256
