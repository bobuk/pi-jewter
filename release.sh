#!/usr/bin/env bash
# Release pi-jewter: ./release.sh X.Y.Z [--dry-run]
#
# Checks everything before changing anything, then:
#   1. moves the CHANGELOG.md Unreleased entries under ## [X.Y.Z];
#   2. sets the version in package.json and package-lock.json;
#   3. commits "chore(release): X.Y.Z" and creates the annotated tag vX.Y.Z;
#   4. publishes to npm (dist-tag `next` for pre-releases such as 1.2.3-rc.1);
#   5. pushes main and the tag to origin.
# Publishing happens before pushing, so a failed publish leaves no remote tag.
# --dry-run runs all checks and `npm publish --dry-run` without changing anything.
set -euo pipefail

NPM="${NPM:-npm}"
BRANCH="main"
cd "$(dirname "${BASH_SOURCE[0]}")"

die() { printf 'release: %s\n' "$*" >&2; exit 1; }
step() { printf '\n==> %s\n' "$*"; }
release_ts() { node --no-warnings --experimental-strip-types scripts/release.ts "$@"; }

version="" dry_run=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) dry_run=1 ;;
    -h|--help) sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) die "unknown option $arg" ;;
    *) [[ -z "$version" ]] || die "only one version expected"; version="$arg" ;;
  esac
done
[[ -n "$version" ]] || die "usage: ./release.sh X.Y.Z [--dry-run]"
version="${version#v}"
tag="v$version"

step "Checking repository state"
[[ "$(git rev-parse --abbrev-ref HEAD)" == "$BRANCH" ]] || die "switch to $BRANCH first"
[[ -z "$(git status --porcelain)" ]] || die "working tree is not clean; commit or stash first"
git fetch --quiet --tags origin "$BRANCH"
[[ "$(git rev-parse HEAD)" == "$(git rev-parse "origin/$BRANCH")" ]] || die "$BRANCH differs from origin/$BRANCH; pull or push first"
git rev-parse -q --verify "refs/tags/$tag" >/dev/null && die "tag $tag already exists"
[[ -z "$(git ls-remote --tags origin "refs/tags/$tag")" ]] || die "tag $tag already exists on origin"

step "Checking version, changelog and npm registry"
dist_tag="$(release_ts check "$version")"
echo "$version will be published with dist-tag $dist_tag"

if (( ! dry_run )); then
  npm_user="$("$NPM" whoami 2>/dev/null)" || die "not logged in to npm; run: npm login"
  echo "npm user: $npm_user"
fi

step "Running checks"
"$NPM" ci --ignore-scripts
"$NPM" run check
"$NPM" pack --dry-run

if (( dry_run )); then
  step "Dry run: npm publish --dry-run"
  "$NPM" publish --dry-run --access public --tag "$dist_tag"
  echo
  echo "Dry run passed. Nothing was changed, committed, tagged, published or pushed."
  exit 0
fi

step "Creating release commit and tag $tag"
release_ts changelog "$version"
"$NPM" version "$version" --no-git-tag-version >/dev/null
git add CHANGELOG.md package.json package-lock.json
git commit --quiet -m "chore(release): $version"
git tag -a "$tag" -m "pi-jewter $version"
echo "Committed $(git rev-parse --short HEAD) and tagged $tag (not pushed yet)"

step "Publishing to npm"
if ! "$NPM" publish --access public --tag "$dist_tag"; then
  cat >&2 <<EOF

release: npm publish failed. Nothing was pushed.
  Retry the publish:  npm publish --access public --tag $dist_tag && git push --atomic origin $BRANCH $tag
  Or undo locally:    git tag -d $tag && git reset --hard HEAD~1
EOF
  exit 1
fi

step "Pushing $BRANCH and $tag"
if ! git push --atomic origin "$BRANCH" "$tag"; then
  die "published to npm, but the push failed; retry: git push --atomic origin $BRANCH $tag"
fi

echo
echo "Released pi-jewter $version (npm dist-tag $dist_tag)."
