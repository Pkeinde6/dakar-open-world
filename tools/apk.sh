#!/usr/bin/env bash
# APK Android de Teranga (le site, game.js) emballe avec Capacitor 7 : tout Dakar dedans, jouable hors ligne.
# Signe avec la cle de publication (%USERPROFILE%/.teranga/keystore.properties, hors du depot) quand elle existe :
# meme signature a chaque version, les mises a jour s'installent par-dessus. Sinon : APK debug.
# Prerequis : Node, le SDK Android (celui de Godot : %LOCALAPPDATA%/Android/Sdk), un JDK 17 a 24.
# usage : bash tools/apk.sh [dossier-de-travail]   ->   <dossier>/Teranga.apk
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
B="${1:-$ROOT/../teranga-apk}"
KEYS="${TERANGA_KEYS:-$USERPROFILE/.teranga/keystore.properties}"
SDK="${ANDROID_HOME:-$LOCALAPPDATA/Android/Sdk}"
JAVA_HOME="${JAVA_HOME:-C:/Program Files/Java/jdk-24}"; export JAVA_HOME

cd "$ROOT" && [ -d node_modules/three ] || npm i --no-save three@0.160.0
node tools/app_www.mjs
mkdir -p "$B" && cd "$B"
[ -f package.json ] || { npm init -y > /dev/null; npm i @capacitor/core@7 @capacitor/cli@7 @capacitor/android@7 --no-audit --no-fund; }
rm -rf www && cp -r "$ROOT/www" www
if [ ! -d android ]; then
  npx cap init "Teranga" com.rangu.teranga --web-dir www
  npx cap add android
  A=android
  sed -i 's/gradle-8.11.1-all.zip/gradle-8.14.3-all.zip/' $A/gradle/wrapper/gradle-wrapper.properties   # Gradle 8.14 tourne avec Java 24
  echo "sdk.dir=$(echo "$SDK" | sed 's/\\/\//g')" > $A/local.properties   # barres obliques : dans un .properties, \ est un echappement
  sed -i 's/org.gradle.jvmargs=.*/org.gradle.jvmargs=-Xmx3g -Dfile.encoding=UTF-8/' $A/gradle.properties
  sed -i 's/android:name=".MainActivity"/android:name=".MainActivity"\n            android:screenOrientation="sensorLandscape"/' $A/app/src/main/AndroidManifest.xml
  sed -i 's/versionName "1.0"/versionName "0.2.0"/' $A/app/build.gradle
  rm -rf $A/app/src/main/res/mipmap-anydpi-v26
  python - "$ROOT/icones/teranga-1024.png" $A/app/src/main/res <<'PY'
import os, sys
from PIL import Image
im = Image.open(sys.argv[1]).convert('RGB')
for d, s in {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}.items():
    for n in os.listdir(f'{sys.argv[2]}/mipmap-{d}'):
        if n.endswith('.png'): im.resize((s, s), Image.LANCZOS).save(f'{sys.argv[2]}/mipmap-{d}/{n}')
PY
  cat > "$(find $A/app/src/main/java -name MainActivity.java)" <<'JAVA'
package com.rangu.teranga;

import android.os.Bundle;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

// Teranga : plein ecran, barres du systeme cachees (un glissement les fait revenir un instant)
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        hideSystemBars();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemBars();
    }

    private void hideSystemBars() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        WindowInsetsControllerCompat c = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        c.hide(WindowInsetsCompat.Type.systemBars());
        c.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
    }
}
JAVA
  if [ -f "$KEYS" ]; then # signature de publication lue dans le fichier de cles (jamais dans le depot)
    K="$(echo "$KEYS" | sed 's/\\/\//g')"
    sed -i "s|    buildTypes {|    signingConfigs {\n        release {\n            def p = new Properties(); file('$K').withInputStream { p.load(it) }\n            storeFile file(p.storeFile); storePassword p.storePassword; keyAlias p.keyAlias; keyPassword p.keyPassword\n        }\n    }\n    buildTypes {|" $A/app/build.gradle
    sed -i "s|minifyEnabled false|minifyEnabled false\n            signingConfig signingConfigs.release|" $A/app/build.gradle
  fi
fi
npx cap sync android
if [ -f "$KEYS" ]; then T=assembleRelease; OUT=android/app/build/outputs/apk/release/app-release.apk; else T=assembleDebug; OUT=android/app/build/outputs/apk/debug/app-debug.apk; fi
(cd android && ./gradlew $T --no-daemon -q)
cp "$OUT" "$B/Teranga.apk"
echo "APK : $B/Teranga.apk"
