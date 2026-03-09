#!/bin/bash

# Exit on error, but with some error handling
set -e

echo "🔧 Setting up Sim development environment..."

# Change to the workspace root directory
cd /workspace

# Install global packages for development (done at runtime, not build time)
echo "📦 Installing global development tools..."
bun install -g turbo drizzle-kit typescript @types/node 2>/dev/null || {
  echo "⚠️ Some global packages may already be installed, continuing..."
}

# Set up bun completions (with proper shell detection)
echo "🔧 Setting up shell completions..."
if [ -n "$SHELL" ] && [ -f "$SHELL" ]; then
  SHELL=/bin/bash bun completions 2>/dev/null | sudo tee /etc/bash_completion.d/bun > /dev/null || {
    echo "⚠️ Could not install bun completions, but continuing..."
  }
fi

# Add project commands to shell profile
echo "📄 Setting up project commands..."
# Add sourcing of sim-commands.sh to user's shell config files if they exist
for rcfile in ~/.bashrc ~/.zshrc; do
  if [ -f "$rcfile" ]; then
    # Check if already added
    if ! grep -q "sim-commands.sh" "$rcfile"; then
      echo "" >> "$rcfile"
      echo "# Sim project commands" >> "$rcfile"
      echo "if [ -f /workspace/.devcontainer/sim-commands.sh ]; then" >> "$rcfile"
      echo "  source /workspace/.devcontainer/sim-commands.sh" >> "$rcfile"
      echo "fi" >> "$rcfile"
    fi
  fi
done

# If no rc files exist yet, create a minimal one
if [ ! -f ~/.bashrc ] && [ ! -f ~/.zshrc ]; then
  echo "# Source Sim project commands" > ~/.bashrc
  echo "if [ -f /workspace/.devcontainer/sim-commands.sh ]; then" >> ~/.bashrc
  echo "  source /workspace/.devcontainer/sim-commands.sh" >> ~/.bashrc
  echo "fi" >> ~/.bashrc
fi

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
bun install

# Check for native dependencies
echo "Checking for native dependencies compatibility..."
if grep -q '"trustedDependencies"' apps/sim/package.json 2>/dev/null; then
  echo "⚠️ Native dependencies detected. Bun will handle compatibility during install."
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

# Clear the welcome message flag to ensure it shows after setup
unset SIM_WELCOME_SHOWN

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Sim development environment setup complete!"
echo ""
echo "Your environment is now ready. A new terminal session will show"
echo "available commands. You can start the development server with:"
echo ""
echo "  sim-start"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Exit successfully regardless of any previous errors
exit 0 