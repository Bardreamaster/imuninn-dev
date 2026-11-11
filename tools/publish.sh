#!/usr/bin/env bash
# Mirror the publishable parts of this (private) repository into the public clone, as a commit on
# a new publish branch. The public repository's main is protected: the branch goes in through a
# pull request, which a person opens and merges on GitHub. This script never creates the PR.
#
#   tools/publish.sh ../imuninn-public "Python 0.1.0, docs"      # copy + commit on publish/<date>-<sha> in the clone
#   tools/publish.sh ../imuninn-public "…" --push                 # and push that branch
#   REF=some-branch tools/publish.sh …                            # export another committed ref (default: main)
#   BRANCH=publish/foo tools/publish.sh …                         # choose the publish branch name
#   BASE=main tools/publish.sh …                                  # public branch the PR will target (default: main)
#
# Exports the COMMITTED tree of $REF (never the working tree, which other sessions may have on
# another branch). Only the paths in ALLOW go out; everything else (and git history) stays here.
# Generated build outputs are excluded. Run gitleaks on the clone afterwards when it is installed.
#
# Every allow-listed path in the clone is REPLACED by $REF's version, so publishing a commit that
# does not contain what was published last would silently roll it back. The script therefore
# refuses unless the newest "Source:" commit in the history of origin/$BASE is an ancestor of $REF
# (FORCE=1 overrides, e.g. to deliberately revert). The publish branch always starts from
# origin/$BASE; the clone's own local branches are not used. Run main's copy, from the repository root:
#   git show main:tools/publish.sh | REPO=. bash -s -- ../imuninn-public "message" [--push]
# (the shared working tree may be on another branch with an older copy of this script).
set -euo pipefail

DEST="${1:?public clone path}"
MSG="${2:-sync from private repository $(date +%F)}"
PUSH="${3:-}"
REF="${REF:-main}"
BASE="${BASE:-main}"
REPO="$(cd "${REPO:-$(dirname "$0")/..}" && pwd)"   # REPO=. when the script is piped in from `git show`
ROOT="$(mktemp -d)"
trap 'rm -rf "$ROOT"' EXIT
git -C "$REPO" archive --format=tar "$REF" | tar -x -C "$ROOT"
BRANCH="${BRANCH:-publish/$(date +%Y%m%d)-$(git -C "$REPO" rev-parse --short "$REF")}"
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
  # App Store screenshots / promo artwork: not public for now (user decision 2026-11-09).
  --exclude 'mobile/store-screenshots'
)

[ -d "$DEST/.git" ] || { echo "$DEST is not a git clone (git clone git@github.com:Bardreamaster/imuninn.git $DEST)"; exit 1; }

# The clone must be clean (it is only a mirror) and know the current public $BASE.
if [ -n "$(git -C "$DEST" status --porcelain)" ]; then
  echo "$DEST has uncommitted changes; clean it first (git -C $DEST status)"; exit 1
fi
git -C "$DEST" fetch -q --prune origin || { echo "cannot fetch origin in $DEST"; exit 1; }
git -C "$DEST" rev-parse -q --verify "origin/$BASE^{commit}" >/dev/null || { echo "origin/$BASE not found in $DEST"; exit 1; }

# Guard: never publish something older than (or diverged from) the last published source. The
# newest "Source:" line in origin/$BASE's history is used, so it is found whether the publish PR
# was squashed, rebased or merged with a merge commit.
LAST=$(git -C "$DEST" log -n 50 --format=%B "origin/$BASE" | awk '$1 == "Source:" && $2 ~ /^[0-9a-f]+$/ && length($2) >= 7 && !found { print $2; found = 1 }')
if [ -n "$LAST" ] && [ "${FORCE:-0}" != 1 ]; then
  if ! git -C "$REPO" cat-file -e "$LAST^{commit}" 2>/dev/null; then
    echo "last published source $LAST is not in $REPO; refusing (FORCE=1 to override)"; exit 1
  fi
  if ! git -C "$REPO" merge-base --is-ancestor "$LAST" "$REF"; then
    echo "$REF does not contain the last published source $LAST: publishing it would roll back public content."
    echo "Merge $LAST into $REF first, or FORCE=1 to deliberately overwrite."; exit 1
  fi
fi

# Work on top of the current public $BASE, detached; the publish branch is created at commit time.
git -C "$DEST" checkout -q --detach "origin/$BASE"

# Remove what we own in the clone, then copy the allow-list fresh so deletions propagate.
for p in "${ALLOW[@]}"; do rm -rf "${DEST:?}/$p"; done
for p in "${ALLOW[@]}"; do
  [ -e "$ROOT/$p" ] || continue
  mkdir -p "$(dirname "$DEST/$p")"
  rsync -a "${EXCLUDE[@]}" "$ROOT/$p" "$(dirname "$DEST/$p")/"
done

cd "$DEST"
git add -A
if git diff --cached --quiet; then echo "nothing to publish: $REF already matches origin/$BASE"; exit 0; fi
# Same content already pushed on this branch (the script was run twice): reuse it, do not re-commit.
if git rev-parse -q --verify "origin/$BRANCH^{tree}" >/dev/null && [ "$(git rev-parse "origin/$BRANCH^{tree}")" = "$(git write-tree)" ]; then
  git checkout -q -f -B "$BRANCH" "origin/$BRANCH"
  echo "origin/$BRANCH already holds this content. Open (or merge) its pull request into $BASE."; exit 0
fi
git checkout -q -B "$BRANCH"
git commit -q -m "$MSG" -m "Source: $(git -C "$REPO" rev-parse "$REF") ($REF)"
git --no-pager show --stat --oneline HEAD | sed -n '1,40p'   # not head: it would close the pipe early and fail the script under pipefail
if command -v gitleaks >/dev/null; then gitleaks detect --no-banner -s . || { echo "gitleaks found something: fix before pushing"; exit 1; }; else echo "(gitleaks not installed: brew install gitleaks)"; fi
if [ "$PUSH" = "--push" ]; then
  git push -u origin "$BRANCH" || { echo "push of $BRANCH failed. If origin already has a different $BRANCH, pick another name with BRANCH=publish/<name>."; exit 1; }
  echo "pushed $BRANCH. Open a pull request from $BRANCH into $BASE on GitHub and merge it,"
  echo "then push the private branches: git push origin main dev"
else
  echo "committed on $BRANCH in $DEST. Review, then: (cd $DEST && git push -u origin $BRANCH)"
  echo "and open a pull request from $BRANCH into $BASE on GitHub."
fi
