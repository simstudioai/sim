# Sim CLI

`sim` is the command-line client for [Sim](https://sim.ai), a workspace for
building, deploying, and managing AI agents and workflows.

Use the CLI to work with an existing Sim account or self-hosted deployment from
your terminal. You can run workflows, inspect logs, query tables, manage files
and knowledge bases, and configure workspace resources. The CLI does not install
or run Sim itself; see the
[self-hosting guide](https://docs.sim.ai/platform/self-hosting/docker) if you need
to set up a Sim deployment.

## Install

The CLI requires Node.js 20 or newer.

```bash
npm install --global sim
sim --version
```

You can also run a command without installing the package globally:

```bash
npx sim --help
```

## Get started

Sign in to the default profile:

```bash
sim login
```

With no `--method`, the CLI prefers OAuth when the server offers it and a local
browser callback is possible. It selects API-key pairing for remote terminals
or servers without OAuth. Use `sim login --method oauth` to require OAuth;
if the server does not offer it, login fails without creating an API key.

OAuth login opens Sim in your browser, asks you to approve the requested access,
and receives the one-time authorization code on a loopback callback. It stores
a short-lived OAuth login that renews automatically and can be revoked under
**Settings → General → Authorized apps**. Choose a default workspace afterward with
`sim configure --set-workspace <id>`.

Use `--no-browser` with either method to print the approval URL without opening
it. OAuth still needs the browser to reach the CLI's loopback callback. Over SSH
or in a container without port forwarding, use
`sim login --method api-key --no-browser` to approve from another device and
create a permanent personal API key. `--method api-key` creates a new key;
set `SIM_API_KEY` to supply an existing one.

Pairing requires a server that supports `platform` API keys. Upgrade older
deployments that only issue `copilot` keys before login; they are not compatible
with the platform CLI. OAuth discovery does not check pairing compatibility.

Check the active profile and verify that its endpoint, credential, and workspace
work together:

```bash
sim whoami
```

This also reports whether the active credential is an OAuth login or an API
key. Some administrative operations require a personal credential.

Then list and run workflows:

```bash
sim workflows list
sim workflows run <workflowId> --input '{"ticketId":"T-4821"}'
```

A workflow must be deployed before it can run:

```bash
sim workflows deploy <workflowId>
```

Workflow, knowledge-base, and workspace IDs are UUIDs. Table IDs start with
`tbl_`; file IDs start with `wf_`. Despite the prefix, `wf_` identifies a file,
not a workflow.

## Profiles

A profile is a named CLI configuration. It determines:

- which Sim deployment to use
- which stored login or API key to authenticate with
- which workspace to target by default
- how command output is formatted

If you do not specify a profile, the CLI uses `default`. Select another profile
with `--profile`, its short form `-P`, or `SIM_PROFILE`:

```bash
sim workflows list --profile production
sim -P production logs list
SIM_PROFILE=production sim tables list
```

Unknown profile names fail with the configured profile list and a suggested
match when available. `login` and `configure` are the exceptions because they
can create a new profile.

There are two common ways to create profiles.

### Use one login with several workspaces

After `sim login`, create another profile that shares the active profile's
credential but has its own default workspace:

```bash
sim workspaces list
sim profile add acme --workspace <workspaceId>
sim --profile acme whoami
```

If you omit `--workspace` in an interactive terminal, the CLI asks you to choose
one. The new profile stores an `auth_profile` reference to the active login; it
does not copy the credential.

### Use a separate account or deployment

Run `login` with a new profile name. Add `--endpoint` when the profile should use
a self-hosted or local deployment:

```bash
sim login --profile work
sim login --profile local --endpoint http://localhost:3000
```

Each of these profiles stores its own login. The endpoint selected during login
is saved with the profile.

### View and change profiles

```bash
sim profiles
sim configure --profile work
sim configure --profile work --set-workspace <workspaceId>
sim configure --profile work --set-output json
sim configure --profile local --set-endpoint http://localhost:3000
sim whoami --profile work
```

`sim profiles` marks the active profile with `*`. Running `sim configure` with
no setting flags prints the saved settings for that profile.

Non-secret settings are stored in `~/.sim/config`. OAuth tokens and API keys are
stored separately in `~/.sim/credentials`, which is written with `0600`
permissions. Set
`SIM_CONFIG_DIR` to use a different directory.

For each setting, the CLI uses the first available value in this order:

1. command-line flag
2. environment variable
3. selected profile
4. built-in default

`sim whoami` shows both the resolved values and where each one came from.

## Useful commands

Run `--help` at any level to see the available subcommands and flags:

```bash
sim --help
sim workflows --help
sim tables rows query --help
```

The commands you will use most often are:

| Task | Command |
| --- | --- |
| Ask Sim about the workspace | `sim chat "Which workflows failed today?"` |
| List or inspect workflows | `sim workflows list`, `sim workflows get <workflowId>` |
| Deploy or run a workflow | `sim workflows deploy <workflowId>`, `sim workflows run <workflowId>` |
| Follow a workflow run | `sim workflows run <workflowId> --follow` |
| Inspect workflow runs | `sim workflows runs list --workflow <workflowId>` |
| Find errors | `sim logs list --level error`, `sim logs follow` |
| Inspect a run trace | `sim logs get <runId> --trace` |
| Work with tables | `sim tables list`, `sim tables rows query <tableId>` |
| Import a CSV | `sim tables import ./data.csv` |
| Upload or download files | `sim files upload ./report.pdf`, `sim files get <fileId>` |
| Search knowledge bases | `sim knowledge search --query "refund policy" --kb <knowledgeBaseId>` |
| Upload a knowledge document | `sim knowledge documents upload <knowledgeBaseId> ./handbook.pdf` |
| Manage integration credentials | `sim credentials --help` |
| Manage workspace secrets | `sim secrets list`, `sim secrets set <name>` |

Commands follow this general shape:

```text
sim <resource> [sub-resource] <verb> [arguments] [options]
```

Many plural top-level resource names also accept a singular spelling, so
`sim workflow get <workflowId>` and `sim workflows get <workflowId>` are
equivalent. Not every group has a singular alias; `sim --help` shows the exact
aliases. `knowledge` also has the `kb` alias.

For workflows, tables, files, and knowledge bases, `list` returns resources
only. `ls [path]` returns the resources and direct child folders at a path:

```bash
sim workflows ls /Support
sim files ls /Reports
```

See the [command reference](https://docs.sim.ai/cli/commands) for every command,
argument, and flag.

## JSON input and output

Human-readable tables are the default. Use JSON or YAML when another program
will consume the result, and `text` for tab-separated shell output:

```bash
sim workflows list --output json
sim logs list --output json | jq -r '.data[].runId'
SIM_OUTPUT=yaml sim tables get <tableId>
sim configure --set-output json
```

Paginated lists return `{ "data": [...], "nextCursor": "..." }` in JSON and YAML.
`nextCursor` is `null` when no pages remain. Resource lists and directory `ls`
fetch every page by default; use `--limit N` to cap them. Table rows (including
queries), logs, audit/billing events, workflow runs/versions, and knowledge
documents/chunks keep a default limit of 100. Use `--limit 0` to fetch every page
of those datasets, or pass the returned `nextCursor` to `--cursor` to continue
with another bounded result. Keep the same resource, filters, and sort order
when resuming; stop when `nextCursor` is `null`. Results accumulate in memory
before printing, so large datasets need an explicit limit or filter.

```bash
sim tables rows list <tableId> --limit 100 --output json
sim tables rows list <tableId> --limit 100 --cursor "$nextCursor" --output json
```

JSON-valued options accept inline JSON, a file prefixed with `@`, or stdin with
`@-`:

```bash
sim workflows run <workflowId> --input '{"customerId":"cus_123"}'
sim workflows run <workflowId> --input @input.json
printf '%s' '{"customerId":"cus_123"}' | sim workflows run <workflowId> --input @-
```

List-valued options use the same `@file` and `@-` forms, with one value per
line. Destructive commands require an explicit selector and `--yes`; they do not
default to deleting every resource when a selector is missing.

For secret values, prefer a prompt, file, or stdin so the value does not appear
in shell history or the process list:

```bash
sim secrets set API_KEY --scope workspace
sim secrets set API_KEY --scope workspace --value @secret.txt
printf '%s' "$API_KEY" | sim secrets set API_KEY --scope workspace --value @-
```

## CI and automation

In CI, use an API key instead of `sim login`:

```bash
export SIM_API_KEY="sim_..."
export SIM_WORKSPACE="<workspaceId>"

sim workflows run <workflowId> --input @input.json --output json
```

Create and revoke API keys in Sim under **Settings → API keys**, and store them
in your CI provider's secret store. `sim logout` only removes a stored key from
the current machine; it does not revoke the key.

The main environment variables are:

| Variable | Purpose |
| --- | --- |
| `SIM_PROFILE` | Profile to use |
| `SIM_ENDPOINT` | Sim deployment URL |
| `SIM_API_KEY` | API key, usually for CI |
| `SIM_WORKSPACE` | Workspace to target |
| `SIM_OUTPUT` | `table`, `json`, `yaml`, or `text` |
| `SIM_CONFIG_DIR` | Base directory for CLI config, credentials, and the update cache |
| `SIM_TIMEOUT_SECONDS` | Per-request timeout; `0` waits indefinitely |
| `SIM_DEBUG` | Print request diagnostics to stderr |
| `SIM_NO_UPDATE_CHECK` | Turn off the update notice |

On eligible interactive invocations, `sim` uses a daily cache before asking
`registry.npmjs.org` what is published under the `latest` tag and prints one
line on stderr when a newer version exists. Prerelease installs are skipped
entirely. The cache lives in `~/.sim` by default and follows `SIM_CONFIG_DIR`;
without a writable cache, each eligible invocation checks again. Concurrent
invocations can also perform duplicate checks. The registry request has a
one-second deadline; the short-lived request process is terminated on expiry.
Apart from the configured registry URL, it sends only its own version and never
your Sim API key. If `npm_config_registry` points at a private mirror, its query
string is preserved, including any query-string credentials. Registry URLs
containing username/password userinfo are rejected. Set
`SIM_NO_UPDATE_CHECK=1` to turn it off. Empty or whitespace-only registry values
use the public default; non-empty malformed or non-HTTP(S) values fail closed.
The full list of cases where it stays quiet is in the
[configuration guide](https://docs.sim.ai/cli/configuration).

## Documentation

- [CLI documentation](https://docs.sim.ai/cli)
- [Command reference](https://docs.sim.ai/cli/commands)
- [Authentication](https://docs.sim.ai/cli/authentication)
- [Profiles and configuration](https://docs.sim.ai/cli/configuration)
- [Scripting](https://docs.sim.ai/cli/scripting)
- [Troubleshooting](https://docs.sim.ai/cli/troubleshooting)

## License

Apache-2.0
