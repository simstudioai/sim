# OpenCode Service

This service runs `opencode serve` for Sim. It backs the optional `OpenCode` workflow block and can also be queried by internal tooling against one or more cloned repositories.

## What it provides

- HTTP service on `http://opencode:4096` inside Docker, with an optional published host port for local development
- HTTP basic auth via `OPENCODE_SERVER_USERNAME` and `OPENCODE_SERVER_PASSWORD`
- Persistent OpenCode storage in `~/.local/share/opencode`
- Optional multi-repo sync into `/app/repos`
- Global read-only OpenCode permissions

## Required configuration

At minimum, set:

```env
OPENCODE_REPOSITORY_ROOT=/app/repos
OPENCODE_SERVER_USERNAME=opencode
OPENCODE_SERVER_PASSWORD=change-me
OPENCODE_REPOS=https://github.com/octocat/Hello-World.git
GEMINI_API_KEY=your-gemini-key
```

Notes:

- The UI block is intentionally hidden until `NEXT_PUBLIC_OPENCODE_ENABLED=true` is set on the Sim app.
- `OPENCODE_REPOSITORY_ROOT` defaults to `/app/repos` and must match the path Sim uses when it resolves repository directories.
- `OPENCODE_SERVER_USERNAME` defaults to `opencode` in the optional compose overlays if omitted.
- `docker-compose.opencode.local.yml` defaults `OPENCODE_SERVER_PASSWORD` to `dev-opencode-password`, but setting it explicitly is safer and avoids app/container credential drift.
- `docker-compose.opencode.yml` requires `OPENCODE_SERVER_PASSWORD` to be provided from the environment before `docker compose` starts.
- OpenCode needs at least one provider key to answer prompts:
  - `OPENAI_API_KEY`
  - `ANTHROPIC_API_KEY`
  - `GEMINI_API_KEY`
  - `GOOGLE_GENERATIVE_AI_API_KEY`
- In the optional compose overlays, `GOOGLE_GENERATIVE_AI_API_KEY` is automatically derived from `GEMINI_API_KEY` if not set explicitly.

## Configure repositories

Set `OPENCODE_REPOS` to a comma-separated list of HTTPS repository URLs.

```bash
OPENCODE_REPOS=https://github.com/org/ui-components,https://github.com/org/design-tokens
```

Azure Repos over HTTPS is also supported. Example:

```bash
OPENCODE_REPOS=https://dev.azure.com/org/project/_git/repo
```

Each repository is cloned into `${OPENCODE_REPOSITORY_ROOT:-/app/repos}/<repo-name>`. On restart, existing clones are updated with `git pull --ff-only`. A background cron sync retries every 15 minutes.

For private repositories, provide HTTPS credentials with one of these options:

- `GIT_USERNAME` and `GIT_TOKEN`
- `GITHUB_TOKEN` for GitHub HTTPS access

For Azure Repos, use `GIT_USERNAME` plus an Azure DevOps PAT in `GIT_TOKEN`. The container uses non-interactive `GIT_ASKPASS`, so it will not stop to ask for a password in the terminal during clone or pull.

If a clone or pull fails, the service logs the error and continues syncing the remaining repositories.

## Local development on the host

If you run `next dev` on the host instead of inside Docker, the app must reach OpenCode through the published host port.

Add this to `apps/sim/.env`:

```env
NEXT_PUBLIC_OPENCODE_ENABLED=true
OPENCODE_BASE_URL=http://127.0.0.1:4096
OPENCODE_REPOSITORY_ROOT=/app/repos
OPENCODE_SERVER_USERNAME=opencode
OPENCODE_SERVER_PASSWORD=change-me
```

Then load the same environment into your shell before starting the OpenCode container:

```bash
set -a
source apps/sim/.env
set +a
docker compose -f docker-compose.local.yml -f docker-compose.opencode.local.yml up -d --build opencode
```

This matters because `apps/sim/.env` configures the host-side Next.js app, but `docker compose` only sees variables present in the shell environment.

If Sim itself also runs in Docker, use the same local overlay without targeting just `opencode`:

```bash
docker compose -f docker-compose.local.yml -f docker-compose.opencode.local.yml up -d --build
```

## Verify the service

Verification differs slightly between local and production-style compose.

### Local compose

`docker-compose.opencode.local.yml` publishes `OPENCODE_PORT` to the host, so this should work from the host:

```bash
curl -u "$OPENCODE_SERVER_USERNAME:$OPENCODE_SERVER_PASSWORD" \
  http://127.0.0.1:${OPENCODE_PORT:-4096}/global/health
```

Create a session from the host:

```bash
curl -u "$OPENCODE_SERVER_USERNAME:$OPENCODE_SERVER_PASSWORD" \
  -H "Content-Type: application/json" \
  -d '{"title":"test"}' \
  http://127.0.0.1:${OPENCODE_PORT:-4096}/session
```

### Production-style compose

Production should use the base compose plus the OpenCode overlay:

```bash
docker compose -f docker-compose.prod.yml -f docker-compose.opencode.yml up -d --build
```

The overlay injects `NEXT_PUBLIC_OPENCODE_ENABLED`, `OPENCODE_BASE_URL`, `OPENCODE_PORT`, `OPENCODE_REPOSITORY_ROOT`, `OPENCODE_SERVER_USERNAME`, and `OPENCODE_SERVER_PASSWORD` into `simstudio`, so the app can authenticate against the internal OpenCode server without changing `docker-compose.prod.yml`.

If you prefer to run OpenCode in separate infrastructure, skip the overlay and set the same app variables directly on the Sim deployment. The external OpenCode runtime must expose project worktrees under the same `OPENCODE_REPOSITORY_ROOT` that Sim is configured to use.

OpenCode stays internal to the Docker network, so verify from another container:

```bash
docker compose -f docker-compose.prod.yml -f docker-compose.opencode.yml exec simstudio \
  curl -u "$OPENCODE_SERVER_USERNAME:$OPENCODE_SERVER_PASSWORD" \
  http://opencode:${OPENCODE_PORT:-4096}/global/health
```

Create a session:

```bash
docker compose -f docker-compose.prod.yml -f docker-compose.opencode.yml exec simstudio \
  curl -u "$OPENCODE_SERVER_USERNAME:$OPENCODE_SERVER_PASSWORD" \
  -H "Content-Type: application/json" \
  -d '{"title":"test"}' \
  http://opencode:${OPENCODE_PORT:-4096}/session
```

Useful runtime checks:

```bash
docker logs --tail 100 sim-opencode-1
docker exec sim-opencode-1 env | grep OPENCODE
docker exec sim-opencode-1 env | grep -E 'OPENAI|ANTHROPIC|GEMINI|GOOGLE_GENERATIVE'
```

Expected signals:

- `opencode server listening on http://0.0.0.0:4096`
- `[opencode-sync] Updated <repo-name>` or clone logs
- the same username/password and provider env vars you expect the app to use

Before accepting a deployment, validate the read-only permission config with a real prompt against a cloned repository. The check should confirm that OpenCode can still read files while `edit`, `bash`, and web-capable tools remain blocked. If the wildcard rule prevents normal reads, remove `permission."*": "deny"` and keep the explicit tool denies as the fallback.

## Repo-specific behavior

Each cloned repository can keep its own `AGENTS.md` and `opencode.json` at the repo root. OpenCode will use those when a future client targets that repository directory.

The SDK also supports injecting extra per-session context without triggering a reply by calling `session.prompt` with `noReply: true`. The current Sim block can evolve to use this for dynamic runtime instructions on top of repository-local configuration.

## Notes

- Session retention is not managed yet. OpenCode data persists until the `opencode_data` volume is pruned.
- The compose overlays are convenience wrappers. The app can also target any compatible external OpenCode deployment through `OPENCODE_BASE_URL`, the same server credentials, and the same `OPENCODE_REPOSITORY_ROOT`.
