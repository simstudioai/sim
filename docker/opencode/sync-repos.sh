#!/usr/bin/env bash
set -uo pipefail

if [[ -f /home/opencode/.config/opencode/runtime-env.sh ]]; then
  source /home/opencode/.config/opencode/runtime-env.sh
fi

export HOME="${HOME:-/home/opencode}"
export GIT_TERMINAL_PROMPT=0
export GIT_ASKPASS=/usr/local/bin/git-askpass.sh

log() {
  printf '[opencode-sync] %s\n' "$*"
}

trim() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "$value"
}

sync_repo() {
  local repo_url="$1"
  local repo_name="$2"
  local repo_dir="/app/repos/${repo_name}"

  if [[ -d "$repo_dir/.git" ]]; then
    if git -C "$repo_dir" pull --ff-only; then
      log "Updated ${repo_name}"
      return 0
    fi

    log "Failed to update ${repo_name} from ${repo_url}"
    return 1
  fi

  if [[ -e "$repo_dir" ]]; then
    log "Skipping ${repo_url}; target path ${repo_dir} exists and is not a git repository"
    return 1
  fi

  if git clone "$repo_url" "$repo_dir"; then
    log "Cloned ${repo_name}"
    return 0
  fi

  rm -rf "$repo_dir"
  log "Failed to clone ${repo_url}"
  return 1
}

main() {
  local repos_raw="${OPENCODE_REPOS:-}"

  mkdir -p /app/repos

  if [[ -z "$repos_raw" ]]; then
    log "No repositories configured"
    exit 0
  fi

  local -A seen_names=()
  local repo_url
  local repo_name
  local sync_failed=0

  IFS=',' read -r -a repo_items <<<"$repos_raw"
  for repo_item in "${repo_items[@]}"; do
    repo_url="$(trim "$repo_item")"
    if [[ -z "$repo_url" ]]; then
      continue
    fi

    repo_name="${repo_url##*/}"
    repo_name="${repo_name%.git}"

    if [[ -z "$repo_name" ]]; then
      log "Skipping invalid repository URL: ${repo_url}"
      sync_failed=1
      continue
    fi

    if [[ -n "${seen_names[$repo_name]:-}" ]]; then
      log "Skipping ${repo_url}; repository name ${repo_name} collides with ${seen_names[$repo_name]}"
      sync_failed=1
      continue
    fi

    seen_names["$repo_name"]="$repo_url"

    if ! sync_repo "$repo_url" "$repo_name"; then
      sync_failed=1
    fi
  done

  exit "$sync_failed"
}

main "$@"
