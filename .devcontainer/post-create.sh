#!/bin/bash

# Exit on error, but with some error handling
set -e

echo "🔧 Setting up Sim Studio development environment..."

# Change to the sim directory
cd /workspace/sim

# Setup .bashrc
echo "📄 Setting up .bashrc with aliases..."
cp /workspace/.devcontainer/.bashrc ~/.bashrc
# Add to .profile to ensure .bashrc is sourced in non-interactive shells
echo 'if [ -f ~/.bashrc ]; then . ~/.bashrc; fi' >> ~/.profile

# Clean and reinstall dependencies to ensure platform compatibility
echo "📦 Cleaning and reinstalling npm dependencies..."
if [ -d "node_modules" ]; then
  echo "Removing existing node_modules to ensure platform compatibility..."
  rm -rf node_modules
fi

# Install dependencies with platform-specific binaries
npm install || {
  echo "⚠️ npm install had issues but continuing setup..."
}

# Set up environment variables if .env doesn't exist
if [ ! -f ".env" ]; then
  echo "📄 Creating .env file from template..."
  cp .env.example .env 2>/dev/null || echo "DATABASE_URL=postgresql://postgres:postgres@db:5432/simstudio" > .env
fi

# Generate schema and run database migrations
echo "🗃️ Running database schema generation and migrations..."
echo "Generating schema..."
npx drizzle-kit generate

echo "Waiting for database to be ready..."
# Try to connect to the database, but don't fail the script if it doesn't work
(
  timeout=60
  while [ $timeout -gt 0 ]; do
    if PGPASSWORD=postgres psql -h db -U postgres -c '\q' 2>/dev/null; then
      echo "Database is ready!"
      DATABASE_URL=postgresql://postgres:postgres@db:5432/simstudio npx drizzle-kit push
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
alias migrate="cd /workspace/sim && DATABASE_URL=postgresql://postgres:postgres@db:5432/simstudio npx drizzle-kit push"
alias generate="cd /workspace/sim && npx drizzle-kit generate"
alias dev="cd /workspace/sim && npm run dev"
alias build="cd /workspace/sim && npm run build"
alias start="cd /workspace/sim && npm run start"
alias lint="cd /workspace/sim && npm run lint"
alias test="cd /workspace/sim && npm run test"
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