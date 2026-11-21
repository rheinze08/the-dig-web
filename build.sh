#!/usr/bin/env bash
# Rebuilds The Dig website from the live feeds and publishes it.
#   ./build.sh             fetch the feeds, regenerate docs/, check it, commit and push
#   ./build.sh --no-push   regenerate and check only (local preview: node serve.mjs)
# GitHub Pages serves docs/ on main, so the push is the deploy.
set -Eeuo pipefail
if [[ -z ${XDG_CONFIG_HOME:-} && -d /data/home/.config ]]; then
  export XDG_CONFIG_HOME=/data/home/.config
fi
export GIT_TERMINAL_PROMPT=0

stage='opening the checkout'
trap 'rc=$?; printf "Rebuild failed while %s (exit %d). The published site is unchanged.\n" "$stage" "$rc" >&2; exit 1' ERR
cd -- "$(dirname -- "$0")"

publish=1
if [[ ${1:-} == --no-push ]]; then
  publish=0
elif [[ $# -gt 0 ]]; then
  echo 'Usage: ./build.sh [--no-push]' >&2
  exit 1
fi

if (( publish )); then
  stage='checking the branch'
  if [[ $(git branch --show-current) != main ]]; then
    echo 'Publishing requires the-dig-web on branch main.' >&2
    exit 1
  fi
  stage='fetching earlier rebuilds from GitHub'
  # The daily Action commits docs/ too, so start from its latest commit.
  git pull --quiet --ff-only origin main
fi

stage='building the site from the live feeds'
node build.mjs

stage='checking the generated site'
node test/check.mjs

if (( ! publish )); then
  echo 'Built and checked. Nothing was committed (--no-push).'
  exit 0
fi

stage='committing docs/'
git add -A -- docs
if git diff --cached --quiet -- docs; then
  echo 'The published site is already current. Nothing to commit.'
  exit 0
fi
summary=$(node -e '
  const build = JSON.parse(require("fs").readFileSync("docs/build.json", "utf8"));
  console.log(build.cities.map(city => `${city.slug} ${city.sales} sales${city.status === "live" ? "" : " (preview)"}`).join(", ") + ` (for ${build.cities[0].builtFor})`);
')
git commit --quiet -m "Rebuild site: $summary" -- docs

stage='pushing to GitHub'
git push --quiet origin HEAD:main
echo "Published: $summary"
