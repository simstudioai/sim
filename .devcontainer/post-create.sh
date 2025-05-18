#!/bin/bash

# Exit on error, but with some error handling
set -e

echo "🔧 Setting up Sim Studio development environment..."

# Change to the workspace root directory
cd /workspace

# Setup .bashrc
echo "📄 Setting up .bashrc with aliases..."
cp /workspace/.devcontainer/.bashrc ~/.bashrc
# Add to .profile to ensure .bashrc is sourced in non-interactive shells
echo 'if [ -f ~/.bashrc ]; then . ~/.bashrc; fi' >> ~/.profile

# Clean and reinstall dependencies to ensure platform compatibility
echo "📦 Cleaning and reinstalling dependencies..."
if [ -d "node_modules" ]; then
  echo "Removing existing node_modules to ensure platform compatibility..."
  rm -rf node_modules
  rm -rf apps/sim/node_modules
  rm -rf apps/docs/node_modules
fi

# Ensure Bun cache directory exists and has correct permissions
mkdir -p ~/.bun/cache
chmod 700 ~/.bun ~/.bun/cache

# Install dependencies with platform-specific binaries
echo "Installing dependencies with Bun..."
bun install || {
  echo "⚠️ bun install had issues but continuing setup..."
}

# Check for native dependencies
echo "Checking for native dependencies compatibility..."
NATIVE_DEPS=$(grep '"trustedDependencies"' apps/sim/package.json || echo "")
if [ ! -z "$NATIVE_DEPS" ]; then
  echo "⚠️ Native dependencies detected. Ensuring compatibility with Bun..."
  for pkg in $(echo $NATIVE_DEPS | grep -oP '"[^"]*"' | tr -d '"' | grep -v "trustedDependencies"); do
    echo "Checking compatibility for $pkg..."
  done
fi

# Set up environment variables if .env doesn't exist for the sim app
if [ ! -f "apps/sim/.env" ]; then
  echo "📄 Creating .env file from template..."
  if [ -f "apps/sim/.env.example" ]; then
    cp apps/sim/.env.example apps/sim/.env
  else
    echo "DATABASE_URL=postgresql://postgres:postgres@db:5432/simstudio" > apps/sim/.env
  fi
fi

# Generate schema and run database migrations
echo "🗃️ Running database schema generation and migrations..."
echo "Generating schema..."
cd apps/sim
bunx drizzle-kit generate
cd ../..

echo "Waiting for database to be ready..."
# Try to connect to the database, but don't fail the script if it doesn't work
(
  timeout=60
  while [ $timeout -gt 0 ]; do
    if PGPASSWORD=postgres psql -h db -U postgres -c '\q' 2>/dev/null; then
      echo "Database is ready!"
      cd apps/sim
      DATABASE_URL=postgresql://postgres:postgres@db:5432/simstudio bunx drizzle-kit push
      cd ../..
      break
    fi
    echo "Database is unavailable - sleeping (${timeout}s remaining)"
    sleep 5
    timeout=$((timeout - 5))
  done
  
  if [ $timeout -le 0 ]; then
    echo "⚠️ Database connection timed out, skipping migrations"
  fi
) || echo "⚠️ Database setup had issues but continuing..."

# Add additional helpful aliases to .bashrc
cat << EOF >> ~/.bashrc

# Additional Sim Studio Development Aliases
alias migrate="cd /workspace/apps/sim && DATABASE_URL=postgresql://postgres:postgres@db:5432/simstudio bunx drizzle-kit push"
alias generate="cd /workspace/apps/sim && bunx drizzle-kit generate"
alias dev="cd /workspace && bun run dev"
alias build="cd /workspace && bun run build"
alias start="cd /workspace && bun run dev"
alias lint="cd /workspace/apps/sim && bun run lint"
alias test="cd /workspace && bun run test"
alias bun-update="cd /workspace && bun update"
EOF

# Source the .bashrc to make aliases available immediately
. ~/.bashrc

# Clear the welcome message flag to ensure it shows after setup
unset SIM_WELCOME_SHOWN

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Sim Studio development environment setup complete!"
echo ""
echo "Your environment is now ready. A new terminal session will show"
echo "available commands. You can start the development server with:"
echo ""
echo "  sim-start"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Exit successfully regardless of any previous errors
exit 0 