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
3. Run `bun run dev` in the terminal or use the `sim-start` alias

### Option 4: Manual Setup (Recommended for Development)

This option provides the most control and is ideal for development. It includes setting up PostgreSQL locally for full database functionality.

#### Prerequisites

- **Node.js** (v18 or higher)
- **Bun** (recommended) or **npm**/**yarn**
- **Homebrew** (for macOS users)
- **Git**

#### Step-by-Step Installation

1. **Clone the repository:**
```bash
git clone https://github.com/simstudioai/sim.git
cd sim
```

2. **Install dependencies:**
```bash
bun install
```

3. **Install PostgreSQL (Required for full functionality):**

   **On macOS (using Homebrew):**
   ```bash
   # Install PostgreSQL 15
   brew install postgresql@15
   
   # Start PostgreSQL service
   brew services start postgresql@15
   
   # Add PostgreSQL to PATH (add this to your ~/.zshrc or ~/.bashrc)
   echo 'export PATH="/usr/local/opt/postgresql@15/bin:$PATH"' >> ~/.zshrc
   source ~/.zshrc
   
   # Create the postgres user and database
   createuser -s postgres
   createdb postgres
   ```

   **On Ubuntu/Debian:**
   ```bash
   sudo apt update
   sudo apt install postgresql postgresql-contrib
   sudo systemctl start postgresql
   sudo systemctl enable postgresql
   sudo -u postgres createuser --superuser postgres
   ```

   **On Windows:**
   - Download and install PostgreSQL from [postgresql.org](https://www.postgresql.org/download/windows/)
   - Add PostgreSQL bin directory to your PATH
   - Create a postgres user during installation

4. **Install pgvector extension (Required for AI features):**

   **On macOS:**
   ```bash
   brew install pgvector
   ```

   **On Ubuntu/Debian:**
   ```bash
   sudo apt install postgresql-15-pgvector
   ```

   **Enable the extension:**
   ```bash
   psql -U postgres -d postgres -c "CREATE EXTENSION IF NOT EXISTS vector;"
   ```

5. **Set up environment variables:**
```bash
cd apps/sim
cp .env.example .env
```

Edit the `.env` file and configure the following variables:
```env
# Database configuration
DATABASE_URL="postgresql://postgres@localhost:5432/postgres"

# Authentication (generate a secure random string)
BETTER_AUTH_SECRET="your-secret-key-here"
BETTER_AUTH_URL="http://localhost:3000"

# Optional: Social login providers (Google, GitHub)
# GOOGLE_CLIENT_ID="your-google-client-id"
# GOOGLE_CLIENT_SECRET="your-google-client-secret"
# GITHUB_CLIENT_ID="your-github-client-id"
# GITHUB_CLIENT_SECRET="your-github-client-secret"
```

6. **Set up the database schema:**
```bash
bunx drizzle-kit push
```

7. **Start the development server:**
```bash
# From the project root
bun run dev
```

8. **Access the application:**
- **Main app**: http://localhost:3000
- **Documentation**: http://localhost:3001

#### Troubleshooting

**Database Connection Issues:**
- Ensure PostgreSQL is running: `brew services list | grep postgresql`
- Check if the postgres user exists: `psql -U postgres -d postgres -c "\du"`
- Verify pgvector extension is installed: `psql -U postgres -d postgres -c "SELECT * FROM pg_extension WHERE extname = 'vector';"`

**Port Already in Use:**
- Check what's running on port 3000: `lsof -i :3000`
- Kill the process or change the port in the environment variables

**Permission Issues:**
- On macOS, you might need to grant full disk access to Terminal/VS Code for PostgreSQL
- Ensure your user has the necessary permissions to create databases and users

#### Development Workflow

1. **Start the development server:**
```bash
bun run dev
```

2. **Make changes** to the code - the server will automatically reload

3. **Database migrations** (when schema changes):
```bash
cd apps/sim
bunx drizzle-kit generate
bunx drizzle-kit push
```

4. **Stop the server:** Press `Ctrl+C` in the terminal

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

## Contributing

We welcome contributions! Please see our [Contributing Guide](.github/CONTRIBUTING.md) for details.

## License

This project is licensed under the Apache License 2.0 - see the [LICENSE](LICENSE) file for details.

<p align="center">Made with ❤️ by the Sim Studio Team</p>