# Sim Studio Development Container

This directory contains configuration files for Visual Studio Code Dev Containers / GitHub Codespaces. Dev containers provide a consistent, isolated development environment for this project.

## Contents

- `devcontainer.json` - The main configuration file that defines the development container settings
- `Dockerfile` - Defines the container image and development environment
- `docker-compose.yml` - Sets up the application and database containers
- `post-create.sh` - Script that runs when the container is created
- `.bashrc` - Custom shell configuration with helpful aliases

## Usage

### Prerequisites

- Visual Studio Code
- Docker installation:
  - Docker Desktop (Windows/macOS)
  - Docker Engine (Linux)
- VS Code Remote - Containers extension

### Getting Started

1. Open this project in Visual Studio Code
2. When prompted, click "Reopen in Container"
   - Alternatively, press `F1` and select "Remote-Containers: Reopen in Container"
3. Wait for the container to build and initialize
4. The post-creation script will automatically:

   - Install dependencies
   - Set up environment variables
   - Run database migrations
   - Configure helpful aliases

5. Start the application with `sim-start` (alias for `bun run dev`)

### Development Commands

The development environment includes these helpful aliases:

- `sim-start` - Start the development server
- `sim-migrate` - Push schema changes to the database
- `sim-generate` - Generate new migrations
- `sim-rebuild` - Build and start the production version
- `pgc` - Connect to the PostgreSQL database
- `check-db` - List all databases

### Using GitHub Codespaces

This project is also configured for GitHub Codespaces. To use it:

1. Go to the GitHub repository
2. Click the "Code" button
3. Select the "Codespaces" tab
4. Click "Create codespace on main"

This will start a new Codespace with the development environment already set up.

## Customization

You can customize the development environment by:

- Modifying `devcontainer.json` to add VS Code extensions or settings
- Updating the `Dockerfile` to install additional packages
- Editing `docker-compose.yml` to add services or change configuration
- Modifying `.bashrc` to add custom aliases or configurations

## Troubleshooting

If you encounter issues:

1. Rebuild the container: `F1` → "Remote-Containers: Rebuild Container"
2. Check Docker logs for build errors
3. Verify Docker Desktop is running
4. Ensure all prerequisites are installed

For more information, see the [VS Code Remote Development documentation](https://code.visualstudio.com/docs/remote/containers).
