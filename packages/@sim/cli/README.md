# Sim Studio CLI

A command-line interface for Sim Studio - a powerful, user-friendly platform for building, testing, and optimizing agentic workflows.

## Installation

```bash
npm install -g simstudio
```

Or run directly with npx:

```bash
npx simstudio
```

## Quick Start

The fastest way to get started is to run:

```bash
npx simstudio start
```

This will download and start a standalone version of Sim Studio, with all data stored in your browser's localStorage. No database or authentication required!

## Usage

### Start Sim Studio

Start a local instance of Sim Studio:

```bash
simstudio start
```

Options:

- `--port <port>` - Specify the port to run on (default: 3000)
- `--debug` - Run in debug mode

### Help

Get help with available commands:

```bash
simstudio --help
```

## Features

- **Local Storage Mode**: All your workflows and settings are stored in your browser's localStorage, no database required
- **Workflow Builder**: Create and edit workflows with a visual editor
- **Workflow Execution**: Run workflows and see the results in real-time
- **Environment Variables**: Manage environment variables for your workflows

## How It Works

When you run `simstudio start`, the CLI will:

1. Check if you're in a Sim Studio project directory
2. If not, download and extract a standalone version of Sim Studio
3. Start a local server with the standalone app
4. Open a browser window to the Sim Studio UI

All your data is stored in your browser's localStorage, so you can close the app and come back later without losing your work.

## Development

To contribute to the development of Sim Studio CLI:

1. Clone the repository
2. Install dependencies with `npm install`
3. Build the CLI with `npm run build`
4. Link the CLI for local development with `npm link`

## License

MIT
