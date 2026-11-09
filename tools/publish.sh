#!/usr/bin/env bash
# Mirror the publishable parts of this (private) repository into the public clone.
#
#   tools/publish.sh ../imuninn-public "Python 0.1.0, docs"      # copy + commit in the clone
#   tools/publish.sh ../imuninn-public "…" --push                 # and push its current branch
#   REF=some-branch tools/publish.sh …                            # export another committed ref (default: main)
#
# Exports the COMMITTED tree of $REF (never the working tree, which other sessions may have on
# another branch). Only the paths in ALLOW go out; everything else (and git history) stays here.
# Generated build outputs are excluded. Run gitleaks on the clone afterwards when it is installed.
#
# Every allow-listed path in the clone is REPLACED by $REF's version, so publishing a commit that
# does not contain what was published last would silently roll it back. The script therefore
# refuses unless the previous publish's "Source:" commit is an ancestor of $REF (FORCE=1 overrides,
# e.g. to deliberately revert). Run main's copy, from the repository root:
#   git show main:tools/publish.sh | REPO=. bash -s -- ../imuninn-public "message" [--push]
# (the shared working tree may be on another branch with an older copy of this script).
set -euo pipefail

DEST="${1:?public clone path}"
MSG="${2:-sync from private repository $(date +%F)}"
PUSH="${3:-}"
REF="${REF:-main}"
REPO="$(cd "${REPO:-$(dirname "$0")/..}" && pwd)"   # REPO=. when the script is piped in from `git show`
ROOT="$(mktemp -d)"
trap 'rm -rf "$ROOT"' EXIT
git -C "$REPO" archive --format=tar "$REF" | tar -x -C "$ROOT"
echo "exporting $REF ($(git -C "$REPO" rev-parse --short "$REF")) from $REPO"

ALLOW=(
  README.md README.zh-CN.md LICENSE-MIT LICENSE-APACHE .gitignore .github
  protocol host/python host/cpp host/web tools docs site mobile
)
EXCLUDE=(
  --exclude .git --exclude node_modules --exclude dist --exclude build --exclude .venv --exclude __pycache__
  --exclude .expo --exclude 'mobile/ios' --exclude 'mobile/android/build' --exclude 'host/cpp/gen'
  --exclude 'mobile/modules/muninn-core/ios/Generated' --exclude 'mobile/modules/muninn-core/android/src/main/java/generated'
  --exclude '*.mcap' --exclude '*.rrd' --exclude '*.csv' --exclude '.DS_Store'
  --exclude 'site/src/content/docs' --exclude 'site/public/images'
  # Not public yet (user decision 2026-11-08): the developer and design sections, the agent
  # repo conventions, and the long-run raw data. Design *assets* (tokens, icons) stay: builds need them.
  --exclude 'docs/dev' --exclude 'docs/design/longrun-*' --include 'docs/design/tokens.json' --exclude 'docs/design/*.md' --exclude 'docs/design/*.png' --exclude 'docs/design/*.jpg' --exclude 'docs/design/*.json'
  --exclude 'docs/agents/AGENTS.md' --exclude 'docs/AGENTS.md'
)

[ -d "$DEST/.git" ] || { echo "$DEST is not a git clone (git clone git@github.com:Bardreamaster/imuninn.git $DEST)"; exit 1; }

# Guard: never publish something older than (or diverged from) the last published source.
git -C "$DEST" fetch -q origin 2>/dev/null || true
git -C "$DEST" merge -q --ff-only "origin/$(git -C "$DEST" branch --show-current)" 2>/dev/null || true
LAST=$(git -C "$DEST" log -1 --format=%B 2>/dev/null | sed -n 's/^Source: \([0-9a-f]\{7,40\}\).*/\1/p' | head -1)
if [ -n "$LAST" ] && [ "${FORCE:-0}" != 1 ]; then
  if ! git -C "$REPO" cat-file -e "$LAST^{commit}" 2>/dev/null; then
    echo "last published source $LAST is not in $REPO; refusing (FORCE=1 to override)"; exit 1
  fi
  if ! git -C "$REPO" merge-base --is-ancestor "$LAST" "$REF"; then
    echo "$REF does not contain the last published source $LAST: publishing it would roll back public content."
    echo "Merge $LAST into $REF first, or FORCE=1 to deliberately overwrite."; exit 1
  fi
fi

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
git commit -q -m "$MSG" -m "Source: $(git -C "$REPO" rev-parse "$REF") ($REF)"
git --no-pager show --stat --oneline HEAD | head -40
if command -v gitleaks >/dev/null; then gitleaks detect --no-banner -s . || { echo "gitleaks found something: fix before pushing"; exit 1; }; else echo "(gitleaks not installed: brew install gitleaks)"; fi
if [ "$PUSH" = "--push" ]; then git push -u origin "$(git branch --show-current)"; else echo "review, then: (cd $DEST && git push -u origin $(git branch --show-current))"; fi
