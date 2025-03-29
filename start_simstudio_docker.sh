#!/bin/bash

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
SIM_DIR=$SCRIPT_DIR/sim

# Function to display help
show_help() {
    echo "Usage: $0 [OPTIONS]"
    echo
    echo "Start Sim Studio with Docker containers"
    echo
    echo "Options:"
    echo "  -h, --help     Show this help message"
    echo "  --local        Use local LLM configuration with Ollama service"
    echo
    echo "Examples:"
    echo "  $0              # Start without local LLM"
    echo "  $0 --local      # Start with local LLM (requires GPU)"
    echo
    echo "Note: When using --local flag, GPU availability is automatically detected"
    echo "      and appropriate configuration is used."
    exit 0
}

# Parse command line arguments
LOCAL=false
while [[ "$#" -gt 0 ]]; do
    case $1 in
        -h|--help) show_help ;;
        --local) LOCAL=true ;;
        *) echo "Unknown parameter: $1"; echo "Use -h or --help for usage information"; exit 1 ;;
    esac
    shift
done

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

# Build and start containers
if [ "$LOCAL" = true ]; then
  if nvidia-smi &> /dev/null; then
    # GPU available with local LLM
    docker compose --profile local-gpu up --build -d
  else
    # No GPU available with local LLM
    docker compose --profile local-cpu up --build -d
  fi
else
    docker compose up --build -d
fi

# Wait for database to be ready
echo "Waiting for database to be ready..."
sleep 5

# Apply migrations automatically
echo "Applying database migrations..."
docker compose exec simstudio npm run db:push

echo "Sim Studio is now running at http://localhost:3000"
echo "To view logs, run: docker compose logs -f simstudio" 