#!/bin/bash

set -e

echo "Setting up Sim Studio CLI Package..."

# Create directory structure if it doesn't exist
mkdir -p packages/@simstudio/cli/bin
mkdir -p packages/@simstudio/cli/src/commands
mkdir -p packages/@simstudio/cli/src/utils

# Navigate to CLI directory
cd packages/@simstudio/cli

# Install dependencies
echo "Installing CLI dependencies..."
npm install

# Build the CLI package
echo "Building CLI package..."
npm run build

# Make the CLI executable
chmod +x bin/sim.js

echo "✅ CLI setup complete!"
echo ""
echo "You can now run:"
echo "  npm run cli:start - to test the CLI"
echo "  npm run cli:dev - to develop the CLI with live reload"
echo "  npm run cli:publish - to publish to npm"
echo ""
echo "Try it out with: ./packages/@simstudio/cli/bin/sim.js" 