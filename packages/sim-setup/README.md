# Sim Setup

`sim-setup` is the installer and management tool for a self-hosted
[Sim](https://sim.ai) deployment. Sim is a workspace for building, deploying,
and managing AI agents and workflows.

For an npm user, `sim-setup` creates a Docker Compose installation from published
Sim images. It generates the required secrets, writes the deployment files,
starts the containers, runs database migrations, and checks that the application
is healthy. It does not clone the Sim repository.

This package installs the Sim server. To manage workflows, tables, files, and
other resources in a running Sim workspace, use the separate
[`sim` CLI](https://www.npmjs.com/package/sim).

## Requirements

- Node.js 20 or newer
- Docker with the Compose plugin
- Ports `3000`, `3002`, and, by default, `5432` available
- At least 12 GB of system memory and 20 GB of free disk for a small installation

Allocate at least 8 GB of memory to Docker for reliable workflow execution.
Docker Desktop, OrbStack, Colima, and Docker Engine are supported as long as the
`docker` command can reach the daemon.

## Install and run

You normally do not need to install the package globally:

```bash
npx sim-setup
```

To install it globally instead:

```bash
npm install --global sim-setup
sim-setup
```

The examples below use `npx`; omit it if you installed the package globally.

The default standalone setup creates a `sim` directory under the current
directory:

```text
sim/
├── .env
├── .sim-setup.json
└── docker-compose.prod.yml
```

Use `--dir` to choose an explicit location:

```bash
npx sim-setup --dir /srv/sim
```

When setup finishes, open [http://localhost:3000](http://localhost:3000) and
create the first account.

## What the setup wizard does

The wizard:

1. checks Docker, available ports, memory, and disk space
2. creates or reuses the installation directory
3. generates authentication, encryption, internal API, and scheduler secrets
4. optionally connects Sim Chat and model providers
5. writes `.env` and the managed production Compose file
6. starts PostgreSQL, Redis, the Sim application, realtime, and scheduled jobs
7. runs migrations and waits for the health checks to pass

Choose **Quick** for sensible defaults and the fewest questions. Choose
**Custom** to configure additional options such as object storage, email,
sign-in providers, security settings, and self-hosted feature flags. Skip the
prompt with:

```bash
npx sim-setup --quick
```

The wizard detects an existing installation. Re-running it lets you keep and
check the current configuration, review and update it, or archive the current
`.env` and build a new configuration. If setup fails partway through, fix the
reported problem and run the same command again; completed configuration is
preserved.

## Chat and model access

Sim can run without the optional Chat API key. If you skip Chat setup, the
wizard hides the Chat module instead of leaving it enabled but unusable. Connect
or replace the key later with:

```bash
npx sim-setup add chat
npx sim-setup start
```

Agent blocks also need access to a model provider. Configure provider keys in a
workspace in the Sim UI, pass supported keys such as `OPENAI_API_KEY` or
`ANTHROPIC_API_KEY` into the setup environment, or add deployment-wide model
configuration later:

```bash
npx sim-setup add llm
npx sim-setup start
```

For Docker Compose installations, `add` updates `.env` but does not recreate the
application container. Run `npx sim-setup start` afterward to apply the changed
environment. `restart` only restarts containers with their current configuration.

## Manage the installation

Run commands from the installation directory or pass `--dir <path>` to target a
specific installation.

| Command | What it does |
| --- | --- |
| `npx sim-setup status` | Show detected installations, container state, and app health |
| `npx sim-setup logs` | Follow the last 100 lines of Docker Compose logs |
| `npx sim-setup start` | Start or reconcile the containers; data is kept |
| `npx sim-setup stop` | Stop containers without removing them |
| `npx sim-setup restart` | Restart the current containers |
| `npx sim-setup update` | Refresh the managed Compose file, pull images, recreate services, and run migrations |
| `npx sim-setup down` | Remove containers but keep data volumes |
| `npx sim-setup reset` | Archive `.env`, remove containers, and delete managed data volumes |

`down` and `reset` are deliberately different. Use `down` when you want to
remove containers and bring the same installation back later. `reset` is a
destructive fresh start and asks for confirmation before deleting data.

### Check configuration

`config` reports which effective configuration sources, capabilities, and OAuth
integrations were detected. It does not print secret values:

```bash
npx sim-setup config
```

`doctor` validates environment files, required values, cross-service
consistency, and live dependencies:

```bash
npx sim-setup doctor
npx sim-setup doctor --fix
npx sim-setup doctor --json
```

Use `config` to answer “what is configured?” and `status` to answer “what is
running and healthy?”

### Install the desktop app

`desktop` resolves the macOS installer from your own deployment and prints the
server URL to enter in the app:

```bash
npx sim-setup desktop
npx sim-setup desktop --url https://sim.example.com
npx sim-setup desktop --no-open
```

The desktop app is not tied to sim.ai — it bakes in only a default server, and
every Sim deployment already serves `/api/desktop/update/download` and the
update feed installed apps poll. Install the signed build, then point it at your
deployment with **Sim → Server…**. Nothing has to be built or signed by you.

### Add or change capabilities

Configure one capability without walking through the complete wizard:

```bash
npx sim-setup add email
npx sim-setup add storage
npx sim-setup add sandbox
npx sim-setup add jobs
npx sim-setup add cache
npx sim-setup add knowledge
npx sim-setup add knowledge-embeddings
npx sim-setup add chat
npx sim-setup add llm
npx sim-setup add integration slack
```

Run `npx sim-setup start` after changing a Docker Compose capability so the app
container receives the new environment.

## Updating

Update a Docker Compose installation with:

```bash
npx sim-setup update
npx sim-setup status
```

The update command keeps Docker volumes, applies the current managed Compose
file, pulls the version selected by `SIM_VERSION`, and runs migrations. If
`SIM_VERSION` is unset, the deployment tracks `latest`.

For production, pin an explicit version, back up the database first, and read
the [upgrade guide](https://docs.sim.ai/platform/self-hosting/upgrades). Docker
Compose updates briefly interrupt the application because Compose does not
provide rolling deployments.

## Files, secrets, and data

The generated `.env` contains credentials and encryption keys. It is written
with owner-only permissions and must not be committed to source control.

Back up `.env` securely outside the server before using the deployment for real
data. In particular, `ENCRYPTION_KEY` and `API_ENCRYPTION_KEY` protect stored
credentials and API keys. A database backup restored without the matching keys
contains data that Sim cannot decrypt.

PostgreSQL data lives in a Docker volume. These commands preserve it:

- `start`
- `stop`
- `restart`
- `update`
- `down`

`reset` deletes managed volumes. It archives `.env` beside the installation
before doing so, but that local archive is not a substitute for an off-machine
backup.

The default local file-storage fallback is different: uploaded files live inside
the application container, not in a managed volume. They can be lost when the
container is removed or recreated, including during `down` or `update`.
Configure object storage before keeping files you care about.

## Production deployments

The generated Compose installation is suitable for local evaluation and a
single-node deployment. Before exposing it publicly, configure at least:

- a public application URL and TLS reverse proxy
- database and `.env` backups
- durable object storage for uploaded files
- email delivery for invitations and email-based authentication
- OAuth applications for integrations you plan to use
- a pinned Sim version and an upgrade procedure

See the [Docker deployment guide](https://docs.sim.ai/platform/self-hosting/docker)
and the complete [self-hosting documentation](https://docs.sim.ai/platform/self-hosting).

## Working from the Sim source repository

Inside a cloned Sim repository, use:

```bash
bun run sim-setup
```

The source checkout adds local development and Kubernetes modes:

```bash
bun run sim-setup --mode dev
bun run sim-setup --mode k8s
```

Standalone npm use supports Docker Compose mode only. Development and Kubernetes
modes need source-only files and are rejected outside a complete checkout.

## Help

```bash
npx sim-setup --help
npx sim-setup --version
```

Further documentation:

- [Self-hosting overview](https://docs.sim.ai/platform/self-hosting)
- [Docker Compose](https://docs.sim.ai/platform/self-hosting/docker)
- [Environment variables](https://docs.sim.ai/platform/self-hosting/environment-variables)
- [Upgrades](https://docs.sim.ai/platform/self-hosting/upgrades)
- [Troubleshooting](https://docs.sim.ai/platform/self-hosting/troubleshooting)
- [Verification checklist](https://docs.sim.ai/platform/self-hosting/verify)

## License

Apache-2.0
