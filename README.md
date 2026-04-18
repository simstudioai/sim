

The open-source platform to build AI agents and run your agentic workforce. Connect 1,000+ integrations and LLMs to orchestrate agentic workflows.





### Build Workflows with Ease

Design agent workflows visually on a canvas—connect agents, tools, and blocks, then run them instantly.



### Supercharge with Copilot

Leverage Copilot to generate nodes, fix errors, and iterate on flows directly from natural language.



### Integrate Vector Databases

Upload documents to a vector store and let agents answer questions grounded in your specific content.



## Quickstart

### Cloud-hosted: [sim.ai](https://sim.ai)



### Self-hosted: NPM Package

```bash
npx simstudio
```

→ [http://localhost:3000](http://localhost:3000)

#### Note

Docker must be installed and running on your machine.

#### Options


| Flag                | Description                         |
| ------------------- | ----------------------------------- |
| `-p, --port <port>` | Port to run Sim on (default `3000`) |
| `--no-pull`         | Skip pulling latest Docker images   |


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

1. Set up PostgreSQL with pgvector:

```bash
docker run --name simstudio-db -e POSTGRES_PASSWORD=your_password -e POSTGRES_DB=simstudio -p 5432:5432 -d pgvector/pgvector:pg17
```

Or install manually via the [pgvector guide](https://github.com/pgvector/pgvector#installation).

1. Configure environment:

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

1. Run migrations:

```bash
cd packages/db && bun run db:migrate
```

1. Start development servers:

```bash
bun run dev:full  # Starts Next.js app and realtime socket server
```

Or run separately: `bun run dev` (Next.js) and `cd apps/sim && bun run dev:sockets` (realtime).

## Copilot API Keys

Copilot is a Sim-managed service. To use Copilot on a self-hosted instance:

- Go to [https://sim.ai](https://sim.ai) → Settings → Copilot and generate a Copilot API key
- Set `COPILOT_API_KEY` environment variable in your self-hosted apps/sim/.env file to that value

## Environment Variables

See the [environment variables reference](https://docs.sim.ai/self-hosting/environment-variables) for the full list, or `[apps/sim/.env.example](apps/sim/.env.example)` for defaults.

## Tech Stack

- **Framework**: [Next.js](https://nextjs.org/) (App Router)
- **Runtime**: [Bun](https://bun.sh/)
- **Database**: PostgreSQL with [Drizzle ORM](https://orm.drizzle.team)
- **Authentication**: [Better Auth](https://better-auth.com)
- **UI**: [Shadcn](https://ui.shadcn.com/), [Tailwind CSS](https://tailwindcss.com)
- **Streaming Markdown**: [Streamdown](https://github.com/vercel/streamdown)
- **State Management**: [Zustand](https://zustand-demo.pmnd.rs/), [TanStack Query](https://tanstack.com/query)
- **Flow Editor**: [ReactFlow](https://reactflow.dev/)
- **Docs**: [Fumadocs](https://fumadocs.vercel.app/)
- **Monorepo**: [Turborepo](https://turborepo.org/)
- **Realtime**: [Socket.io](https://socket.io/)
- **Background Jobs**: [Trigger.dev](https://trigger.dev/)
- **Remote Code Execution**: [E2B](https://www.e2b.dev/)
- **Isolated Code Execution**: [isolated-vm](https://github.com/laverdet/isolated-vm)

## Contributing

We welcome contributions! Please see our [Contributing Guide](.github/CONTRIBUTING.md) for details.

## License

This project is licensed under the Apache License 2.0 - see the [LICENSE](LICENSE) file for details.

Made with ❤️ by the Sim Team