#!/bin/bash

set -e

echo "🔧 Setting up Sim Studio development environment..."

# Install dependencies
echo "📦 Installing npm dependencies..."
npm install

# Set up environment variables if .env doesn't exist
if [ ! -f ".env" ]; then
  echo "📄 Creating .env file from template..."
  cp .env.example .env 2>/dev/null || echo "DATABASE_URL=postgresql://postgres:postgres@db:5432/postgres" > .env
fi

# Run database migrations
echo "🗃️ Running database migrations..."
echo "Waiting for database to be ready..."
until PGPASSWORD=postgres psql -h db -U postgres -c '\q'; do
  echo "Database is unavailable - sleeping"
  sleep 2
done

echo "Database is ready!"
npx drizzle-kit push

# Add helpful aliases to .bashrc
cat << EOF >> ~/.bashrc

# Sim Studio Development Aliases
alias migrate="npx drizzle-kit push"
alias generate="npx drizzle-kit generate"
alias dev="npm run dev"
alias build="npm run build"
alias start="npm run start"
alias lint="npm run lint"
alias test="npm run test"
EOF

echo "✅ Development environment is ready! Here are some helpful commands:"
echo "📦 dev - Start the development server"
echo "🔨 build - Build the application for production"
echo "🚀 start - Start the production server"
echo "🧹 lint - Run ESLint"
echo "🧪 test - Run tests"
echo "🗃️ migrate - Push schema changes to the database"
echo "📃 generate - Generate new migrations" 