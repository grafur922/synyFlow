#!/bin/sh

set -eu

ACTION="${1:-list}"
NAME="${2:-xiaomiCloudCookie}"
SERVICE="${TERRA_MACOS_KEYCHAIN_SERVICE:-app.terra-hub.server}"
SECURITY=/usr/bin/security

case "$ACTION" in
  set|remove|list) ;;
  *) printf '%s\n' 'Usage: manage-macos-secrets.sh [set|remove|list] [secret-name]' >&2; exit 2 ;;
esac

is_supported_name() {
  case "$1" in
    xiaomiCloudCookie|dataEncryptionKey|historyEncryptionKey|apiToken) return 0 ;;
    *) return 1 ;;
  esac
}

if [ "$ACTION" != "list" ] && ! is_supported_name "$NAME"; then
  printf '%s\n' 'Unsupported secret name.' >&2
  exit 2
fi

if [ ! -x "$SECURITY" ]; then
  printf '%s\n' 'macOS Keychain command /usr/bin/security is unavailable.' >&2
  exit 1
fi

if [ "$ACTION" = "list" ]; then
  for candidate in xiaomiCloudCookie dataEncryptionKey historyEncryptionKey apiToken; do
    if "$SECURITY" find-generic-password -a "$candidate" -s "$SERVICE" >/dev/null 2>&1; then
      printf '%s\n' "$candidate"
    fi
  done
  exit 0
fi

if [ "$ACTION" = "set" ]; then
  printf 'Enter %s in the macOS Keychain prompt.\n' "$NAME"
  "$SECURITY" add-generic-password -U -a "$NAME" -s "$SERVICE" -w
  printf 'set completed for %s\n' "$NAME"
  exit 0
fi

if "$SECURITY" find-generic-password -a "$NAME" -s "$SERVICE" >/dev/null 2>&1; then
  "$SECURITY" delete-generic-password -a "$NAME" -s "$SERVICE" >/dev/null
fi
printf 'remove completed for %s\n' "$NAME"
