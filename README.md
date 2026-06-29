<p align="center">
  <a href="https://sim.ai" target="_blank" rel="noopener noreferrer"><img src="https://img.shields.io/badge/Sim-sim.ai-3B3B3B?labelColor=1A1A1A" alt="Sim.ai"></a>
  <a href="https://docs.sim.ai" target="_blank" rel="noopener noreferrer"><img src="https://img.shields.io/badge/Docs-Read-E6E6E6?labelColor=C3C3C3&color=E6E6E6" alt="Documentation"></a>
  <a href="https://discord.gg/Hr4UWYEcTT" target="_blank" rel="noopener noreferrer"><img src="https://img.shields.io/badge/Discord-Join-E6E6E6?logo=discord&logoColor=1A1A1A&labelColor=C3C3C3&color=E6E6E6" alt="Discord"></a>
  <a href="https://x.com/simdotai" target="_blank" rel="noopener noreferrer"><img src="https://img.shields.io/badge/X-%40simdotai-525252?logo=x&logoColor=white&labelColor=1A1A1A" alt="X"></a>
</p>

<p align="center">
  <a href="https://deepwiki.com/simstudioai/sim" target="_blank" rel="noopener noreferrer"><img src="https://img.shields.io/badge/Ask-DeepWiki-E6E6E6?labelColor=C3C3C3&color=E6E6E6" alt="Ask DeepWiki"></a>
  <a href="https://cursor.com/link/prompt?text=Help%20me%20set%20up%20Sim%20locally.%20Follow%20these%20steps%3A%0A%0A1.%20First%2C%20verify%20Docker%20is%20installed%20and%20running%3A%0A%20%20%20docker%20--version%0A%20%20%20docker%20info%0A%0A2.%20Clone%20the%20repository%3A%0A%20%20%20git%20clone%20https%3A%2F%2Fgithub.com%2Fsimstudioai%2Fsim.git%0A%20%20%20cd%20sim%0A%0A3.%20Start%20the%20services%20with%20Docker%20Compose%3A%0A%20%20%20docker%20compose%20-f%20docker-compose.prod.yml%20up%20-d%0A%0A4.%20Wait%20for%20all%20containers%20to%20be%20healthy%20(this%20may%20take%201-2%20minutes)%3A%0A%20%20%20docker%20compose%20-f%20docker-compose.prod.yml%20ps%0A%0A5.%20Verify%20the%20app%20is%20accessible%20at%20http%3A%2F%2Flocalhost%3A3000%0A%0AIf%20there%20are%20any%20errors%2C%20help%20me%20troubleshoot%20them.%20Common%20issues%3A%0A-%20Port%203000%2C%203002%2C%20or%205432%20already%20in%20use%0A-%20Docker%20not%20running%0A-%20Insufficient%20memory%20(needs%2012GB%2B%20RAM)%0A%0AFor%20local%20AI%20models%20with%20Ollama%2C%20use%20this%20instead%20of%20step%203%3A%0A%20%20%20docker%20compose%20-f%20docker-compose.ollama.yml%20--profile%20setup%20up%20-d"><img src="https://img.shields.io/badge/Set%20Up%20with-Cursor-E6E6E6?logo=cursor&logoColor=1A1A1A&labelColor=C3C3C3&color=E6E6E6" alt="Set Up with Cursor"></a>
</p>

<p align="center">
  <a href="https://sim.ai" target="_blank" rel="noopener noreferrer">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="apps/sim/public/logo/readme-logotype-light.svg">
      <source media="(prefers-color-scheme: light)" srcset="apps/sim/public/logo/readme-logotype-dark.svg">
      <img src="apps/sim/public/logo/readme-logotype-dark.svg" alt="Sim Logo" width="210"/>
    </picture>
  </a>
</p>

<h1 align="center">Your workflow&#8202;<img src="apps/sim/public/static/readme-cycle-loader.gif" alt="" width="56"/>&#8202;agent<br>for solving automations.</h1>

<p align="center">
  <img src="apps/sim/public/static/readme-platform-banner.png" alt="A workspace to build, deploy and manage AI agents and workflows" width="800"/>
</p>

<p align="center">A workspace to build, deploy and manage AI agents and workflows.</p>

## Quickstart

### Cloud-hosted: [sim.ai](https://sim.ai)

<a href="https://sim.ai" target="_blank" rel="noopener noreferrer"><img src="https://img.shields.io/badge/Open-sim.ai-3B3B3B?labelColor=1A1A1A" alt="Open sim.ai"></a>

### Self-hosted

```bash
npx simstudio
```

Open [http://localhost:3000](http://localhost:3000)

Docker must be installed and running. Use `-p, --port <port>` to run Sim on a different port, or `--no-pull` to skip pulling the latest Docker images.

<p align="center">
  <img src="apps/sim/public/static/readme-feature-row.svg" alt="Integrate, Ingest, Build, and Monitor" width="800"/>
</p>

<p align="center">
  <img src="apps/sim/public/static/readme-tour.gif" alt="A tour of Sim: start a chat to build an agent, connect Slack and other integrations, add a knowledge base, build the workflow visually, deploy it, and monitor runs in the logs" width="800"/>
</p>

## Capabilities

- Connect 1,000+ integrations and every major LLM
- Add Slack, Notion, HubSpot, Salesforce, databases, and more
- Build agents visually, conversationally, or with code
- Ingest files, knowledge bases, and structured table data
- Monitor runs, logs, schedules, and workflow activity

## Self-hosting

### Docker Compose

```bash
git clone https://github.com/simstudioai/sim.git && cd sim
docker compose -f docker-compose.prod.yml up -d
```

Open [http://localhost:3000](http://localhost:3000)

Sim also supports local models via [Ollama](https://ollama.ai) and [vLLM](https://docs.vllm.ai/). See the [Docker self-hosting docs](https://docs.sim.ai/self-hosting/docker) for setup details.

### Manual Setup

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

## Chat API Keys

Chat is a Sim-managed service. To use Chat on a self-hosted instance:

- Go to https://sim.ai → Settings → Chat keys and generate a Chat API key
- Set `COPILOT_API_KEY` environment variable in your self-hosted apps/sim/.env file to that value

## Environment Variables

See the [environment variables reference](https://docs.sim.ai/self-hosting/environment-variables) for the full list, or [`apps/sim/.env.example`](apps/sim/.env.example) for defaults.

## Tech Stack

- **Framework**: [Next.js](https://nextjs.org/) (App Router)
- **Runtime**: [Bun](https://bun.sh/)
- **Database**: PostgreSQL with [Drizzle ORM](https://orm.drizzle.team)
- **Authentication**: [Better Auth](https://better-auth.com)
- **Schema Validation**: [Zod](https://zod.dev)
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

<p align="center">
  <img src="apps/sim/public/static/readme-built-by-sim-team.png" alt="Built by the Sim team in San Francisco" width="800"/>
</p>
