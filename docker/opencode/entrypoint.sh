#!/usr/bin/env bash
set -euo pipefail

log() {
  printf '[opencode-entrypoint] %s\n' "$*"
}

write_runtime_env() {
  local env_file="/home/opencode/.config/opencode/runtime-env.sh"
  local vars=(
    HOME
    PATH
    OPENCODE_REPOS
    GIT_USERNAME
    GIT_TOKEN
    GITHUB_TOKEN
    OPENAI_API_KEY
    ANTHROPIC_API_KEY
    GEMINI_API_KEY
    GOOGLE_GENERATIVE_AI_API_KEY
  )

  umask 077
  : >"$env_file"

  for name in "${vars[@]}"; do
    if [[ -v "$name" ]]; then
      printf 'export %s=%q\n' "$name" "${!name}" >>"$env_file"
    fi
  done

  chown opencode:opencode "$env_file"
}

write_global_config() {
  cat >/home/opencode/.config/opencode/opencode.json <<EOF
{
  "\$schema": "https://opencode.ai/config.json",
  "server": {
    "port": ${OPENCODE_PORT},
    "hostname": "0.0.0.0"
  },
  "permission": {
    "*": "deny",
    "read": {
      "*": "allow",
      "*.env": "deny",
      "*.env.*": "deny",
      "*.env.example": "allow"
    },
    "grep": "allow",
    "glob": "allow",
    "list": "allow",
    "edit": "deny",
    "bash": "deny",
    "webfetch": "deny",
    "task": "deny",
    "todowrite": "deny",
    "websearch": "deny",
    "codesearch": "deny"
  }
}
EOF
  chown opencode:opencode /home/opencode/.config/opencode/opencode.json
}

install_cron() {
  cat >/etc/cron.d/opencode-sync <<'EOF'
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
*/15 * * * * opencode /usr/local/bin/sync-repos.sh >> /proc/1/fd/1 2>> /proc/1/fd/2
EOF
  chmod 0644 /etc/cron.d/opencode-sync
}

main() {
  : "${OPENCODE_PORT:=4096}"
  : "${OPENCODE_SERVER_USERNAME:=opencode}"

  if [[ -z "${OPENCODE_SERVER_PASSWORD:-}" ]]; then
    log "OPENCODE_SERVER_PASSWORD is required"
    exit 1
  fi

  if [[ -z "${GOOGLE_GENERATIVE_AI_API_KEY:-}" && -n "${GEMINI_API_KEY:-}" ]]; then
    export GOOGLE_GENERATIVE_AI_API_KEY="${GEMINI_API_KEY}"
  fi

  mkdir -p /app/repos /home/opencode/.config/opencode /home/opencode/.local/share/opencode /home/opencode/.local/state
  chown -R opencode:opencode /app/repos /home/opencode/.config /home/opencode/.local/share /home/opencode/.local/state

  write_runtime_env
  write_global_config
  install_cron

  if [[ -z "${OPENAI_API_KEY:-}" && -z "${ANTHROPIC_API_KEY:-}" && -z "${GEMINI_API_KEY:-}" && -z "${GOOGLE_GENERATIVE_AI_API_KEY:-}" ]]; then
    log "No provider API key detected in environment; server will start but prompts may fail"
  fi

  if ! gosu opencode /usr/local/bin/sync-repos.sh; then
    log "Repository sync completed with errors"
  fi
  cron

  cd /app
  exec gosu opencode opencode serve --hostname 0.0.0.0 --port "${OPENCODE_PORT}"
}

main "$@"
