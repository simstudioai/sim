#!/bin/bash

echo "🔄 Building local development version with your changes..."

# Stop current containers
docker-compose -f docker-compose.prod.yml down
docker-compose -f docker-compose.temp.yml down 2>/dev/null || true

# Clean up Docker to prevent layer corruption issues
echo "🧹 Cleaning up Docker cache to prevent build issues..."
docker builder prune -f
docker system prune -f

# Remove any existing dev image to force fresh build
docker rmi simstudio-dev:latest 2>/dev/null || true

# Build local development image with no cache to avoid corruption
echo "📦 Building development image (this may take a few minutes)..."
if ! docker build --no-cache -f docker/dev.Dockerfile -t simstudio-dev:latest .; then
    echo "❌ Build failed! Trying with different approach..."
    echo "🔧 Attempting to fix Docker build environment..."
    
    # More aggressive cleanup
    docker system prune -a -f
    docker builder prune -a -f
    
    # Try again with no cache
    if ! docker build --no-cache -f docker/dev.Dockerfile -t simstudio-dev:latest .; then
        echo "❌ Build still failing. This might be a Docker Desktop issue."
        echo "💡 Try restarting Docker Desktop and run this script again."
        echo "💡 Or increase Docker Desktop memory to 8GB+ in Settings → Resources"
        exit 1
    fi
fi

# Create temporary docker-compose file with local development image
cat > docker-compose.temp.yml << EOF
services:
  simstudio:
    image: simstudio-dev:latest
    restart: unless-stopped
    ports:
      - '3000:3000'
    volumes:
      - ./apps/sim:/app/apps/sim
      - ./packages:/app/packages
    deploy:
      resources:
        limits:
          memory: 8G
    environment:
      - DATABASE_URL=postgresql://postgres:postgres@db:5432/simstudio
      - BETTER_AUTH_URL=http://localhost:3000
      - NEXT_PUBLIC_APP_URL=http://localhost:3000
      - BETTER_AUTH_SECRET=your_auth_secret_here
      - ENCRYPTION_KEY=your_encryption_key_here
      - FREESTYLE_API_KEY=placeholder
      - GOOGLE_CLIENT_ID=placeholder  
      - GOOGLE_CLIENT_SECRET=placeholder
      - GITHUB_CLIENT_ID=placeholder
      - GITHUB_CLIENT_SECRET=placeholder
      - RESEND_API_KEY=placeholder
      - OLLAMA_URL=http://localhost:11434
    depends_on:
      db:
        condition: service_healthy
    healthcheck:
      test: ['CMD', 'wget', '--spider', '--quiet', 'http://127.0.0.1:3000']
      interval: 90s
      timeout: 5s
      retries: 3
      start_period: 30s

  db:
    image: pgvector/pgvector:pg17
    restart: unless-stopped
    ports:
      - '5432:5432'
    environment:
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=postgres
      - POSTGRES_DB=simstudio
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U postgres']
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  postgres_data:
EOF

# Start with local development image
echo "🚀 Starting development environment..."
if docker-compose -f docker-compose.temp.yml up -d; then
    echo "✅ Development version running at http://localhost:3000"
    echo "🔥 Changes to files will be reflected automatically with hot reload!"
    echo ""
    echo "💡 To see logs: docker-compose -f docker-compose.temp.yml logs -f simstudio"
    echo "💡 To stop: docker-compose -f docker-compose.temp.yml down"
    echo "💡 To go back to production: docker-compose -f docker-compose.prod.yml up -d"
else
    echo "❌ Failed to start containers!"
    exit 1
fi 