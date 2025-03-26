#!/bin/bash

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
SIM_DIR=$SCRIPT_DIR/sim

# Check if .env file exists, if not, create from example
if [ ! -f $SIM_DIR/.env ]; then
  echo "Creating .env file from .env.example..."
  cp $SIM_DIR/.env.example $SIM_DIR/.env
  echo "Please update .env file with your configuration."
else
  echo ".env file found."
fi

# Stop any running containers
docker compose down

# Build and start containers in detached mode
if nvidia-smi &> /dev/null; then
  # GPU available
  docker compose -f deployment/docker-compose.yml up --build
else
  # No GPU available
  docker compose -f deployment/docker-compose-no-gpu.yml up --build
fi


# Wait for database to be ready
echo "Waiting for database to be ready..."
sleep 5

# Apply migrations automatically
echo "Applying database migrations..."
docker compose exec simstudio npm run db:push

echo "Sim Studio is now running at http://localhost:3000"
echo "To view logs, run: docker compose logs -f simstudio" 