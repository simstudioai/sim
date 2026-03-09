# Sim Development Container

Development container configuration for VS Code Dev Containers and GitHub Codespaces.

## Prerequisites

- Visual Studio Code
- Docker Desktop or Podman Desktop
- VS Code Dev Containers extension

## Getting Started

1. Open this project in VS Code
2. Click "Reopen in Container" when prompted (or press `F1` → "Dev Containers: Reopen in Container")
3. Wait for the container to build and initialize
4. Start developing with `sim-start`

The setup script will automatically install dependencies and run migrations.

## Development Commands

### Running Services

You have two options for running the development environment:

**Option 1: Run everything together (recommended for most development)**
```bash
sim-start  # Runs both app and socket server using concurrently
```

**Option 2: Run services separately (useful for debugging individual services)**
- In the **app** container terminal: `sim-app` (starts Next.js app on port 3000)
- In the **realtime** container terminal: `sim-sockets` (starts socket server on port 3002)

### Other Commands

- `sim-migrate` - Push schema changes to the database
- `sim-generate` - Generate new migrations
- `build` - Build the application
- `pgc` - Connect to PostgreSQL database

## Troubleshooting

**Build errors**: Rebuild the container with `F1` → "Dev Containers: Rebuild Container"

**Port conflicts**: Ensure ports 3000, 3002, and 5432 are available

**Container runtime issues**: Verify Docker Desktop or Podman Desktop is running

## Technical Details

Services:
- **App container** (8GB memory limit) - Main Next.js application
- **Realtime container** (4GB memory limit) - Socket.io server for real-time features
- **Database** - PostgreSQL with pgvector extension
- **Migrations** - Runs automatically on container creation

You can develop with services running together or independently.

### Personalization

**Project commands** (`sim-start`, `sim-app`, etc.) are automatically available via `/workspace/.devcontainer/sim-commands.sh`.

**Personal shell customization** (aliases, prompts, etc.) should use VS Code's dotfiles feature:
1. Create a dotfiles repository (e.g., `github.com/youruser/dotfiles`)
2. Add your `.bashrc`, `.zshrc`, or other configs
3. Configure in VS Code Settings:
   ```json
   {
     "dotfiles.repository": "youruser/dotfiles",
     "dotfiles.installCommand": "install.sh"
   }
   ```

This separates project-specific commands from personal preferences, following VS Code best practices.
