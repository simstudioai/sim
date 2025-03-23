#!/bin/bash

# Check if .env file exists, if not, create from example
if [ ! -f .env ]; then
  echo "Creating .env file from .env.example..."
  cp .env.example .env
  echo "Please update .env file with your configuration."
fi

# Stop any running containers
docker compose down

# Build and start containers in detached mode
docker compose up --build -d

# Wait for database to be ready
echo "Waiting for database to be ready..."
sleep 5

# Apply migrations automatically
echo "Applying database migrations..."
docker compose exec simstudio npm run db:push

echo "Sim Studio is now running at http://localhost:3000"
echo "To view logs, run: docker compose logs -f simstudio" 