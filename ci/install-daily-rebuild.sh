#!/usr/bin/env bash
# Installs the daily rebuild Action by moving ci/daily-rebuild.yml to where
# GitHub runs workflows, then starts the first run.
#
# GitHub only lets a login with the "workflow" permission add workflow files.
# Grant it once (it opens a browser to approve), then run this script:
#   gh auth refresh -h github.com -s workflow
#   ./ci/install-daily-rebuild.sh
set -Eeuo pipefail
if [[ -z ${XDG_CONFIG_HOME:-} && -d /data/home/.config ]]; then
  export XDG_CONFIG_HOME=/data/home/.config
fi
export GIT_TERMINAL_PROMPT=0
cd -- "$(dirname -- "$0")/.."

if [[ $(git branch --show-current) != main ]]; then
  echo 'Run this on branch main.' >&2
  exit 1
fi
if [[ ! -f ci/daily-rebuild.yml ]]; then
  echo 'ci/daily-rebuild.yml is gone. The Action may already be installed.' >&2
  exit 1
fi
git pull --quiet --ff-only origin main
mkdir -p .github/workflows
git mv ci/daily-rebuild.yml .github/workflows/daily-rebuild.yml
git commit --quiet -m 'Install the daily rebuild Action' -- ci/daily-rebuild.yml .github/workflows/daily-rebuild.yml
if ! git push --quiet origin HEAD:main; then
  echo 'GitHub refused the push. Grant the permission first: gh auth refresh -h github.com -s workflow' >&2
  echo 'Then run: git push origin HEAD:main' >&2
  exit 1
fi
echo 'Installed. Starting the first run.'
gh workflow run daily-rebuild.yml --repo rheinze08/the-dig-web
echo 'Watch it: gh run watch --repo rheinze08/the-dig-web'
