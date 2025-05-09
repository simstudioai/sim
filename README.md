<p align="center">
  <img src="sim/public/static/sim.png" alt="Sim Studio Logo" width="500"/>
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

## Getting Started

### Run on [Sim Studio Cloud](https://simstudio.ai)

The fastest way to get started is to use our [cloud-hosted version](https://simstudio.ai) - no setup required!

### Self-host Sim Studio

If you prefer to self-host, there are several options available:

### Option 1: Using CLI (Recommended)

The easiest way to self-host:

```bash
npx simstudio
# This will set up and run Sim Studio locally with minimal configuration
```

### Option 2: Using Docker Compose

```bash
# Clone the repository
git clone https://github.com/simstudioai/sim.git
cd sim

# Create environment file (update BETTER_AUTH_SECRET and ENCRYPTION_KEY with secure random values)
cp sim/.env.example sim/.env

# Start with Docker Compose
docker compose up -d --build
```

Once running, access the application at [http://localhost:3000/w/](http://localhost:3000/w/)

## Working with Local Models

Sim Studio supports integration with local LLM models:

```bash
# Pull local models
./sim/scripts/ollama_docker.sh pull <model_name>

# Start with local model support
./start_simstudio_docker.sh --local

# For systems with NVIDIA GPU
docker compose up --profile local-gpu -d --build

# For CPU-only systems
docker compose up --profile local-cpu -d --build
```

### Connecting to Existing Ollama Instance

If you already have Ollama running locally:

```bash
# Using host networking (simplest)
docker compose up --profile local-cpu -d --build --network=host
```

Or add this to your docker-compose.yml:

```yaml
services:
  simstudio:
    # ... existing configuration ...
    extra_hosts:
      - "host.docker.internal:host-gateway"
    environment:
      - OLLAMA_HOST=http://host.docker.internal:11434
```

## Development Setup

### Prerequisites
- Node.js 20+
- Docker (recommended)
- PostgreSQL (if not using Docker)

### Required Environment Variables

For local development, create a `.env` file with these minimum variables:

```env
DATABASE_URL=postgresql://postgres:postgres@db:5432/simstudio
BETTER_AUTH_SECRET=<generate_a_secure_random_value>
ENCRYPTION_KEY=<generate_a_secure_random_value>
```

⚠️ **Note:** Without `RESEND_API_KEY`, verification codes will be logged to the console for local testing.

### Dev Container Option
1. Open in VS Code with the Remote-Containers extension
2. Click "Reopen in Container" when prompted
3. Run `npm run dev` or use the `sim-start` alias

### Manual Setup
```bash
cd sim/sim
npm install
cp .env.example .env
npx drizzle-kit push
npm run dev
```

## Troubleshooting

Common issues and solutions:

- **Authentication problems**: Check console logs for verification codes if `RESEND_API_KEY` is not set
- **Database connection errors**: Verify PostgreSQL is running and credentials are correct
- **Port conflicts**: Check if port 3000 is already in use by another application

## Tech Stack

- **Framework**: [Next.js](https://nextjs.org/) (App Router)
- **Database**: PostgreSQL with [Drizzle ORM](https://orm.drizzle.team)
- **Authentication**: [Better Auth](https://better-auth.com)
- **UI**: [Shadcn](https://ui.shadcn.com/), [Tailwind CSS](https://tailwindcss.com)
- **State Management**: [Zustand](https://zustand-demo.pmnd.rs/)
- **Flow Editor**: [ReactFlow](https://reactflow.dev/)
- **Docs**: [Fumadocs](https://fumadocs.vercel.app/)

## Contributing

We welcome contributions! Please see our [Contributing Guide](.github/CONTRIBUTING.md) for details.

## License

This project is licensed under the Apache License 2.0 - see the [LICENSE](LICENSE) file for details.

<p align="center">Made with ❤️ by the Sim Studio Team</p>
