<p align="center">
  <img src="apps/sim/public/static/sim.png" alt="Sim Studio Logo" width="500"/>
</p>

<p align="center">
  <a href="https://www.apache.org/licenses/LICENSE-2.0"><img src="https://img.shields.io/badge/License-Apache%202.0-blue.svg" alt="License: Apache-2.0"></a>
  <a href="https://discord.gg/Hr4UWYEcTT"><img src="https://img.shields.io/badge/Discord-Join%20Server-7289DA?logo=discord&logoColor=white" alt="Discord"></a>
  <a href="https://x.com/simstudioai"><img src="https://img.shields.io/twitter/follow/simstudioai?style=social" alt="Twitter"></a>
  <a href="https://github.com/simstudioai/sim/pulls"><img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg" alt="PRs welcome"></a>
  <a href="https://docs.simstudio.ai"><img src="https://img.shields.io/badge/Docs-visit%20documentation-blue.svg" alt="Documentation"></a>
</p>

<p align="center">
  <strong>Sim Studio</strong> is a lightweight, user-friendly platform for building AI agent workflows.
</p>

<p align="center">
  <img src="apps/sim/public/static/demo.gif" alt="Sim Studio Demo" width="800"/>
</p>

## Getting Started

1. Use our [cloud-hosted version](https://simstudio.ai)
2. Self-host using one of the methods below

## Self-Hosting Options

### Option 1: NPM Package (Simplest)

The easiest way to run Sim Studio locally is using our [NPM package](https://www.npmjs.com/package/simstudio?activeTab=readme):

```bash
npx simstudio
```

After running these commands, open [http://localhost:3000/](http://localhost:3000/) in your browser.

#### Options

- `-p, --port <port>`: Specify the port to run Sim Studio on (default: 3000)
- `--no-pull`: Skip pulling the latest Docker images

#### Requirements

- Docker must be installed and running on your machine

### Option 2: Docker Compose

```bash
# Clone the repository
git clone https://github.com/simstudioai/sim.git

# Navigate to the project directory
cd sim

# Start Sim Studio
docker compose -f docker-compose.prod.yml up -d
```

Access the application at [http://localhost:3000/](http://localhost:3000/)

#### Using Local Models

To use local models with Sim Studio:

1. Pull models using our helper script:

```bash
./apps/sim/scripts/ollama_docker.sh pull <model_name>
```

2. Start Sim Studio with local model support:

```bash
# With NVIDIA GPU support
docker compose --profile local-gpu -f docker-compose.ollama.yml up -d

# Without GPU (CPU only)
docker compose --profile local-cpu -f docker-compose.ollama.yml up -d

# If hosting on a server, update the environment variables in the docker-compose.prod.yml file to include the server's public IP then start again (OLLAMA_URL to i.e. http://1.1.1.1:11434)
docker compose -f docker-compose.prod.yml up -d
```

### Option 3: Dev Containers

1. Open VS Code with the [Remote - Containers extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers)
2. Open the project and click "Reopen in Container" when prompted
3. Run `bun run dev:full` in the terminal or use the `sim-start` alias
   - This starts both the main application and the realtime socket server

### Option 4: Manual Setup

1. Clone and install dependencies:

```bash
git clone https://github.com/simstudioai/sim.git
cd sim
bun install
```

2. Set up environment:

```bash
cd apps/sim
cp .env.example .env  # Configure with required variables (DATABASE_URL, BETTER_AUTH_SECRET, BETTER_AUTH_URL)
```

3. Set up the database:

```bash
bunx drizzle-kit push
```

4. Start the development servers:

**Recommended approach - run both servers together (from project root):**

```bash
bun run dev:full
```

This starts both the main Next.js application and the realtime socket server required for full functionality.

**Alternative - run servers separately:**

Next.js app (from project root):
```bash
bun run dev
```

Realtime socket server (from `apps/sim` directory in a separate terminal):
```bash
cd apps/sim
bun run dev:sockets
```

## Tech Stack

- **Framework**: [Next.js](https://nextjs.org/) (App Router)
- **Runtime**: [Bun](https://bun.sh/)
- **Database**: PostgreSQL with [Drizzle ORM](https://orm.drizzle.team)
- **Authentication**: [Better Auth](https://better-auth.com)
- **UI**: [Shadcn](https://ui.shadcn.com/), [Tailwind CSS](https://tailwindcss.com)
- **State Management**: [Zustand](https://zustand-demo.pmnd.rs/)
- **Flow Editor**: [ReactFlow](https://reactflow.dev/)
- **Docs**: [Fumadocs](https://fumadocs.vercel.app/)
- **Monorepo**: [Turborepo](https://turborepo.org/)
- **Realtime**: [Socket.io](https://socket.io/)

## Contributing

We welcome contributions! Please see our [Contributing Guide](.github/CONTRIBUTING.md) for details.

## License

This project is licensed under the Apache License 2.0 - see the [LICENSE](LICENSE) file for details.

<p align="center">Made with ❤️ by the Sim Studio Team</p>