#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_DIR="${1:-"$ROOT_DIR/dist"}"
if [[ "$OUTPUT_DIR" != /* ]]; then
  OUTPUT_DIR="$ROOT_DIR/$OUTPUT_DIR"
fi
STAGE_DIR="$OUTPUT_DIR/stage"
MANIFEST_FILE="$ROOT_DIR/manifest.json"

if [[ ! -f "$MANIFEST_FILE" ]]; then
  echo "manifest.json not found at $MANIFEST_FILE" >&2
  exit 1
fi

VERSION="$(sed -nE 's/^[[:space:]]*"version":[[:space:]]*"([^"]+)".*/\1/p' "$MANIFEST_FILE" | head -n 1)"

if [[ -z "$VERSION" ]]; then
  echo "Unable to read extension version from manifest.json" >&2
  exit 1
fi

BASE_NAME="tabmark-bookmark-new-tab-v$VERSION"
ZIP_PATH="$OUTPUT_DIR/$BASE_NAME.zip"
CRX_PATH="$OUTPUT_DIR/$BASE_NAME.crx"
LATEST_ZIP_PATH="$OUTPUT_DIR/tabmark-bookmark-new-tab.zip"
LATEST_CRX_PATH="$OUTPUT_DIR/tabmark-bookmark-new-tab.crx"
DEFAULT_KEY_PATH="$ROOT_DIR/.tmp/extension.pem"
KEY_PATH="${CRX_KEY_PATH:-}"

if [[ -z "$KEY_PATH" && -f "$DEFAULT_KEY_PATH" ]]; then
  KEY_PATH="$DEFAULT_KEY_PATH"
fi

if [[ -z "$KEY_PATH" ]]; then
  for candidate in "$ROOT_DIR"/*.pem; do
    if [[ -f "$candidate" ]]; then
      KEY_PATH="$candidate"
      break
    fi
  done
fi

mkdir -p "$OUTPUT_DIR"
rm -rf "$STAGE_DIR"
rm -f "$ZIP_PATH" "$CRX_PATH" "$LATEST_ZIP_PATH" "$LATEST_CRX_PATH"
mkdir -p "$STAGE_DIR"

rsync -a \
  --exclude '.git/' \
  --exclude '.github/' \
  --exclude '.tmp/' \
  --exclude 'dist/' \
  --exclude 'docs/' \
  --exclude 'node_modules/' \
  --exclude 'scripts/' \
  --exclude 'AGENTS.md' \
  --exclude 'README.md' \
  --exclude 'package.json' \
  --exclude 'package-lock.json' \
  --exclude '*.log' \
  "$ROOT_DIR/" "$STAGE_DIR/"

(
  cd "$STAGE_DIR"
  zip -qr "$ZIP_PATH" .
)
cp "$ZIP_PATH" "$LATEST_ZIP_PATH"

echo "Created $ZIP_PATH"
echo "Created $LATEST_ZIP_PATH"

if [[ -n "$KEY_PATH" && -f "$KEY_PATH" ]]; then
  npx --yes crx3@1.1.3 -p "$KEY_PATH" -o "$CRX_PATH" "$STAGE_DIR"
  cp "$CRX_PATH" "$LATEST_CRX_PATH"
  echo "Created $CRX_PATH"
  echo "Created $LATEST_CRX_PATH"
else
  echo "CRX key not found, skipped .crx packaging"
fi

rm -rf "$STAGE_DIR"
