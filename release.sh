#!/usr/bin/env bash
# Sparky Cart release helper.
#
# Four versions are managed:
#   product       ./package.json            (release tags vX.Y.Z track this one)
#   frontend      ./frontend/package.json
#   backend       ./backend/package.json
#   microservice  ./microservice/package.json
#
# Each component bump is optional; the product version must be bumped whenever a
# tag is created. The script bumps the selected versions, smoke-builds the
# frontend, commits only the version files, creates an annotated tag and prints
# the push command. It never pushes.
#
# Usage:
#   npm run release -- [options]      (or: ./release.sh [options])
#
# Options (LEVEL = patch | minor | major | none):
#   --product LEVEL        bump the product version (required unless --no-tag)
#   --frontend LEVEL       bump frontend/package.json (+ lock)
#   --backend LEVEL        bump backend/package.json (+ lock)
#   --microservice LEVEL   bump microservice/package.json (+ lock)
#   --no-tag               commit the bump but do not tag (e.g. on a feature branch)
#   --skip-build           skip the frontend build check
#   --dry-run              print what would happen and change nothing
#   -h, --help             show this help
#
# Levels not given on the command line are prompted for when run in a terminal
# (default: none for components, the highest component bump for the product).
set -euo pipefail

cd "$(dirname "$0")"

usage() { sed -n '2,29p' "$0" | sed 's/^# \{0,1\}//'; }
die() { echo "release: $*" >&2; exit 1; }

COMPONENTS=(frontend backend microservice)
declare -A LEVEL=()
PRODUCT_LEVEL=""
TAG=1
BUILD=1
DRY_RUN=0

valid_level() { [[ "$1" =~ ^(patch|minor|major|none)$ ]]; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --product | --frontend | --backend | --microservice)
      [[ $# -ge 2 ]] || die "$1 needs a level (patch|minor|major|none)"
      valid_level "$2" || die "invalid level '$2' for $1"
      if [[ "$1" == "--product" ]]; then PRODUCT_LEVEL="$2"; else LEVEL[${1#--}]="$2"; fi
      shift 2
      ;;
    --no-tag) TAG=0; shift ;;
    --skip-build) BUILD=0; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h | --help) usage; exit 0 ;;
    *) die "unknown option '$1' (see --help)" ;;
  esac
done

# Read "version" from a package.json.
read_version() { node -p "require('./$1').version"; }

# next_version CURRENT LEVEL -> bumped semver (none returns CURRENT).
next_version() {
  node -e '
    const [cur, lvl] = process.argv.slice(1);
    const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(cur);
    if (!m) { console.error(`not a plain X.Y.Z version: ${cur}`); process.exit(1); }
    let [ma, mi, pa] = m.slice(1).map(Number);
    if (lvl === "major") { ma++; mi = 0; pa = 0; }
    else if (lvl === "minor") { mi++; pa = 0; }
    else if (lvl === "patch") { pa++; }
    console.log(`${ma}.${mi}.${pa}`);
  ' "$1" "$2"
}

rank() { case "$1" in major) echo 3 ;; minor) echo 2 ;; patch) echo 1 ;; *) echo 0 ;; esac; }

prompt_level() { # prompt_level NAME CURRENT DEFAULT
  local answer
  read -r -p "Bump $1 ($2)? [patch/minor/major/none] (default: $3): " answer
  answer="${answer:-$3}"
  valid_level "$answer" || die "invalid level '$answer'"
  echo "$answer"
}

# --- preconditions --------------------------------------------------------
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "not inside a git repository"
git diff --cached --quiet || die "the index has staged changes; commit or unstage them first"

declare -A CURRENT=()
for c in "${COMPONENTS[@]}"; do CURRENT[$c]="$(read_version "$c/package.json")"; done
PRODUCT_CURRENT="$(read_version package.json)"

INTERACTIVE=0
[[ -t 0 ]] && INTERACTIVE=1

highest="none"
for c in "${COMPONENTS[@]}"; do
  if [[ -z "${LEVEL[$c]:-}" ]]; then
    if ((INTERACTIVE)); then LEVEL[$c]="$(prompt_level "$c" "${CURRENT[$c]}" none)"; else LEVEL[$c]="none"; fi
  fi
  (($(rank "${LEVEL[$c]}") > $(rank "$highest"))) && highest="${LEVEL[$c]}"
done
if [[ -z "$PRODUCT_LEVEL" ]]; then
  if ((INTERACTIVE)); then
    PRODUCT_LEVEL="$(prompt_level product "$PRODUCT_CURRENT" "$highest")"
  else
    PRODUCT_LEVEL="none"
  fi
fi

if ((TAG)) && [[ "$PRODUCT_LEVEL" == "none" ]]; then
  die "a tagged release must bump the product version (--product LEVEL), or pass --no-tag"
fi

# Files this run will modify; they must not carry unrelated local edits.
FILES=()
[[ "$PRODUCT_LEVEL" != "none" ]] && FILES+=(package.json)
for c in "${COMPONENTS[@]}"; do
  [[ "${LEVEL[$c]}" != "none" ]] && FILES+=("$c/package.json" "$c/package-lock.json")
done
((${#FILES[@]} > 0)) || die "nothing to bump"
git diff --quiet -- "${FILES[@]}" || die "uncommitted changes in: $(git diff --name-only -- "${FILES[@]}" | tr '\n' ' ')"

PRODUCT_NEXT="$(next_version "$PRODUCT_CURRENT" "$PRODUCT_LEVEL")"
declare -A NEXT=()
for c in "${COMPONENTS[@]}"; do NEXT[$c]="$(next_version "${CURRENT[$c]}" "${LEVEL[$c]}")"; done

TAG_NAME="v$PRODUCT_NEXT"
if ((TAG)) && git rev-parse -q --verify "refs/tags/$TAG_NAME" >/dev/null; then
  die "tag $TAG_NAME already exists"
fi

echo "Release plan:"
printf '  %-13s %s -> %s\n' product "$PRODUCT_CURRENT" "$PRODUCT_NEXT"
for c in "${COMPONENTS[@]}"; do printf '  %-13s %s -> %s\n' "$c" "${CURRENT[$c]}" "${NEXT[$c]}"; done
if ((TAG)); then echo "  tag           $TAG_NAME"; else echo "  tag           (none: --no-tag)"; fi

if ((DRY_RUN)); then
  echo "Dry run: no files changed."
  exit 0
fi

# If anything below fails, say how to undo the uncommitted bump.
trap 'echo "release: failed; revert the version files with: git checkout -- ${FILES[*]}" >&2' ERR

# --- bump -----------------------------------------------------------------
if [[ "$PRODUCT_LEVEL" != "none" ]]; then
  node -e '
    const fs = require("fs");
    const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
    pkg.version = process.argv[1];
    fs.writeFileSync("package.json", JSON.stringify(pkg, null, 2) + "\n");
  ' "$PRODUCT_NEXT"
fi
for c in "${COMPONENTS[@]}"; do
  [[ "${LEVEL[$c]}" == "none" ]] && continue
  (cd "$c" && npm version "${LEVEL[$c]}" --no-git-tag-version >/dev/null)
  got="$(read_version "$c/package.json")"
  [[ "$got" == "${NEXT[$c]}" ]] || die "$c bumped to $got, expected ${NEXT[$c]}"
done

# --- build check ----------------------------------------------------------
if ((BUILD)); then
  echo "Building frontend…"
  (cd frontend && npm run build)
fi

# --- commit + tag ---------------------------------------------------------
SUMMARY="frontend ${NEXT[frontend]}, backend ${NEXT[backend]}, microservice ${NEXT[microservice]}"
git add -- "${FILES[@]}"
if [[ "$PRODUCT_LEVEL" != "none" ]]; then
  git commit -q -m "chore(release): v$PRODUCT_NEXT" -m "Product $PRODUCT_NEXT: $SUMMARY." -- "${FILES[@]}"
else
  git commit -q -m "chore(release): bump component versions" -m "Product $PRODUCT_NEXT (unchanged): $SUMMARY." -- "${FILES[@]}"
fi
trap - ERR
echo "Committed $(git rev-parse --short HEAD)."

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if ((TAG)); then
  git tag -a "$TAG_NAME" -m "Sparky Cart $PRODUCT_NEXT" -m "$SUMMARY"
  echo "Tagged $TAG_NAME."
  echo
  echo "To publish, run:"
  echo "  git push origin $BRANCH --follow-tags"
else
  echo
  echo "To publish, run:"
  echo "  git push origin $BRANCH"
fi
