#!/usr/bin/env bash
set -euo pipefail

prompt="${1:-}"

if [[ "$prompt" == Username* ]]; then
  if [[ "$prompt" == *github.com* && -n "${GITHUB_TOKEN:-}" && -z "${GIT_TOKEN:-}" ]]; then
    printf '%s\n' "${GITHUB_USERNAME:-x-access-token}"
    exit 0
  fi

  printf '%s\n' "${GIT_USERNAME:-git}"
  exit 0
fi

if [[ "$prompt" == Password* ]]; then
  if [[ "$prompt" == *github.com* && -n "${GITHUB_TOKEN:-}" && -z "${GIT_TOKEN:-}" ]]; then
    printf '%s\n' "${GITHUB_TOKEN}"
    exit 0
  fi

  printf '%s\n' "${GIT_TOKEN:-}"
  exit 0
fi

printf '\n'
