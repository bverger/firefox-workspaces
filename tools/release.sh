#!/bin/sh
# Releases a new version: bumps the version, signs it on AMO (unlisted),
# publishes the .xpi as a GitHub release and adds it to updates.json, so every
# installed copy updates itself within a day.
#
# Usage: tools/release.sh [patch|minor|major]   (default: patch)
# Needs WEB_EXT_API_KEY and WEB_EXT_API_SECRET in the environment
# (addons.mozilla.org → Tools → Manage API Keys).
set -eu
cd "$(dirname "$0")/.."

REPO=bverger/firefox-workspaces
: "${WEB_EXT_API_KEY:?Set WEB_EXT_API_KEY (AMO → Tools → Manage API Keys)}"
: "${WEB_EXT_API_SECRET:?Set WEB_EXT_API_SECRET (AMO → Tools → Manage API Keys)}"

if [ -n "$(git status --porcelain)" ]; then
  echo "Commit or stash your changes first." >&2
  exit 1
fi

version=$(python3 - "${1:-patch}" <<'EOF'
import json, re, sys
part = sys.argv[1]
text = open('manifest.json', encoding='utf-8').read()
major, minor, patch = map(int, json.loads(text)['version'].split('.'))
major, minor, patch = {
    'major': (major + 1, 0, 0),
    'minor': (major, minor + 1, 0),
    'patch': (major, minor, patch + 1),
}[part]
version = f'{major}.{minor}.{patch}'
text = re.sub(r'"version": "[^"]+"', f'"version": "{version}"', text, count=1)
open('manifest.json', 'w', encoding='utf-8').write(text)
print(version)
EOF
)
echo "Releasing $version"

npx --yes web-ext@latest lint
rm -rf dist
# Uploads to AMO, waits for the signature and downloads the signed .xpi.
npx --yes web-ext@latest sign --channel=unlisted --artifacts-dir dist
xpi=$(ls dist/*.xpi)

git add manifest.json
git commit -m "Release $version"
git push origin HEAD
gh release create "v$version" "$xpi" --repo "$REPO" --target "$(git rev-parse HEAD)" \
  --title "$version" --notes "Signed build of $version."

# Only point installed copies at the new version once the .xpi is downloadable.
link="https://github.com/$REPO/releases/download/v$version/$(basename "$xpi")"
python3 - "$version" "$link" <<'EOF'
import json, sys
version, link = sys.argv[1:]
data = json.load(open('updates.json', encoding='utf-8'))
updates = data['addons']['workspaces@tomeuverger']['updates']
updates.append({'version': version, 'update_link': link})
with open('updates.json', 'w', encoding='utf-8') as f:
    json.dump(data, f, indent=2)
    f.write('\n')
EOF
git add updates.json
git commit -m "Publish update $version"
git push origin HEAD

echo "Done: $xpi"
echo "Installed copies will pick it up on their next update check (about:addons → ⚙️ → Check for Updates to force it)."
