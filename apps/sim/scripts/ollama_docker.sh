#!/bin/bash
set -e

# Check that at least one argument is provided. If not, display the usage help.
if [ "$#" -eq 0 ]; then
  echo "Usage: $(basename "$0") <ollama command> [args...]"
  echo "Example: $(basename "$0") ps      # This will run 'ollama ps' inside the container"
  exit 1
fi

# Start a detached container from the ollama/ollama image,
# mounting the host's ~/.ollama directory directly into the container.
# Here we mount it to /root/.ollama, assuming that's where the image expects it.
CONTAINER_ID=$(docker run -d -v ~/.ollama:/root/.ollama -p 11434:11434 ollama/ollama
)

# Define a cleanup function to stop the container regardless of how the script exits.
cleanup() {
  docker stop "$CONTAINER_ID" >/dev/null
}
trap cleanup EXIT

# Execute the command provided by the user within the running container.
# The command runs as: "ollama <user-arguments>"
docker exec -it "$CONTAINER_ID" ollama "$@"
