#!/bin/sh
# Releases a new version: bumps the version in manifest.json, commits, tags
# and pushes. Pushing the vX.Y.Z tag makes GitHub Actions
# (.github/workflows/publish.yml) submit it to addons.mozilla.org; after
# Mozilla's review, Firefox updates every installed copy by itself.
#
# Usage: tools/release.sh [patch|minor|major]   (default: patch)
set -eu
cd "$(dirname "$0")/.."

REPO=bverger/firefox-workspaces

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

# Fail here rather than in CI.
npx --yes web-ext@10.8.0 lint

git add manifest.json
git commit -m "Release $version"
git tag "v$version"
git push origin HEAD "v$version"

echo "Pushed v$version. GitHub Actions submits it to AMO:"
echo "  https://github.com/$REPO/actions"
echo "Then follow the review at https://addons.mozilla.org/developers/addons"
