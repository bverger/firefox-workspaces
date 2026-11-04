#!/bin/sh
# Installs userChrome.css into a Firefox profile and enables the prefs it needs.
# Usage: ./install.sh [profile-dir]   (default: the default profile on macOS)
# Includes the auto-hide rules; they only apply while the extension's
# auto-hide button is on. Restart Firefox afterwards.
set -eu

here=$(cd "$(dirname "$0")" && pwd)
root="$HOME/Library/Application Support/Firefox"

profile=${1:-}
if [ -z "$profile" ]; then
  # The [Install...] section of profiles.ini names the profile this Firefox uses.
  rel=$(awk -F= '/^\[Install/ { s = 1; next } /^\[/ { s = 0 } s && $1 == "Default" { print $2; exit }' "$root/profiles.ini")
  [ -n "$rel" ] || { echo "No default profile found in $root/profiles.ini" >&2; exit 1; }
  profile="$root/$rel"
fi
[ -d "$profile" ] || { echo "Profile not found: $profile" >&2; exit 1; }

built=$(mktemp)
trap 'rm -f "$built"' EXIT
cat "$here/userChrome.css" > "$built"
printf '\n' >> "$built"
cat "$here/autohide-sidebar.css" >> "$built"

mkdir -p "$profile/chrome"
target="$profile/chrome/userChrome.css"
if [ -f "$target" ] && ! cmp -s "$built" "$target" && ! grep -q 'Workspaces extension' "$target"; then
  cp "$target" "$target.bak"
  echo "Existing userChrome.css saved as userChrome.css.bak"
fi
cp "$built" "$target"

# user.js is applied on every start. inTitlebar=0 brings back the native title
# bar, which on macOS holds the window buttons that lived in the tab strip.
userjs="$profile/user.js"
for pref in \
  'user_pref("toolkit.legacyUserProfileCustomizations.stylesheets", true);' \
  'user_pref("browser.tabs.inTitlebar", 0);'
do
  grep -qF "$pref" "$userjs" 2>/dev/null || echo "$pref" >> "$userjs"
done

echo "Installed in $profile. Restart Firefox."
