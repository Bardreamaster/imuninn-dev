#!/usr/bin/env bash
# Mirror the publishable parts of this (private) repository into the public clone.
#
#   tools/publish.sh ../imuninn-public "Python 0.1.0, docs"      # copy + commit in the clone
#   tools/publish.sh ../imuninn-public "…" --push                 # and push its current branch
#
# Only the paths in ALLOW go out; everything else (and git history) stays here. Generated
# build outputs are excluded. Run gitleaks on the clone afterwards when it is installed.
set -euo pipefail

DEST="${1:?public clone path}"
MSG="${2:-sync from private repository $(date +%F)}"
PUSH="${3:-}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

ALLOW=(
  README.md LICENSE-MIT LICENSE-APACHE .gitignore .github
  protocol host/python host/cpp host/web tools docs site mobile
)
EXCLUDE=(
  --exclude .git --exclude node_modules --exclude dist --exclude build --exclude .venv --exclude __pycache__
  --exclude .expo --exclude 'mobile/ios' --exclude 'mobile/android/build' --exclude 'host/cpp/gen'
  --exclude 'mobile/modules/muninn-core/ios/Generated' --exclude 'mobile/modules/muninn-core/android/src/main/java/generated'
  --exclude '*.mcap' --exclude '*.rrd' --exclude '*.csv' --exclude '.DS_Store'
  --exclude 'docs/design/longrun-*/*.json' --exclude 'docs/design/longrun-*/*.csv' --exclude 'docs/design/longrun-*/*.png'
  --exclude 'site/src/content/docs' --exclude 'site/public/images'
)

[ -d "$DEST/.git" ] || { echo "$DEST is not a git clone (git clone git@github.com:Bardreamaster/imuninn.git $DEST)"; exit 1; }

# Remove what we own in the clone, then copy the allow-list fresh so deletions propagate.
for p in "${ALLOW[@]}"; do rm -rf "${DEST:?}/$p"; done
for p in "${ALLOW[@]}"; do
  [ -e "$ROOT/$p" ] || continue
  mkdir -p "$(dirname "$DEST/$p")"
  rsync -a "${EXCLUDE[@]}" "$ROOT/$p" "$(dirname "$DEST/$p")/"
done

cd "$DEST"
git add -A
if git diff --cached --quiet; then echo "nothing to publish"; exit 0; fi
git commit -q -m "$MSG"
git --no-pager show --stat --oneline HEAD | head -40
if command -v gitleaks >/dev/null; then gitleaks detect --no-banner -s . || { echo "gitleaks found something: fix before pushing"; exit 1; }; else echo "(gitleaks not installed: brew install gitleaks)"; fi
if [ "$PUSH" = "--push" ]; then git push -u origin "$(git branch --show-current)"; else echo "review, then: (cd $DEST && git push -u origin $(git branch --show-current))"; fi
