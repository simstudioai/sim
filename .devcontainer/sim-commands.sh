#!/bin/bash
# Sim Project Commands
# Source this file to add project-specific commands to your shell
# Add to your ~/.bashrc or ~/.zshrc: source /workspace/.devcontainer/sim-commands.sh

# Project-specific aliases for Sim development
alias sim-start="cd /workspace && bun run dev:full"
alias sim-app="cd /workspace && bun run dev"
alias sim-sockets="cd /workspace && bun run dev:sockets"
alias sim-migrate="cd /workspace/apps/sim && bunx drizzle-kit push"
alias sim-generate="cd /workspace/apps/sim && bunx drizzle-kit generate"
alias sim-rebuild="cd /workspace && bun run build && bun run start"
alias docs-dev="cd /workspace/apps/docs && bun run dev"

# Database connection helpers
alias pgc="PGPASSWORD=postgres psql -h db -U postgres -d simstudio"
alias check-db="PGPASSWORD=postgres psql -h db -U postgres -c '\l'"

# Default to workspace directory
cd /workspace 2>/dev/null || true

# Welcome message - show once per session
if [ -z "$SIM_WELCOME_SHOWN" ]; then
  export SIM_WELCOME_SHOWN=1

  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "🚀 Sim Development Environment"
  echo ""
  echo "Project commands:"
  echo "  sim-start      - Start app + socket server"
  echo "  sim-app        - Start only main app"
  echo "  sim-sockets    - Start only socket server"
  echo "  sim-migrate    - Push schema changes"
  echo "  sim-generate   - Generate migrations"
  echo ""
  echo "Database:"
  echo "  pgc            - Connect to PostgreSQL"
  echo "  check-db       - List databases"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
fi
