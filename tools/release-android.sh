#!/usr/bin/env bash
# Veröffentlicht eine neue Jarvis-Android-Version als GitHub-Release (vX.Y-android)
# mit Jarvis.apk + update.json. Signiert mit Schlüsselrotation (APK Signature Scheme v3):
#   v1/v2: alter Debug-Schlüssel (Android < 9), v3 + Lineage: neuer Release-Schlüssel (Android 9+).
#
# Nutzung:
#   tools/release-android.sh 0.3 "Änderungstext" [--min-version-code N] [--dry-run]
#
# Umgebungsvariablen:
#   JARVIS_SIGNING_DIR   Ordner mit keystore.properties, jarvis-release.jks, debug.keystore, jarvis-lineage.bin
#                        (liegt AUSSERHALB des Repos – niemals einchecken!)
#   ANDROID_DIR          Capacitor-Projekt (Standard: <repo>/android)
#   JAVA_HOME, ANDROID_HOME
#
# Versionsregeln: versionCode steigt bei JEDEM Release um 1; versionName X.Y[.Z] muss größer sein als
# der bisherige; das Tag vX.Y[.Z]-android darf noch nicht existieren.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ANDROID_DIR="${ANDROID_DIR:-$REPO_DIR/android}"
SIGN_DIR="${JARVIS_SIGNING_DIR:?JARVIS_SIGNING_DIR setzen (Ordner mit keystore.properties)}"
GH_REPO="Ungeteilte/jarvis"
NAME="${1:?Version angeben, z. B. 0.3}"; shift
CHANGELOG="${1:?Änderungstext angeben}"; shift
MIN_CODE=1; DRY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --min-version-code) MIN_CODE="$2"; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    *) echo "Unbekannte Option: $1" >&2; exit 2 ;;
  esac
done

[[ "$NAME" =~ ^[0-9]{1,4}\.[0-9]{1,4}(\.[0-9]{1,4})?$ ]] || { echo "versionName muss X.Y oder X.Y.Z sein" >&2; exit 2; }
TAG="v${NAME}-android"
PROPS="$SIGN_DIR/keystore.properties"
LINEAGE="$SIGN_DIR/jarvis-lineage.bin"
for f in "$PROPS" "$LINEAGE"; do [ -f "$f" ] || { echo "Fehlt: $f" >&2; exit 1; }; done
prop() { grep -m1 -E "^$1=" "$PROPS" | cut -d= -f2-; }

BT="$(ls -d "$ANDROID_HOME"/build-tools/* | sort -V | tail -1)"
APKSIGNER="$BT/apksigner"; AAPT="$BT/aapt"
GRADLE_FILE="$ANDROID_DIR/android/app/build.gradle"

# ---------- Pflicht-Tests vor jedem Release (vor dem Versions-Bump: bei Fehler bleibt alles unverändert) ----------
echo "Tests: JS-Unit-Tests …"
(cd "$REPO_DIR" && node --test tests/ >/dev/null) || { echo "JS-Unit-Tests fehlgeschlagen – Abbruch" >&2; exit 1; }
echo "Tests: nativer App-Start (native_boot_test, gebautes www) …"
(cd "$ANDROID_DIR" && npm run -s sync-www >/dev/null)
python3 "$REPO_DIR/tools/native_boot_test.py" --www "$ANDROID_DIR/www" >/dev/null \
  || { echo "native_boot_test fehlgeschlagen (Sprachausgabe/Adapter beim App-Start) – Abbruch" >&2; exit 1; }

# ---------- Version erhöhen ----------
OLD_CODE=$(grep -E '^\s*versionCode [0-9]+' "$GRADLE_FILE" | grep -oE '[0-9]+')
OLD_NAME=$(grep -E '^\s*versionName "' "$GRADLE_FILE" | sed -E 's/.*"(.*)".*/\1/')
NEW_CODE=$((OLD_CODE + 1))
if [ "$(printf '%s\n%s\n' "$OLD_NAME" "$NAME" | sort -V | tail -1)" != "$NAME" ] || [ "$OLD_NAME" = "$NAME" ]; then
  echo "versionName $NAME ist nicht größer als $OLD_NAME" >&2; exit 2
fi
if gh release view "$TAG" --repo "$GH_REPO" >/dev/null 2>&1; then echo "Tag $TAG existiert schon" >&2; exit 2; fi
bump() { sed -i -E "s/^(\s*)versionCode [0-9]+/\1versionCode $NEW_CODE/; s/^(\s*)versionName \"[^\"]*\"/\1versionName \"$NAME\"/" "$1"; }
cp "$GRADLE_FILE" "$GRADLE_FILE.bak-release"
restore_on_dry() { [ "$DRY" = 1 ] && [ -f "$GRADLE_FILE.bak-release" ] && mv "$GRADLE_FILE.bak-release" "$GRADLE_FILE"; rm -f "$GRADLE_FILE.bak-release"; }
bump "$GRADLE_FILE"
REPO_GRADLE="$REPO_DIR/android/android/app/build.gradle"
if [ "$DRY" = 0 ] && [ -f "$REPO_GRADLE" ] && [ "$(realpath "$REPO_GRADLE")" != "$(realpath "$GRADLE_FILE")" ]; then bump "$REPO_GRADLE"; fi
echo "Version: $OLD_NAME ($OLD_CODE) → $NAME ($NEW_CODE)"

trap 'restore_on_dry' EXIT
# ---------- Bauen + Tests ----------
cd "$ANDROID_DIR"
npm run -s sync-www
npx cap sync android >/dev/null
cd android
./gradlew -q testDebugUnitTest assembleRelease -PjarvisSigningProps="$PROPS"
OUT_DIR="app/build/outputs/apk/release"
SRC_APK="$OUT_DIR/app-release.apk"; [ -f "$SRC_APK" ] || SRC_APK="$OUT_DIR/app-release-unsigned.apk"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"; restore_on_dry' EXIT
cp "$SRC_APK" "$WORK/in.apk"
"$BT/zipalign" -f -p 4 "$WORK/in.apk" "$WORK/aligned.apk"

# ---------- Signieren mit Rotation ----------
# Passwörter nur über Umgebungsvariablen (nicht in der Prozessliste sichtbar)
export JK_OLD_PASS="$(prop oldStorePassword)" JK_OLD_KEYPASS="$(prop oldKeyPassword)"
export JK_NEW_PASS="$(prop storePassword)" JK_NEW_KEYPASS="$(prop keyPassword)"
"$APKSIGNER" sign \
  --ks "$(prop oldStoreFile)" --ks-key-alias "$(prop oldKeyAlias)" --ks-pass env:JK_OLD_PASS --key-pass env:JK_OLD_KEYPASS \
  --next-signer \
  --ks "$(prop storeFile)" --ks-key-alias "$(prop keyAlias)" --ks-pass env:JK_NEW_PASS --key-pass env:JK_NEW_KEYPASS \
  --lineage "$LINEAGE" --rotation-min-sdk-version 28 \
  --v1-signing-enabled true --v2-signing-enabled true --v3-signing-enabled true \
  --out "$WORK/Jarvis.apk" "$WORK/aligned.apk"
unset JK_OLD_PASS JK_OLD_KEYPASS JK_NEW_PASS JK_NEW_KEYPASS

VERIFY="$("$APKSIGNER" verify --print-certs -v "$WORK/Jarvis.apk")"
echo "$VERIFY" | grep -E "Verified using|Signer #|lineage|Number of signers" | grep -vE "MD5|SHA-1|public key" || true
echo "$VERIFY" | grep -q "Verified using v3 scheme (APK Signature Scheme v3): true" || { echo "v3-Signatur fehlt" >&2; exit 1; }
NEW_CERT=$("$APKSIGNER" lineage --in "$LINEAGE" --print-certs | grep "Signer #2 in lineage certificate SHA-256" | awk '{print $NF}')
OLD_CERT=$("$APKSIGNER" lineage --in "$LINEAGE" --print-certs | grep "Signer #1 in lineage certificate SHA-256" | awk '{print $NF}')
# Android 9+: v3-Signer = neuer Schlüssel
echo "$VERIFY" | grep -qi "certificate SHA-256 digest: $NEW_CERT" || { echo "Neues Zertifikat nicht in der v3-Signatur" >&2; exit 1; }
# Android < 9 (v1/v2): alter Schlüssel
OLDVIEW="$("$APKSIGNER" verify --print-certs --min-sdk-version 23 --max-sdk-version 27 "$WORK/Jarvis.apk")"
echo "$OLDVIEW" | grep -qi "certificate SHA-256 digest: $OLD_CERT" || { echo "Altes Zertifikat (v1/v2) fehlt" >&2; exit 1; }
# Im APK eingebettete Lineage muss beide Zertifikate enthalten (alt → neu)
APK_LINEAGE="$("$APKSIGNER" lineage --in "$WORK/Jarvis.apk" --print-certs)"
echo "$APK_LINEAGE" | grep -E "Signer #[0-9] in lineage certificate (DN|SHA-256)"
echo "$APK_LINEAGE" | grep -q "Signer #1 in lineage certificate SHA-256 digest: $OLD_CERT" &&
echo "$APK_LINEAGE" | grep -q "Signer #2 in lineage certificate SHA-256 digest: $NEW_CERT" || { echo "Lineage im APK unvollständig" >&2; exit 1; }

BADGE="$("$AAPT" dump badging "$WORK/Jarvis.apk" | awk 'NR==1')"
echo "$BADGE" | grep -q "name='com.jarvis.assistant' versionCode='$NEW_CODE' versionName='$NAME'" || { echo "Badging passt nicht: $BADGE" >&2; exit 1; }
SHA=$(sha256sum "$WORK/Jarvis.apk" | awk '{print $1}')

DIST="$ANDROID_DIR/dist/$TAG"; mkdir -p "$DIST"
cp "$WORK/Jarvis.apk" "$DIST/Jarvis.apk"
CHANGELOG="$CHANGELOG" NAME="$NAME" CODE="$NEW_CODE" SHA="$SHA" MIN="$MIN_CODE" CERT="$NEW_CERT" python3 - > "$DIST/update.json" <<'PY'
import json, os
print(json.dumps({
  "versionCode": int(os.environ["CODE"]), "versionName": os.environ["NAME"], "apk": "Jarvis.apk",
  "sha256": os.environ["SHA"], "minVersionCode": int(os.environ["MIN"]),
  "changelog_de": os.environ["CHANGELOG"], "certSha256": os.environ["CERT"]
}, ensure_ascii=False, indent=2))
PY
echo "APK: $DIST/Jarvis.apk  SHA-256: $SHA"
cat "$DIST/update.json"
[ "$DRY" = 1 ] && { echo "Probelauf – nichts veröffentlicht."; exit 0; }

# ---------- Veröffentlichen ----------
gh release create "$TAG" "$DIST/Jarvis.apk" "$DIST/update.json" --repo "$GH_REPO" --target main \
  --title "Jarvis Android $NAME" \
  --notes "$CHANGELOG

SHA-256 (Jarvis.apk): \`$SHA\`
Signaturzertifikat (SHA-256): \`$NEW_CERT\`"

BASE="https://github.com/$GH_REPO/releases/download/$TAG"
for f in Jarvis.apk update.json; do
  code=$(curl -sL -o "$WORK/dl-$f" -w '%{http_code}' "$BASE/$f")
  echo "$code $BASE/$f"; [ "$code" = 200 ] || { echo "Download fehlgeschlagen" >&2; exit 1; }
done
[ "$(sha256sum "$WORK/dl-Jarvis.apk" | awk '{print $1}')" = "$SHA" ] || { echo "Hochgeladene APK weicht ab" >&2; exit 1; }
cmp -s "$WORK/dl-update.json" "$DIST/update.json" || { echo "update.json weicht ab" >&2; exit 1; }
echo "Fertig: https://github.com/$GH_REPO/releases/tag/$TAG"
