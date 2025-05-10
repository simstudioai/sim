#!/bin/bash

# Get the scripts directory path
SCRIPTS_DIR=$(dirname "$0")
cd "$SCRIPTS_DIR"
echo "Working in scripts directory: $(pwd)"

echo "Setting up documentation generator..."

# Create package.json for scripts directory
cat > package.json << EOF
{
  "name": "sim-doc-generator",
  "version": "1.0.0",
  "description": "Documentation generator for Sim Studio blocks",
  "type": "module",
  "private": true
}
EOF

# Install dependencies local to scripts directory
bun install --save-dev typescript @types/node @types/react ts-node tsx glob

# Setup tsconfig.json
cat > tsconfig.json << EOF
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "strict": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "noEmit": true,
    "allowImportingTsExtensions": true
  },
  "ts-node": {
    "esm": true,
    "experimentalSpecifierResolution": "node"
  },
  "include": ["./**/*.ts"]
}
EOF

echo "Dependencies installed successfully!"
echo "You can now run './scripts/generate-docs.sh' to generate the documentation." 