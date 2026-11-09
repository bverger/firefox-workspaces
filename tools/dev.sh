#!/bin/sh
# Opens a separate test Firefox with the extension loaded from this folder.
# Usage: tools/dev.sh
#
# - Its own profile (~/.sidespace-dev/profile), kept between runs: import
#   arc-import.json once and it stays there. web-ext uninstalls the temporary
#   add-on on exit, so the keep*OnUninstall prefs stop that from wiping it.
# - Firefox accounts are disabled in it, so a buggy change can never reach the
#   real data that Firefox Sync carries to your other computers.
# - Code changes reload the extension on their own; userChrome changes
#   (userchrome/) are copied in on every run and need a restart of this script.
# - Runs alongside your normal Firefox; closing it doesn't touch that one.
set -eu

repo=$(cd "$(dirname "$0")/.." && pwd)
dev=${SIDESPACE_DEV_DIR:-$HOME/.sidespace-dev}
profile="$dev/profile"
mkdir -p "$profile" "$dev/home"

"$repo/userchrome/install.sh" "$profile" >/dev/null

# web-ext reads ~/Library/Application Support/Firefox/profiles.ini, which macOS
# doesn't let terminal tools open (EPERM); a stand-in HOME avoids it. The npm
# cache stays the real one so web-ext isn't downloaded again on every run.
npm_cache="$HOME/.npm"
cd "$repo"
HOME="$dev/home" npm_config_cache="$npm_cache" exec npx --yes web-ext run \
  --source-dir "$repo" \
  --firefox-profile "$profile" \
  --keep-profile-changes \
  --pref identity.fxaccounts.enabled=false \
  --pref extensions.webextensions.keepStorageOnUninstall=true \
  --pref extensions.webextensions.keepUuidOnUninstall=true \
  --pref browser.shell.checkDefaultBrowser=false \
  "$@"
