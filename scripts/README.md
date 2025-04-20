# Block Documentation Generator

This directory contains scripts to automatically generate documentation for all blocks in the Sim Studio platform.

## Available Scripts

- `generate-docs.sh`: Generates documentation for all blocks
- `setup-doc-generator.sh`: Installs dependencies required for the documentation generator

## How It Works

The documentation generator:

1. Scans the `sim/blocks/blocks/` directory for all block definition files
2. Extracts metadata from each block including:
   - Name, description, and category
   - Input and output specifications
   - Configuration parameters
3. Generates standardized Markdown documentation for each block
4. Updates the navigation metadata in `meta.json`

## Running the Generator

To generate documentation manually:

```bash
# From the project root
./scripts/generate-docs.sh
```

## Troubleshooting TypeScript Errors

If you encounter TypeScript errors when running the documentation generator, run the setup script to install the necessary dependencies:

```bash
./scripts/setup-doc-generator.sh
```

This will:
1. Install TypeScript, ts-node, and necessary type definitions
2. Create a proper tsconfig.json for the scripts directory
3. Configure the scripts directory to use ES modules

### Common Issues

1. **Missing Type Declarations**: Run the setup script to install @types/node and @types/react
2. **JSX Errors in block-info-card.tsx**: These don't affect functionality and can be ignored if you've run the setup script
3. **Module Resolution**: The setup script configures proper ES module support

## CI Integration

The documentation generator runs automatically as part of the CI/CD pipeline whenever changes are pushed to the main branch. The updated documentation is committed back to the repository.

## Adding Support for New Block Properties

If you add new properties to block definitions that should be included in the documentation, update the `generateMarkdownForBlock` function in `scripts/generate-block-docs.ts`. 