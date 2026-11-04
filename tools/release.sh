#!/bin/sh
# Releases a new version on addons.mozilla.org: bumps the version, submits it
# to the listed channel and tags it in git. After Mozilla's review, Firefox
# updates every installed copy by itself.
#
# Usage: tools/release.sh [patch|minor|major]   (default: patch)
# Needs WEB_EXT_API_KEY and WEB_EXT_API_SECRET in the environment
# (addons.mozilla.org → Tools → Manage API Keys).
set -eu
cd "$(dirname "$0")/.."

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
# Listed versions go through Mozilla's review; this returns once submitted.
npx --yes web-ext@latest sign --channel=listed --artifacts-dir dist

git add manifest.json
git commit -m "Release $version"
git tag "v$version"
git push origin HEAD "v$version"

echo "Submitted $version. Follow the review at https://addons.mozilla.org/developers/addons"
