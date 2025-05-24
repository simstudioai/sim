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

## Run

1. Run on our [cloud-hosted version](https://simstudio.ai)
2. Self-host

## How to Self-Host

There are several ways to self-host Sim Studio:

### Option 1: Docker Environment (Recommended)

```bash
# Clone the repository
git clone https://github.com/simstudioai/sim.git

# Create environment file and update with required environment variables (BETTER_AUTH_SECRET)
cd apps/sim
cp .env.example .env

# Start Sim Studio using the provided script
docker compose up -d --build

or

./start_simstudio_docker.sh
```

After running these commands:

1. **Access the Application**:

   - Open [http://localhost:3000/w/](http://localhost:3000/w/) in your browser
   - The `/w/` path is where the main workspace interface is located

2. **Useful Docker Commands**:

   ```bash
   # View application logs
   docker compose logs -f simstudio

   # Access PostgreSQL database
   docker compose exec db psql -U postgres -d simstudio

   # Stop the environment
   docker compose down

   # Rebuild and restart (after code changes)
   docker compose up -d --build
   ```

#### Working with Local Models

To use local models with Sim Studio, follow these steps:

1. **Pull Local Models**

   ```bash
   # Run the ollama_docker.sh script to pull the required models
   ./apps/sim/scripts/ollama_docker.sh pull <model_name>
   ```

2. **Start Sim Studio with Local Models**

   ```bash
   #Start Sim Studio with local model support
   ./start_simstudio_docker.sh --local

   # or

   # Start Sim Studio with local model support if you have nvidia GPU
   docker compose up --profile local-gpu -d --build

   # or

   # Start Sim Studio with local model support if you don't have nvidia GPU
   docker compose up --profile local-cpu -d --build
   ```

The application will now be configured to use your local models. You can access it at [http://localhost:3000/w/](http://localhost:3000/w/).

#### Connecting to Existing Ollama Instance

If you already have an Ollama instance running on your host machine, you can connect to it using one of these methods:

```bash
# Method 1: Use host networking (simplest approach)
docker compose up --profile local-cpu -d --build --network=host
```

Or modify your docker-compose.yml:

```yaml
# Method 2: Add host.docker.internal mapping
services:
  simstudio:
    # ... existing configuration ...
    extra_hosts:
      - 'host.docker.internal:host-gateway'
    environment:
      - OLLAMA_HOST=http://host.docker.internal:11434
```

### Option 2: Dev Containers

1. Open VS Code or your favorite VS Code fork (Cursor, Windsurf, etc.)
2. Install the [Remote - Containers extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers)
3. Open the project in your editor
4. Click "Reopen in Container" when prompted
5. The environment will automatically be set up
6. Run `bun run dev` in the terminal or use the `sim-start` alias

### Option 3: Manual Setup

1. **Install Dependencies**

```bash
# Clone the repository
git clone https://github.com/simstudioai/sim.git
cd sim

# Install dependencies
bun install
```

2. **Set Up Environment**

```bash
cd apps/sim
cp .env.example .env  # or create a new .env file

# Configure your .env file with the required environment variables:
# - Database connection (PostgreSQL)
# - Authentication settings (Better-Auth Secret,  Better-Auth URL)
```

⚠️ **Important Notes:**

- If `RESEND_API_KEY` is not set, verification codes for login/signup will be logged to the console.
- You can use these logged codes for testing authentication locally.
- For production environments, you should set up a proper email provider.

3. **Set Up Database**

```bash
# Push the database schema
cd apps/sim
bunx drizzle-kit push
```

4. **Start Development Server**

```bash
# Start the development server
cd ../..
bun run dev
```

5. **Open [http://localhost:3000](http://localhost:3000) in your browser**

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

##

<p align="center">Made with ❤️ by the Sim Studio Team</p>
