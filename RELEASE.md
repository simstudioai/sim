# Releasing Sim Studio to npm

This guide outlines the steps to release Sim Studio CLI to npm and create a GitHub release with the standalone app.

## Prerequisites

- Node.js 16 or higher
- npm account with access to the `simstudio` package
- GitHub access to the `simstudioai/sim` repository

## Release Process

### 1. Prepare the Release

1. Ensure all changes are committed and pushed to the main branch
2. Update the version number in `packages/@sim/cli/package.json`
3. Update the `STANDALONE_VERSION` in `packages/@sim/cli/src/commands/start.ts` to match

### 2. Run the Release Script

The release script automates most of the process:

```bash
node scripts/release-npm.js
```

This script will:

- Clean up any existing standalone files
- Build the standalone app
- Prepare the CLI package
- Create the standalone directory
- Provide instructions for publishing to npm and creating a GitHub release

### 3. Publish to npm

After the script completes, follow the instructions to publish to npm:

```bash
cd packages/@sim/cli
npm publish
```

### 4. Create GitHub Release

1. Go to https://github.com/simstudioai/sim/releases/new
2. Set the tag to match your version (e.g., `v0.1.0`)
3. Set the title to "Sim Studio v0.1.0" (replace with your version)
4. Upload the `sim-standalone.tar.gz` file from the project root
5. Add release notes describing the changes
6. Publish the release

## Testing the Release

To test the released package:

```bash
# Install globally
npm install -g simstudio

# Run the CLI
simstudio start

# Or run with npx
npx simstudio start
```

## Troubleshooting

### npm publish fails

- Ensure you're logged in to npm: `npm login`
- Check that the package name is available: `npm view simstudio`
- Verify the version number is higher than the previously published version

### GitHub release fails

- Ensure you have the correct permissions to create releases
- Check that the tag doesn't already exist
- Verify the tarball was created correctly

## Maintenance

After a successful release:

1. Increment the version number in `packages/@sim/cli/package.json` for the next release
2. Update the `STANDALONE_VERSION` in `packages/@sim/cli/src/commands/start.ts`
3. Commit these changes with a message like "Bump version to X.Y.Z"
