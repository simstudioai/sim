<p align="center">
  <a href="https://sim.ai" target="_blank" rel="noopener noreferrer">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="apps/sim/public/logo/wordmark.svg">
      <source media="(prefers-color-scheme: light)" srcset="apps/sim/public/logo/wordmark-dark.svg">
      <img src="apps/sim/public/logo/wordmark-dark.svg" alt="Sim Logo" width="380"/>
    </picture>
  </a>
</p>

<p align="center">The open-source platform to build AI agents and run your agentic workforce. Connect 1,000+ integrations and LLMs to orchestrate agentic workflows.</p>

<p align="center">
  <a href="https://sim.ai" target="_blank" rel="noopener noreferrer"><img src="https://img.shields.io/badge/sim.ai-33c482" alt="Sim.ai"></a>
  <a href="https://discord.gg/Hr4UWYEcTT" target="_blank" rel="noopener noreferrer"><img src="https://img.shields.io/badge/Discord-Join%20Server-5865F2?logo=discord&logoColor=white" alt="Discord"></a>
  <a href="https://x.com/simdotai" target="_blank" rel="noopener noreferrer"><img src="https://img.shields.io/twitter/follow/simdotai?style=social" alt="Twitter"></a>
  <a href="https://docs.sim.ai" target="_blank" rel="noopener noreferrer"><img src="https://img.shields.io/badge/Docs-33c482.svg" alt="Documentation"></a>
</p>

<p align="center">
  <a href="https://deepwiki.com/simstudioai/sim" target="_blank" rel="noopener noreferrer"><img src="https://deepwiki.com/badge.svg" alt="Ask DeepWiki"></a>  <a href="https://cursor.com/link/prompt?text=Help%20me%20set%20up%20Sim%20locally.%20Follow%20these%20steps%3A%0A%0A1.%20First%2C%20verify%20Docker%20is%20installed%20and%20running%3A%0A%20%20%20docker%20--version%0A%20%20%20docker%20info%0A%0A2.%20Clone%20the%20repository%3A%0A%20%20%20git%20clone%20https%3A%2F%2Fgithub.com%2Fsimstudioai%2Fsim.git%0A%20%20%20cd%20sim%0A%0A3.%20Start%20the%20services%20with%20Docker%20Compose%3A%0A%20%20%20docker%20compose%20-f%20docker-compose.prod.yml%20up%20-d%0A%0A4.%20Wait%20for%20all%20containers%20to%20be%20healthy%20(this%20may%20take%201-2%20minutes)%3A%0A%20%20%20docker%20compose%20-f%20docker-compose.prod.yml%20ps%0A%0A5.%20Verify%20the%20app%20is%20accessible%20at%20http%3A%2F%2Flocalhost%3A3000%0A%0AIf%20there%20are%20any%20errors%2C%20help%20me%20troubleshoot%20them.%20Common%20issues%3A%0A-%20Port%203000%2C%203002%2C%20or%205432%20already%20in%20use%0A-%20Docker%20not%20running%0A-%20Insufficient%20memory%20(needs%2012GB%2B%20RAM)%0A%0AFor%20local%20AI%20models%20with%20Ollama%2C%20use%20this%20instead%20of%20step%203%3A%0A%20%20%20docker%20compose%20-f%20docker-compose.ollama.yml%20--profile%20setup%20up%20-d"><img src="https://img.shields.io/badge/Set%20Up%20with-Cursor-000000?logo=cursor&logoColor=white" alt="Set Up with Cursor"></a>
</p>

### Build Workflows with Ease
Design agent workflows visually on a canvas—connect agents, tools, and blocks, then run them instantly.

<p align="center">
  <img src="apps/sim/public/static/workflow.gif" alt="Workflow Builder Demo" width="800"/>
</p>

### Supercharge with Copilot
Leverage Copilot to generate nodes, fix errors, and iterate on flows directly from natural language.

<p align="center">
  <img src="apps/sim/public/static/copilot.gif" alt="Copilot Demo" width="800"/>
</p>

### Integrate Vector Databases
Upload documents to a vector store and let agents answer questions grounded in your specific content.

<p align="center">
  <img src="apps/sim/public/static/knowledge.gif" alt="Knowledge Uploads and Retrieval Demo" width="800"/>
</p>

## Quickstart

### Cloud-hosted: [sim.ai](https://sim.ai)

<a href="https://sim.ai" target="_blank" rel="noopener noreferrer"><img src="https://img.shields.io/badge/sim.ai-33c482?logo=data:image/svg%2bxml;base64,PHN2ZyB3aWR0aD0iNjE2IiBoZWlnaHQ9IjYxNiIgdmlld0JveD0iMCAwIDYxNiA2MTYiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxnIGNsaXAtcGF0aD0idXJsKCNjbGlwMF8xMTU5XzMxMykiPgo8cGF0aCBkPSJNNjE2IDBIMFY2MTZINjE2VjBaIiBmaWxsPSIjMzNjNDgyIi8+CjxwYXRoIGQ9Ik04MyAzNjUuNTY3SDExM0MxMTMgMzczLjgwNSAxMTYgMzgwLjM3MyAxMjIgMzg1LjI3MkMxMjggMzg5Ljk0OCAxMzYuMTExIDM5Mi4yODUgMTQ2LjMzMyAzOTIuMjg1QzE1Ny40NDQgMzkyLjI4NSAxNjYgMzkwLjE3MSAxNzIgMzg1LjkzOUMxNzcuOTk5IDM4MS40ODcgMTgxIDM3NS41ODYgMTgxIDM2OC4yMzlDMTgxIDM2Mi44OTUgMTc5LjMzMyAzNTguNDQyIDE3NiAzNTQuODhDMTcyLjg4OSAzNTEuMzE4IDE2Ny4xMTEgMzQ4LjQyMiAxNTguNjY3IDM0Ni4xOTZMMTMwIDMzOS41MTdDMTE1LjU1NSAzMzUuOTU1IDEwNC43NzggMzMwLjQ5OSA5Ny42NjY1IDMyMy4xNTFDOTAuNzc3NSAzMTUuODA0IDg3LjMzMzQgMzA2LjExOSA4Ny4zMzM0IDI5NC4wOTZDODcuMzMzNCAyODQuMDc2IDg5Ljg4OSAyNzUuMzkyIDk0Ljk5OTYgMjY4LjA0NUMxMDAuMzMzIDI2MC42OTcgMTA3LjU1NSAyNTUuMDIgMTE2LjY2NiAyNTEuMDEyQzEyNiAyNDcuMDA0IDEzNi42NjcgMjQ1IDE0OC42NjYgMjQ1QzE2MC42NjcgMjQ1IDE3MSAyNDcuMTE2IDE3OS42NjcgMjUxLjM0NkMxODguNTU1IDI1NS41NzYgMTk1LjQ0NCAyNjEuNDc3IDIwMC4zMzMgMjY5LjA0N0MyMDUuNDQ0IDI3Ni42MTcgMjA4LjExMSAyODUuNjM0IDIwOC4zMzMgMjk2LjA5OUgxNzguMzMzQzE3OC4xMTEgMjg3LjYzOCAxNzUuMzMzIDI4MS4wNyAxNjkuOTk5IDI3Ni4zOTRDMTY0LjY2NiAyNzEuNzE5IDE1Ny4yMjIgMjY5LjM4MSAxNDcuNjY3IDI2OS4zODFDMTM3Ljg4OSAyNjkuMzgxIDEzMC4zMzMgMjcxLjQ5NiAxMjUgMjc1LjcyNkMxMTkuNjY2IDI3OS45NTcgMTE3IDI4NS43NDYgMTE3IDI5My4wOTNDMTE3IDMwNC4wMDMgMTI1IDMxMS40NjIgMTQxIDMxNS40N0wxNjkuNjY3IDMyMi40ODNDMTgzLjQ0NSAzMjUuNiAxOTMuNzc4IDMzMC43MjIgMjAwLjY2NyAzMzcuODQ3QzIwNy41NTUgMzQ0Ljc0OSAyMTEgMzU0LjIxMiAyMTEgMzY2LjIzNUMyMTEgMzc2LjQ3NyAyMDguMjIyIDM4NS40OTQgMjAyLjY2NiAzOTMuMjg3QzE5Ny4xMTEgNDAwLjg1NyAxODkuNDQ0IDQwNi43NTggMTc5LjY2NyA0MTAuOTg5QzE3MC4xMTEgNDE0Ljk5NiAxNTguNzc4IDQxNyAxNDUuNjY3IDQxN0MxMjYuNTU1IDQxNyAxMTEuMzMzIDQxMi4zMjUgOTkuOTk5NyA0MDIuOTczQzg4LjY2NjggMzkzLjYyMSA4MyAzODEuMTUzIDgzIDM2NS41NjdaIiBmaWxsPSJ3aGl0ZSIvPgo8cGF0aCBkPSJNMjMyLjI5MSA0MTNWMjUwLjA4MkMyNDQuNjg0IDI1NC42MTQgMjUwLjE0OCAyNTQuNjE0IDI2My4zNzEgMjUwLjA4MlY0MTNIMjMyLjI5MVpNMjQ3LjUgMjM5LjMxM0MyNDEuOTkgMjM5LjMxMyAyMzcuMTQgMjM3LjMxMyAyMzIuOTUyIDIzMy4zMTZDMjI4Ljk4NCAyMjkuMDk1IDIyNyAyMjQuMjA5IDIyNyAyMTguNjU2QzIyNyAyMTIuODgyIDIyOC45ODQgMjA3Ljk5NSAyMzIuOTUyIDIwMy45OTdDMjM3LjE0IDE5OS45OTkgMjQxLjk5IDE5OCAyNDcuNSAxOThDMjUzLjIzMSAxOTggMjU4LjA4IDE5OS45OTkgMjYyLjA0OSAyMDMuOTk3QzI2Ni4wMTYgMjA3Ljk5NSAyNjggMjEyLjg4MiAyNjggMjE4LjY1NkMyNjggMjI0LjIwOSAyNjYuMDE2IDIyOS4wOTUgMjYyLjA0OSAyMzMuMzE2QzI1OC4wOCAyMzcuMzEzIDI1My4yMzEgMjM5LjMxMyAyNDcuNSAyMzkuMzEzWiIgZmlsbD0id2hpdGUiLz4KPHBhdGggZD0iTTMxOS4zMzMgNDEzSDI4OFYyNDkuNjc2SDMxNlYyNzcuMjMzQzMxOS4zMzMgMjY4LjEwNCAzMjUuNzc4IDI2MC4zNjQgMzM0LjY2NyAyNTQuMzUyQzM0My43NzggMjQ4LjExNyAzNTQuNzc4IDI0NSAzNjcuNjY3IDI0NUMzODIuMTExIDI0NSAzOTQuMTEyIDI0OC44OTcgNDAzLjY2NyAyNTYuNjlDNDEzLjIyMiAyNjQuNDg0IDQxOS40NDQgMjc0LjgzNyA0MjIuMzM0IDI4Ny43NTJINDE2LjY2N0M0MTguODg5IDI3NC44MzcgNDI1IDI2NC40ODQgNDM1IDI1Ni42OUM0NDUgMjQ4Ljg5NyA0NTcuMzM0IDI0NSA0NzIgMjQ1QzQ5MC42NjYgMjQ1IDUwNS4zMzQgMjUwLjQ1NSA1MTYgMjYxLjM2NkM1MjYuNjY3IDI3Mi4yNzYgNTMyIDI4Ny4xOTUgNTMyIDMwNi4xMjFWNDEzSDUwMS4zMzNWMzEzLjgwNEM1MDEuMzMzIDMwMC44ODkgNDk4IDI5MC45ODEgNDkxLjMzMyAyODQuMDc4QzQ4NC44ODkgMjc2Ljk1MiA0NzYuMTExIDI3My4zOSA0NjUgMjczLjM5QzQ1Ny4yMjIgMjczLjM5IDQ1MC4zMzMgMjc1LjE3MSA0NDQuMzM0IDI3OC43MzRDNDM4LjU1NiAyODIuMDc0IDQzNCAyODYuOTcyIDQzMC42NjcgMjkzLjQzQzQyNy4zMzMgMjk5Ljg4NyA0MjUuNjY3IDMwNy40NTcgNDI1LjY2NyAzMTYuMTQxVjQxM0gzOTQuNjY3VjMxMy40NjlDMzk0LjY2NyAzMDAuNTU1IDM5MS40NDUgMjkwLjc1OCAzODUgMjg0LjA3OEMzNzguNTU2IDI3Ny4xNzUgMzY5Ljc3OCAyNzMuNzI0IDM1OC42NjcgMjczLjcyNEMzNTAuODg5IDI3My43MjQgMzQ0IDI3NS41MDUgMzM4IDI3OS4wNjhDMzMyLjIyMiAyODIuNDA4IDMyNy42NjcgMjg3LjMwNyAzMjQuMzMzIDI5My43NjNDMzIxIDI5OS45OTggMzE5LjMzMyAzMDcuNDU3IDMxOS4zMzMgMzE2LjE0MVY0MTNaIiBmaWxsPSJ3aGl0ZSIvPgo8L2c+CjxkZWZzPgo8Y2xpcFBhdGggaWQ9ImNsaXAwXzExNTlfMzEzIj4KPHJlY3Qgd2lkdGg9IjYxNiIgaGVpZ2h0PSI2MTYiIGZpbGw9IndoaXRlIi8+CjwvY2xpcFBhdGg+CjwvZGVmcz4KPC9zdmc+&logoColor=white" alt="Sim.ai"></a>

### Self-hosted: NPM Package

```bash
npx simstudio
```
→ http://localhost:3000

#### Note
Docker must be installed and running on your machine.

#### Options

| Flag | Description |
|------|-------------|
| `-p, --port <port>` | Port to run Sim on (default `3000`) |
| `--no-pull` | Skip pulling latest Docker images |

### Self-hosted: Docker Compose

```bash
git clone https://github.com/simstudioai/sim.git && cd sim
docker compose -f docker-compose.prod.yml up -d
```

Open [http://localhost:3000](http://localhost:3000)

Sim also supports local models via [Ollama](https://ollama.ai) and [vLLM](https://docs.vllm.ai/) — see the [Docker self-hosting docs](https://docs.sim.ai/self-hosting/docker) for setup details.

### Self-hosted: Manual Setup

**Requirements:** [Bun](https://bun.sh/), [Node.js](https://nodejs.org/) v20+, PostgreSQL 12+ with [pgvector](https://github.com/pgvector/pgvector)

1. Clone and install:

```bash
git clone https://github.com/simstudioai/sim.git
cd sim
bun install
bun run prepare  # Set up pre-commit hooks
```

2. Set up PostgreSQL with pgvector:

```bash
docker run --name simstudio-db -e POSTGRES_PASSWORD=your_password -e POSTGRES_DB=simstudio -p 5432:5432 -d pgvector/pgvector:pg17
```

Or install manually via the [pgvector guide](https://github.com/pgvector/pgvector#installation).

3. Configure environment:

```bash
cp apps/sim/.env.example apps/sim/.env
# Create your secrets
perl -i -pe "s/your_encryption_key/$(openssl rand -hex 32)/" apps/sim/.env
perl -i -pe "s/your_internal_api_secret/$(openssl rand -hex 32)/" apps/sim/.env
perl -i -pe "s/your_api_encryption_key/$(openssl rand -hex 32)/" apps/sim/.env
# DB configs for migration
cp packages/db/.env.example packages/db/.env
# Edit both .env files to set DATABASE_URL="postgresql://postgres:your_password@localhost:5432/simstudio"
```

4. Run migrations:

```bash
cd packages/db && bun run db:migrate
```

5. Start development servers:

```bash
bun run dev:full  # Starts Next.js app and realtime socket server
```

Or run separately: `bun run dev` (Next.js) and `cd apps/sim && bun run dev:sockets` (realtime).

## Copilot API Keys

Copilot is a Sim-managed service. To use Copilot on a self-hosted instance:

- Go to https://sim.ai → Settings → Copilot and generate a Copilot API key
- Set `COPILOT_API_KEY` environment variable in your self-hosted apps/sim/.env file to that value

## Environment Variables

See the [environment variables reference](https://docs.sim.ai/self-hosting/environment-variables) for the full list, or [`apps/sim/.env.example`](apps/sim/.env.example) for defaults.

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
- **Background Jobs**: [Trigger.dev](https://trigger.dev/)
- **Remote Code Execution**: [E2B](https://www.e2b.dev/)

## Contributing

We welcome contributions! Please see our [Contributing Guide](.github/CONTRIBUTING.md) for details.

## License

This project is licensed under the Apache License 2.0 - see the [LICENSE](LICENSE) file for details.

<p align="center">Made with ❤️ by the Sim Team</p>
