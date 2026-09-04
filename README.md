<p align="center">
  <a href="https://sim.ai" target="_blank" rel="noopener noreferrer"><img src="https://img.shields.io/badge/Sim-sim.ai-3B3B3B?labelColor=1A1A1A" alt="Sim.ai"></a>
  <a href="https://docs.sim.ai" target="_blank" rel="noopener noreferrer"><img src="https://img.shields.io/badge/Docs-Read-E6E6E6?labelColor=C3C3C3&color=E6E6E6" alt="Documentation"></a>
  <a href="https://join.slack.com/t/sim-ott9864/shared_invite/zt-43lp8tc5v-0qrrqHGBKUsvQlpoouH~TA" target="_blank" rel="noopener noreferrer"><img src="https://img.shields.io/badge/Slack-Join-E6E6E6?logo=slack&logoColor=1A1A1A&labelColor=C3C3C3&color=E6E6E6" alt="Slack"></a>
  <a href="https://x.com/simdotai" target="_blank" rel="noopener noreferrer"><img src="https://img.shields.io/badge/X-%40simdotai-525252?logo=x&logoColor=white&labelColor=1A1A1A" alt="X"></a>
</p>

<p align="center">
  <a href="https://deepwiki.com/simstudioai/sim" target="_blank" rel="noopener noreferrer"><img src="https://img.shields.io/badge/Ask-DeepWiki-E6E6E6?labelColor=C3C3C3&color=E6E6E6" alt="Ask DeepWiki"></a>
  <a href="https://cursor.com/link/prompt?text=Help%20me%20set%20up%20Sim%20locally.%20Follow%20these%20steps%3A%0A%0A1.%20First%2C%20verify%20Docker%20is%20installed%20and%20running%3A%0A%20%20%20docker%20--version%0A%20%20%20docker%20info%0A%0A2.%20Clone%20the%20repository%3A%0A%20%20%20git%20clone%20https%3A%2F%2Fgithub.com%2Fsimstudioai%2Fsim.git%0A%20%20%20cd%20sim%0A%0A3.%20Generate%20required%20secrets%20%28the%20stack%20will%20not%20start%20without%20them%29%3A%0A%20%20%20cat%20%3E%20.env%20%3C%3C%20EOF%0A%20%20%20BETTER_AUTH_SECRET%3D%24%28openssl%20rand%20-hex%2032%29%0A%20%20%20ENCRYPTION_KEY%3D%24%28openssl%20rand%20-hex%2032%29%0A%20%20%20INTERNAL_API_SECRET%3D%24%28openssl%20rand%20-hex%2032%29%0A%20%20%20CRON_SECRET%3D%24%28openssl%20rand%20-hex%2032%29%0A%20%20%20EOF%0A%0A4.%20Start%20the%20services%20with%20Docker%20Compose%3A%0A%20%20%20docker%20compose%20-f%20docker-compose.prod.yml%20up%20-d%0A%0A4.%20Wait%20for%20all%20containers%20to%20be%20healthy%20(this%20may%20take%201-2%20minutes)%3A%0A%20%20%20docker%20compose%20-f%20docker-compose.prod.yml%20ps%0A%0A5.%20Verify%20the%20app%20is%20accessible%20at%20http%3A%2F%2Flocalhost%3A3000%0A%0AIf%20there%20are%20any%20errors%2C%20help%20me%20troubleshoot%20them.%20Common%20issues%3A%0A-%20Port%203000%2C%203002%2C%20or%205432%20already%20in%20use%0A-%20Docker%20not%20running%0A-%20Insufficient%20memory%20(needs%2012GB%2B%20RAM)%0A%0AFor%20local%20AI%20models%20with%20Ollama%2C%20use%20this%20instead%20of%20step%203%3A%0A%20%20%20docker%20compose%20-f%20docker-compose.ollama.yml%20--profile%20setup%20up%20-d"><img src="https://img.shields.io/badge/Set%20Up%20with-Cursor-E6E6E6?logo=cursor&logoColor=1A1A1A&labelColor=C3C3C3&color=E6E6E6" alt="Set Up with Cursor"></a>
</p>

<p align="center">
  <a href="https://sim.ai" target="_blank" rel="noopener noreferrer">
    <img src="apps/sim/public/static/readme-banner.png" alt="Sim — Integrate, Context, Build, and Monitor AI agents" width="100%"/>
  </a>
</p>

<p align="center">A workspace to build, deploy and manage AI agents and workflows.</p>

## Quickstart

### Cloud-hosted: [sim.ai](https://sim.ai)

<a href="https://sim.ai" target="_blank" rel="noopener noreferrer"><img src="https://img.shields.io/badge/Open-sim.ai-3B3B3B?labelColor=1A1A1A" alt="Open sim.ai"></a>

### Self-hosted

```bash
npx sim-setup
```

Open [http://localhost:3000](http://localhost:3000)

### Desktop

<a href="https://sim.ai/api/desktop/update/download" target="_blank" rel="noopener noreferrer"><img src="https://img.shields.io/badge/Download-macOS-3B3B3B?logo=apple&logoColor=white&labelColor=1A1A1A" alt="Download Sim for macOS"></a>

Signed and notarized, universal for Apple Silicon and Intel, macOS 12+. That link is never version-pinned — it resolves to the newest release at request time, so it does not need updating. It resolves against sim.ai; a self-hosted install serves the same endpoint on its own origin, so use `https://<your-sim-url>/api/desktop/update/download` to get the build your deployment offers. See the [desktop docs](https://docs.sim.ai/desktop).

<p align="center">
  <img src="apps/sim/public/static/readme-platform.png" alt="The Sim platform — chat on the left, the visual workflow builder on the right" width="100%"/>
</p>

## Capabilities

- Connect 1,000+ integrations and every major LLM
- Add Slack, Notion, HubSpot, Salesforce, databases, and more
- Build agents visually, conversationally, or with code
- Ingest files, knowledge bases, and structured table data
- Monitor runs, logs, schedules, and workflow activity

## One workspace, every surface

<p align="center">Chat and workflows are just the start — tables, files, and knowledge all live in the same workspace, in the browser or on your desktop.</p>

<table>
  <tr>
    <td width="50%" valign="top">
      <img src="apps/sim/public/static/readme-tables.png" alt="Tables in Sim — structured data your agents can query" width="100%"/>
      <p align="center"><b>Tables</b> — a database, built in</p>
    </td>
    <td width="50%" valign="top">
      <img src="apps/sim/public/static/readme-files.png" alt="Files in Sim — documents for your team and every agent" width="100%"/>
      <p align="center"><b>Files</b> — one store for your team and every agent</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <img src="apps/sim/public/static/readme-knowledge.png" alt="Knowledge bases in Sim — synced docs your agents can search" width="100%"/>
      <p align="center"><b>Knowledge</b> — your agents' memory</p>
    </td>
    <td width="50%" valign="top">
      <img src="apps/sim/public/static/readme-desktop.png" alt="Sim Desktop — Chat on the left, the built-in browser on the right" width="100%"/>
      <p align="center"><b>Desktop</b> — a built-in browser and terminal your agents can drive</p>
    </td>
  </tr>
</table>

## Self-hosting

**Requirements:** [Node.js 20+](https://nodejs.org/) and [Docker](https://www.docker.com/).

`npx sim-setup` is an interactive wizard that creates a small `sim/` deployment directory, provisions the database, generates secrets, writes `.env`, connects a Chat API key, and starts the published Sim images with Docker Compose. It does not clone the repository.

When it finishes, open [http://localhost:3000](http://localhost:3000).

Inside a cloned Sim repository, run `bun run sim-setup` to unlock the source-only local development and Kubernetes modes.

Reconfigure an optional capability without rerunning the full wizard:

```bash
npx sim-setup config
npx sim-setup add email
npx sim-setup add storage
npx sim-setup add sandbox
npx sim-setup add jobs
npx sim-setup add cache
npx sim-setup add knowledge
npx sim-setup add chat
npx sim-setup add llm
npx sim-setup add integration slack
```

`npx sim-setup config` detects the effective local-dev, Docker Compose, or current-context
Helm configuration and reports configured, missing, or invalid capabilities and OAuth
integrations without printing credential values. This is separate from `npx sim-setup status`,
which reports whether installed services are running and healthy.

Manage your install from its directory:

```bash
npx sim-setup start | stop | restart   # bring your install up / down / cycle
npx sim-setup update                   # pull and apply Compose images
npx sim-setup status                   # what's installed and healthy
npx sim-setup logs                     # follow logs
npx sim-setup doctor                   # diagnose configuration problems
npx sim-setup down                     # remove containers (data kept)
npx sim-setup reset                    # archive .env and wipe managed data
```

The setup package detects how you're running and acts accordingly. Use `--dir <path>` to create or manage a deployment somewhere other than `./sim`.

Sim also supports local models via [Ollama](https://ollama.ai) and [vLLM](https://docs.vllm.ai/). See the [self-hosting docs](https://docs.sim.ai/self-hosting/docker) for details.

## Chat API Keys

Chat is a Sim-managed service. `npx sim-setup` connects a Chat API key for you — sign in when it opens your browser and the key is stored automatically. To view, create, or revoke keys later, go to [sim.ai/selfhost/settings/chat-keys](https://sim.ai/selfhost/settings/chat-keys).

## Environment Variables

See the [environment variables reference](https://docs.sim.ai/self-hosting/environment-variables) for the full list, or [`apps/sim/.env.example`](apps/sim/.env.example) for defaults.

## Tech Stack

<details>
<summary>Next.js · Bun · PostgreSQL · Drizzle · Better Auth · Tailwind — and the rest of the stack</summary>

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

</details>

## Contributing

We welcome contributions! Please see our [Contributing Guide](.github/CONTRIBUTING.md) for details.

## License

This project is licensed under the Apache License 2.0 - see the [LICENSE](LICENSE) file for details.

<p align="center">
  <img src="apps/sim/public/static/readme-built-by-sim-team.png" alt="Built by the Sim team in San Francisco" width="100%"/>
</p>
