#!/bin/bash

# Set error handling
set -e

# Enable debug mode if DEBUG env var is set
if [ ! -z "$DEBUG" ]; then
  set -x
  echo "Debug mode enabled"
fi

# Get script directories
SCRIPTS_DIR=$(dirname "$0")
ROOT_DIR=$(cd "$SCRIPTS_DIR/.." && pwd)
echo "Scripts directory: $SCRIPTS_DIR"
echo "Root directory: $ROOT_DIR"

# Check if dependencies are installed in scripts directory
if [ ! -d "$SCRIPTS_DIR/node_modules" ]; then
  echo "Required dependencies not found. Installing now..."
  bash "$SCRIPTS_DIR/setup-doc-generator.sh"
fi

# Generate documentation
echo "Generating block documentation..."

# Check if necessary files exist
if [ ! -f "$SCRIPTS_DIR/generate-block-docs.ts" ]; then
  echo "Error: Could not find generate-block-docs.ts script"
  ls -la "$SCRIPTS_DIR"
  exit 1
fi

if [ ! -f "$SCRIPTS_DIR/tsconfig.json" ]; then
  echo "Error: Could not find tsconfig.json in scripts directory"
  exit 1
fi

# Check if npx is available
if ! command -v npx &> /dev/null; then
  echo "Error: npx is not installed. Please install Node.js first."
  exit 1
fi

# Change to scripts directory to use local dependencies
cd "$SCRIPTS_DIR"
echo "Executing: npx tsx ./generate-block-docs.ts"

# Run the generator with tsx using local dependencies
if ! npx tsx ./generate-block-docs.ts; then
  echo ""
  echo "Error running documentation generator."
  echo ""
  echo "For more detailed debugging, run with DEBUG=1:"
  echo "DEBUG=1 ./scripts/generate-docs.sh"
  exit 1
fi

echo "Documentation generation complete!"
echo "Generated documentation can be found in apps/docs/content/docs/tools/" 

# Run prettier on the generated documentation files
echo "Formatting generated documentation files with Prettier..."
cd "$ROOT_DIR"
npx prettier --write "apps/docs/content/docs/tools/**/*.mdx"
echo "Formatting complete!" 