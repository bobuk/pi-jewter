#!/usr/bin/env bash
# Release pi-jewter: ./release.sh [X.Y.Z] [--dry-run]
#
# Run it in a terminal. It is interactive and safe to re-run: every step checks
# what is already done and continues from there.
#   1. Checks: branch main, clean tree, nothing on origin you don't have.
#   2. Logs you in to npm and GitHub if needed (browser/OTP prompts appear here).
#   3. Fills CHANGELOG Unreleased from commits if it is empty (opens $EDITOR).
#   4. Runs the test suite, shows what will be released and asks to confirm.
#   5. Commits "chore(release): X.Y.Z" and tags vX.Y.Z (everything committed goes in).
#   6. Publishes to npm (dist-tag `next` for pre-releases such as 1.2.3-rc.1).
#   7. Pushes main and the tag, then creates the GitHub Release.
# Without X.Y.Z it suggests the next patch version, or resumes an unfinished release.
# --dry-run checks everything and runs `npm publish --dry-run`; files are restored.
set -euo pipefail

NPM="${NPM:-npm}"
BRANCH="main"
REMOTE="origin"
cd "$(dirname "${BASH_SOURCE[0]}")"

bold=$'\e[1m' red=$'\e[31m' green=$'\e[32m' yellow=$'\e[33m' reset=$'\e[0m'
[[ -t 1 ]] || bold="" red="" green="" yellow="" reset=""
die() { printf '%srelease: %s%s\n' "$red" "$*" "$reset" >&2; exit 1; }
step() { printf '\n%s==> %s%s\n' "$bold" "$*" "$reset"; }
ok() { printf '%s✓ %s%s\n' "$green" "$*" "$reset"; }
warn() { printf '%s! %s%s\n' "$yellow" "$*" "$reset"; }
release_ts() { node --no-warnings --experimental-strip-types scripts/release.ts "$@"; }
ask() { local reply; read -r -p "$1 " reply </dev/tty || reply=""; printf '%s' "$reply"; }
# confirm "question" [y|n]: default answer when Enter is pressed.
confirm() {
  local default="${2:-n}" hint="[y/N]" reply
  [[ "$default" == y ]] && hint="[Y/n]"
  reply="$(ask "$1 $hint")"
  reply="${reply:-$default}"
  [[ "$reply" =~ ^[YyДд] ]]
}

version="" dry_run=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) dry_run=1 ;;
    -h|--help) sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) die "unknown option $arg" ;;
    *) [[ -z "$version" ]] || die "only one version expected"; version="${arg#v}" ;;
  esac
done

if (( ! dry_run )); then
  [[ -t 0 && -t 1 ]] || die "run this in an interactive terminal (it may ask for npm/GitHub login and confirmation)"
fi
for tool in git node "$NPM"; do command -v "$tool" >/dev/null || die "$tool is not installed"; done
if (( ! dry_run )); then command -v gh >/dev/null || die "GitHub CLI (gh) is not installed: brew install gh"; fi

# ---------------------------------------------------------------- repository
step "Checking the repository"
[[ "$(git rev-parse --abbrev-ref HEAD)" == "$BRANCH" ]] || die "switch to $BRANCH first: git switch $BRANCH"
[[ -z "$(git status --porcelain)" ]] || { git status --short; die "uncommitted changes; commit them (they will be released) or stash them"; }
git fetch --quiet "$REMOTE" "$BRANCH" || die "cannot fetch $REMOTE/$BRANCH"
remote_head="$(git rev-parse "$REMOTE/$BRANCH")"
git merge-base --is-ancestor "$remote_head" HEAD || die "$REMOTE/$BRANCH has commits you don't have; run: git pull --rebase"
ok "on $BRANCH, clean, not behind $REMOTE"

remote_tag_sha() { git ls-remote "$REMOTE" "refs/tags/$1" | awk '{print $1}'; }
pkg_version() { node -p "require('./package.json').version"; }

# Resume when HEAD is an existing release commit+tag.
resume=0
head_tag="$(git tag --points-at HEAD --list 'v[0-9]*' | head -n1)"
if [[ -n "$head_tag" && "$(git log -1 --format=%s)" == "chore(release): ${head_tag#v}" ]]; then
  [[ -z "$version" || "$version" == "${head_tag#v}" ]] || die "HEAD is already release ${head_tag#v}; you asked for $version"
  version="${head_tag#v}"
  resume=1
  [[ "$(pkg_version)" == "$version" ]] || die "package.json at $head_tag is not $version"
  ok "resuming unfinished release $version (commit and tag already exist)"
fi

if [[ -z "$version" ]]; then
  suggested="$(release_ts next)"
  if (( dry_run )); then version="$suggested"; else
    version="$(ask "Version to release [$suggested]:")"
    version="${version:-$suggested}"; version="${version#v}"
  fi
fi
tag="v$version"
dist_tag="$(release_ts disttag "$version")"

if (( ! resume )); then
  git rev-parse -q --verify "refs/tags/$tag" >/dev/null && die "tag $tag already exists locally but is not HEAD; delete it (git tag -d $tag) or choose another version"
  [[ -z "$(remote_tag_sha "$tag")" ]] || die "tag $tag already exists on $REMOTE; choose another version"
fi

# ---------------------------------------------------------------- accounts
if (( ! dry_run )); then
  step "Checking npm and GitHub logins"
  until npm_user="$("$NPM" whoami 2>/dev/null)"; do
    warn "not logged in to npm; starting npm login"
    "$NPM" login || confirm "npm login failed. Try again?" y || die "not logged in to npm"
  done
  ok "npm: $npm_user"
  until gh auth status --hostname github.com >/dev/null 2>&1; do
    warn "not logged in to GitHub CLI; starting gh auth login"
    gh auth login --hostname github.com --web || confirm "gh login failed. Try again?" y || die "not logged in to GitHub"
  done
  ok "GitHub: $(gh api user --jq .login)"
fi

# ---------------------------------------------------------------- changelog
release_files=(CHANGELOG.md package.json package-lock.json)
restore_files() { git checkout --quiet -- "${release_files[@]}" 2>/dev/null || true; }

if (( ! resume )); then
  trap restore_files EXIT   # until the release commit exists, any exit restores the files
  step "Preparing the changelog"
  if [[ -z "$(release_ts unreleased)" ]]; then
    last_tag="$(git describe --tags --abbrev=0 --match 'v[0-9]*' 2>/dev/null || true)"
    draft="$(git log --no-merges --format='- %s' ${last_tag:+"$last_tag"..HEAD} | grep -v '^- chore(release):' || true)"
    [[ -n "$draft" ]] || die "no commits since ${last_tag:-the beginning}; nothing to release"
    printf '%s\n' "$draft" | release_ts fill
    if (( dry_run )); then
      warn "Unreleased was empty; using a draft from commit subjects"
    else
      warn "CHANGELOG Unreleased is empty; drafted it from commits since ${last_tag:-the start}"
      if confirm "Edit the draft in ${VISUAL:-${EDITOR:-vi}} now?" y; then
        ${VISUAL:-${EDITOR:-vi}} CHANGELOG.md </dev/tty >/dev/tty
      fi
    fi
  fi
  dist_tag="$(release_ts check "$version")" || die "release check failed (see above)"
  ok "$version will be published with npm dist-tag $dist_tag"
fi

# ---------------------------------------------------------------- tests
step "Running checks"
"$NPM" ci --ignore-scripts --no-audit --no-fund
"$NPM" run check
"$NPM" pack --dry-run >/dev/null 2>&1 || "$NPM" pack --dry-run
ok "typecheck, tests and package contents"

if (( dry_run )); then
  step "Dry run: npm publish --dry-run for $version"
  (( resume )) || { release_ts changelog "$version"; "$NPM" version "$version" --no-git-tag-version --allow-same-version >/dev/null; }
  echo "Release notes:"; release_ts notes "$version" | sed 's/^/  /'
  "$NPM" publish --dry-run --access public --tag "$dist_tag"
  echo; ok "dry run passed; files restored; nothing was committed, published or pushed"
  exit 0
fi

# ---------------------------------------------------------------- confirm + commit
if (( ! resume )); then
  step "Summary"
  echo "Version:   $bold$version$reset (npm dist-tag $dist_tag, npm user $npm_user)"
  echo "Commits that will be pushed with the release:"
  git log --oneline "$remote_head"..HEAD | sed 's/^/  /'
  [[ -n "$(git log --oneline "$remote_head"..HEAD)" ]] || echo "  (none besides the release commit)"
  echo "Release notes:"
  release_ts unreleased | sed 's/^/  /'
  confirm "Release $version: commit, tag, publish to npm, push and create a GitHub Release?" || die "cancelled; nothing changed"

  step "Creating release commit and tag $tag"
  release_ts changelog "$version"
  "$NPM" version "$version" --no-git-tag-version --allow-same-version >/dev/null
  git add "${release_files[@]}"
  git commit --quiet -m "chore(release): $version"
  git tag -a "$tag" -m "pi-jewter $version"
  trap - EXIT
  ok "committed $(git rev-parse --short HEAD) and tagged $tag"
fi

# ---------------------------------------------------------------- npm
step "Publishing to npm"
if [[ "$(release_ts published "$version")" == yes ]]; then
  ok "pi-jewter@$version is already on npm"
else
  until "$NPM" publish --access public --tag "$dist_tag"; do
    echo
    warn "npm publish failed. If it asked for a one-time password, enter the code from your authenticator."
    otp="$(ask "OTP code (Enter to retry with browser login, q to stop):")"
    [[ "$otp" == q ]] && die "stopped before publishing. Run ./release.sh again to continue from here"
    if [[ -n "$otp" ]]; then
      "$NPM" publish --access public --tag "$dist_tag" --otp "$otp" && break
    fi
  done
  ok "published pi-jewter@$version"
fi

# ---------------------------------------------------------------- git push
step "Pushing $BRANCH and $tag"
local_tag_sha="$(git rev-parse "$tag")"
pushed_tag="$(remote_tag_sha "$tag")"
[[ -z "$pushed_tag" || "$pushed_tag" == "$local_tag_sha" ]] || die "$REMOTE has a different $tag; resolve manually"
git fetch --quiet "$REMOTE" "$BRANCH"
if [[ "$(git rev-parse "$REMOTE/$BRANCH")" == "$(git rev-parse HEAD)" && -n "$pushed_tag" ]]; then
  ok "already pushed"
else
  until git push --atomic "$REMOTE" "HEAD:refs/heads/$BRANCH" "refs/tags/$tag"; do
    confirm "git push failed (see above). Retry?" y || die "the version is on npm but not pushed. Run ./release.sh again to finish"
  done
  ok "pushed $BRANCH and $tag"
fi

# ---------------------------------------------------------------- GitHub Release
step "Creating GitHub Release $tag"
if gh release view "$tag" >/dev/null 2>&1; then
  ok "GitHub Release $tag already exists"
else
  notes="$(mktemp)"
  release_ts notes "$version" >"$notes"
  flags=(--latest)
  [[ "$dist_tag" == next ]] && flags=(--prerelease)
  until gh release create "$tag" --verify-tag --title "pi-jewter $version" --notes-file "$notes" "${flags[@]}"; do
    confirm "gh release create failed. Retry?" y || { rm -f "$notes"; die "npm and git are done; run ./release.sh again to create the GitHub Release"; }
  done
  rm -f "$notes"
fi

# ---------------------------------------------------------------- verify
step "Verifying"
for _ in 1 2 3 4 5 6; do
  [[ "$("$NPM" view "pi-jewter@$version" version 2>/dev/null)" == "$version" ]] && break
  sleep 5
done
if [[ "$("$NPM" view "pi-jewter@$version" version 2>/dev/null)" == "$version" ]]; then
  ok "npm: pi-jewter@$version ($dist_tag)"
else
  warn "npm does not show $version yet; registry updates can take a minute"
fi
ok "git: $tag on $REMOTE"
ok "GitHub: $(gh release view "$tag" --json url --jq .url)"
printf '\n%sReleased pi-jewter %s.%s\n' "$green$bold" "$version" "$reset"
