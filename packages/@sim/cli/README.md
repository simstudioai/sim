# Sim Studio CLI

The Sim Studio CLI provides a convenient way to run Sim Studio directly from your terminal without needing to set up a database or complex environment.

## Quick Start

```bash
# Run Sim Studio with default settings
npx sim

# Start with custom port
npx sim start -p 8080

# Get help
npx sim help
```

## Features

- **Zero Configuration**: Get started immediately with `npx sim`
- **Local Storage**: Works entirely in the browser, no database required
- **Persistence**: Your workflows and data persist between sessions
- **Familiar Experience**: All the power of Sim Studio in a simplified package

## Commands

- `sim` - Start Sim Studio with default settings
- `sim start` - Start Sim Studio with options
- `sim version` - Display version information
- `sim help` - Show help and usage information

## Options

- `-p, --port <port>` - Specify port (default: 3000)
- `-d, --debug` - Enable debug mode
- `-v, --version` - Show version information
- `-h, --help` - Show help information

## Local Storage Mode

When running Sim Studio via the CLI, all data is stored using the browser's localStorage. This means:

- Your workflows persist between browser sessions
- No database configuration is required
- Data is stored locally on your device
- Multiple users can't share the same workflows (single-user mode)

## Advanced Usage

If you need multi-user capabilities or want to store data in a database, consider:

1. Using the Docker setup in the main repository
2. Setting up a full Sim Studio environment with PostgreSQL
3. Deploying to Vercel with a database

## For Developers: Building & Publishing the CLI

### Release Checklist

1. ✅ Update the CLI code with your changes
2. ✅ Bump the version in `package.json`
3. ✅ Build the standalone version:
   ```
   npm run build:cli
   ```
4. ✅ Upload the generated `sim-standalone.tar.gz` to GitHub releases
5. ✅ Update the `DOWNLOAD_URL` constant in `packages/@sim/cli/src/commands/start.ts` to point to the new release URL
6. ✅ Commit all changes
7. ✅ Publish to npm:
   ```
   npm run cli:publish
   ```

### About the Standalone Version

The standalone version is a pre-built and bundled version of Sim Studio that can run without a database or complex setup. It includes:

- A pre-built static export of the Next.js application
- A simple Express server to serve the static files
- Configuration to use browser localStorage for data persistence

This allows users to quickly try Sim Studio with a simple `npx sim` command without installing anything else.

### Testing the CLI Locally

To test the CLI locally:

```bash
# Build the CLI
npm run cli:build

# Run the CLI directly
npm run cli:start

# Or use the dev script
npm run cli:dev
```

## Need Help?

Visit our [documentation](https://github.com/yourusername/sim) or open an issue on GitHub.
