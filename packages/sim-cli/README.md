# Sim CLI

Talk to the [Sim](https://sim.ai) API from your terminal.

```bash
npm install -g sim
sim login
sim workflows list
```

Full documentation: **https://docs.sim.ai/cli**

## Profiles

Profiles work like the AWS CLI and are selected with `-P`, `--profile`, or
`SIM_PROFILE`. A profile normally owns one identity and one set of defaults; a
workspace profile can instead share a stored identity through `auth_profile`.

Non-secret settings live in `~/.sim/config`:

```ini
[default]
endpoint = https://www.sim.ai
workspace = b7f4a1c3-9e02-4d68-8a5b-1c3f6d90e274
output = table

[profile dev]
endpoint = http://localhost:3000
workspace = a3c81b02-5f4d-4e19-9d7a-2b6c1e084f55

[profile acme]
auth_profile = default
workspace = 7e2d9c14-6b83-4a55-8f01-c4d3e9a76b28
```

Keys live in `~/.sim/credentials`, written `0600`:

```ini
[default]
api_key = sim_…

[dev]
api_key = sim_…
```

The section-naming asymmetry — `[profile dev]` in config, `[dev]` in credentials
— is the AWS convention, kept so existing habits and tooling carry over.

```bash
sim configure --set-endpoint http://localhost:3000 --profile dev
sim configure --set-workspace a3c81b02-5f4d-4e19-9d7a-2b6c1e084f55 --profile dev

sim profiles   # list them; * marks the active one
sim whoami     # resolved values, where each came from, and whether they work

# Share the active stored login with a second workspace
sim profile add acme --workspace 7e2d9c14-6b83-4a55-8f01-c4d3e9a76b28
```

A profile name that is not configured is refused, with the closest configured
name suggested. A typo used to fall through to the built-in defaults, so
`--profile stagng` talked to production and handed it whatever key resolved.
The two exceptions are the commands whose job is to create a profile:
`sim login --profile new` and `sim configure --profile new` still accept a name
that does not exist yet.

## Where settings come from

Each setting resolves independently, first match wins:

| Rank | Source |
| --- | --- |
| 1 | Command-line flag (`--endpoint`, `--workspace`, `--output`) |
| 2 | Environment (`SIM_ENDPOINT`, `SIM_API_KEY`, `SIM_WORKSPACE`, `SIM_OUTPUT`) |
| 3 | `~/.sim/config` for the selected profile and credentials for its `auth_profile`, when set |
| 4 | Built-in default (`https://www.sim.ai`, `table`) |

`SIM_TIMEOUT_SECONDS` bounds each request (default `3600`, `0` waits
indefinitely) and `SIM_DEBUG=1` traces requests to stderr. Node ignores
`HTTPS_PROXY` unless `NODE_USE_ENV_PROXY=1` is also set, on Node 22.21+ or
24.5+; the CLI warns when a proxy is configured but will not be used.

Formats are listed under [Output formats](#output-formats).

`sim whoami` prints the winning source per setting, which is usually the fastest
way to explain a surprising result. It then reads the configured workspace to
prove the settings actually work; `--no-verify` skips that and stays offline.

Its exit status is the answer, so CI can branch on it:

| Code | Meaning |
| --- | --- |
| `0` | The key works and reached the configured workspace |
| `1` | The credentials are wrong — no key stored, or the API refused it |
| `2` | The check could not be made — nothing to check against, or the endpoint did not answer |

For CI, skip `sim login` entirely and set `SIM_API_KEY` and `SIM_WORKSPACE` —
nothing needs to touch the filesystem. `SIM_CONFIG_DIR` relocates both files if
you need to keep them somewhere other than `~/.sim`.

## Logging in

`sim login` uses the same browser handoff shape as `gh auth login`: the terminal
prints a pairing code and a URL, you approve in a browser, and the key comes back
over the CLI's own connection. Nothing redeemable crosses the browser leg, and
there is no loopback listener — so it works over SSH and inside containers.

```
$ sim login --profile dev --endpoint http://localhost:3000

Pairing code: K7M2-P9XT
Confirm this code matches what the browser shows before approving.

http://localhost:3000/cli/auth?request=…&scope=platform
Waiting for approval…

✓ Logged in. Key stored in /Users/you/.sim/credentials
  Personal key, defaulting to a3c81b02-5f4d-4e19-9d7a-2b6c1e084f55.
  Override per command with --workspace.
```

The approval page is where you pick the workspace — the terminal has no key yet,
so it cannot list them for you. `sim login` issues a personal key, and whichever
workspace you pick becomes only the profile's default `workspace`; it does not
limit the key to that workspace. Use `--workspace` to target another workspace
the key can access.

`sim login --workspace <id>` preselects a workspace in the picker, and an
existing profile's workspace preselects itself on re-login.

### Personal and workspace keys

Some operations accept only a **personal** API key: secrets, knowledge chunks,
knowledge connectors, knowledge tag writes, `chat`, `audit-logs`, and most
workflow deployment writes. A workspace-scoped key gets a `FORBIDDEN` response
on those, under one of two codes:

- `WORKSPACE_KEY_OPERATION_NOT_PERMITTED` — the workspace-scoped operations,
  which is most of the list: secrets, knowledge, `chat`, and the deployment
  writes.
- `PRINCIPAL_KIND_NOT_PERMITTED` — the organization-scoped ones, which never go
  through workspace authorization at all. `audit-logs` is the one in this list.

Match on either when you are branching on the refusal. `sim whoami` reports
which kind you hold on its `Key type` row, and `sim meta status` reports the
same thing as `personal` or `workspace` alongside the rest of the key's state:

```bash
$ sim meta status --output json
{
  "v2Enabled": true,
  "keyType": "personal",
  "expiresAt": null
}
```

`sim whoami --no-verify` stays offline and so cannot read the key type; it
prints `not checked` instead.

`sim logout` removes the stored key. A shared workspace profile cannot remove
its authentication profile's key; use `sim logout --all --profile <name>` to
remove only the workspace profile. An authentication profile cannot be removed
entirely while workspace profiles reference it. Logging out does not revoke a
key — do that in Settings → API keys.

## Commands

The commands below are the common ones. The complete reference — every group,
subcommand, argument, and flag, generated from this package — is at
[docs.sim.ai/cli/commands](https://docs.sim.ai/cli/commands).

Plural resource names are canonical. Most plural top-level resource groups also
accept their singular form — `sim table list`, `sim file get`, and
`sim workflow get` are equivalent to their plural spellings. The groups with a
singular alias are `audit-logs`, `credentials`, `custom-tools`, `files`, `logs`,
`mcp-servers`, `secrets`, `skills`, `tables`, `workflows`, and `workspaces`;
`blocks`, `tools`, `chat-deployments`, `connector-types`, and
`workflow-mcp-servers` are plural-only. `sim --help` lists each group with the
aliases it actually accepts.

`knowledge` also accepts the shorter `kb` alias.

```bash
sim workflows ls [path] [--search <text>] [--limit <n>]
sim workflows list [--folder <path>] [--deployed-only] [--limit <n>]
sim workflows get <id>
sim workflows update <id> [--name <name>] [--description <text>] [--folder <path>]
sim workflows mv <id> <folder>
sim workflows deploy|undeploy|rollback <id>
sim workflows run <id> [--input <json|@file>] [--select-output <path>…] [--async]
sim workflows runs list --workflow <workflowId> [--status <status>]
sim workflows runs get <runId> --workflow <workflowId> [--include-output]
sim workflows runs cancel <runId> --workflow <workflowId>
sim workflows runs resume <runId> --workflow <workflowId> --context <contextId> [--input <json|@file>]

sim logs list [--level error] [--workflow <id>…] [--trigger <name>…] [--start-date <date>]
sim logs get <runId>

sim audit-logs list [--organization <organizationId>] [--all-workspaces]
sim audit-logs get <id> [--organization <organizationId>]

sim workspaces list
sim workspaces get
sim workspaces members

sim tables ls [path] [--search <text>] [--limit <n>]
sim tables list [--folder <path>]
sim tables get <tableId>
sim tables update <tableId> [--name <name>] [--description <text>] [--folder <path>]
sim tables mv <tableId> <folder>
sim tables columns create|update|delete|run <tableId>
sim tables rows list <tableId> [--limit <n>]
sim tables rows create <tableId> --data <json|@file>
sim tables rows create <tableId> --rows <json|@file>
sim tables rows query <tableId> [--filter <json>] [--sort <json>] [--limit <n>]
sim tables rows query <tableId> --filter '{"all":[{"field":"status","op":"eq","value":"active"}]}'
sim tables upsert <tableId> --data <json>
sim tables rows batch-delete <tableId> (--row <id>… | --filter <json>) --yes

sim files ls [path] [--search <text>] [--limit <n>]
sim files list [--folder <path>]
sim files describe <fileId>
sim files get <fileId> [-o <path>]  # stdout by default
sim files create --name <name> [--folder <path>] [--content <value>] [--encoding utf-8|base64]
sim files upload <path> [--name <name>] [--folder <path>]
sim files share get <fileId>
sim files share set <fileId> --is-active <true|false> [--auth-type public|password|email|sso]
sim files mv --file-ids <id>… [--to <path>]
sim files batch-delete --file-ids <id>… --yes
sim files delete <fileId> --yes

sim knowledge ls [path] [--search <text>] [--limit <n>]
sim knowledge list [--folder <path>]
sim knowledge get <id>
sim knowledge update <id> [--name <name>] [--description <text>] [--folder <path>]
sim knowledge mv <id> <folder>
sim knowledge search --query <text> --kb <id>… [--search-mode vector|hybrid]

sim knowledge documents list <knowledgeBaseId> [--search <text>]
sim knowledge documents get <knowledgeBaseId> <documentId>
sim knowledge documents upload <knowledgeBaseId> <path> [--tag <value>...]
sim knowledge documents update <knowledgeBaseId> <documentId> [--filename <name>] [--enabled]
sim knowledge documents batch-update <knowledgeBaseId> --operation enable|disable
sim knowledge documents delete <knowledgeBaseId> <documentId> --yes

sim billing status [--all-workspaces]
sim billing logs [--period 7d] [--source sim-chat] [--limit <n>] [--all-workspaces]
```

The `sim-chat` billing source combines Copilot and workspace chat usage.
Organization audit logs require a personal API key; `--organization` defaults
to your only organization and is needed only when you belong to more than one. Commands with
`--all-workspaces` otherwise default to the workspace in the active profile.

`workflows runs get` is the lightweight status and polling resource.
`--workflow` names the parent resource, while the run ID remains positional.
For a paused run, its status includes the context ID needed by `resume`.
`logs get` is the full diagnostic resource. It keeps the default human output
concise; add `--trace` for the expanded recursive trace with span inputs,
outputs, errors, timing, and cost. JSON and YAML retain the complete structured
response.

`sim logs get` keeps the default human output concise. Use JSON or YAML to
inspect its complete `executionData` and recursive `traceSpans` tree:

```bash
sim logs get <runId> --trace
sim logs get <runId> --output json | jq '.traceSpans'
sim logs list --include-trace-spans --output json
```

Workflow output selectors use `blockName.field` syntax, such as
`--select-output agent_1.content`; fields that are not produced are omitted.

`ls` is a directory view: it combines the resources at its optional path with
that folder's direct child folders. It never includes deeper descendants. Its
`ref` column is the resource ID or canonical folder path to pass to the next
command. Use `list` when you want resources only, or `folders ls` when you want
folders only.

Each folder-backed resource has the same path commands:

```bash
sim tables ls Reports
sim tables folders ls --parent Reports
sim tables mkdir Reports/Quarterly
sim tables folders create Reports/Quarterly
sim tables folders mv Reports/Quarterly Archive/Quarterly
sim tables folders delete Archive/Quarterly --yes
sim tables folders delete Archive --recursive --yes
```

`mkdir` is the concise form of `folders create`. Replace `tables` with `files`,
`workflows`, or `knowledge`. The leading `/` is optional on API inputs; the API
returns the canonical leading-slash form. Omit the `ls` path to list root.

### List inputs

Primitive lists take space-separated values. Prefix a path with `@` to read
one value per line, or use `@-` to read the list from stdin.

```bash
sim files mv --file-ids wf_3Kq9tVbN2xLpR7sWmZ4dY wf_8Jd5cHy1QnT6vXbA0rEuP --to Archive
sim files mv --file-ids @file-ids.txt --to Archive
printf 'wf_3Kq9tVbN2xLpR7sWmZ4dY\nwf_8Jd5cHy1QnT6vXbA0rEuP\n' | sim files mv --file-ids @- --to Archive
```

File IDs carry a `wf_` prefix, as above. Workflow, knowledge-base, and
workspace IDs are bare UUIDs, and table IDs are `tbl_`-prefixed — the `wf_`
prefix belongs to files, not workflows.

Arrays of objects remain JSON inputs because they cannot be represented as a
flat list without losing structure.

### Secret values

`sim secrets set` takes the same `@` convention for its `--value`. Passing a
secret inline exposes it to shell history and to anything reading the process
list, so prefer a file or stdin; the contents are sent verbatim, with no
trimming. A value that genuinely begins with `@` is written `@@`, and only the
leading `@` is dropped. Omit `--value` entirely and the terminal prompts for it
without echoing.

```bash
sim secrets set STRIPE_KEY --scope workspace --value @stripe.key
op read op://vault/stripe/key | sim secrets set STRIPE_KEY --scope workspace --value @-
sim secrets set MENTION --scope workspace --value @@channel   # the literal @channel
```

`--unredacted` marks a workspace secret whose value may appear in run logs and
model-visible content; `--no-unredacted` restores redaction. Omit both and the
secret keeps whatever it had. Both apply only to `--scope workspace`.

### Filtering table rows

`--filter` takes the same predicate tree the API uses — `all` (AND) or `any`
(OR) groups of `{field, op, value}` conditions, nestable. It's JSON because the
grammar is a tree; there's no honest flag encoding for it.

```bash
sim tables rows query tbl_123 \
  --filter '{"all":[{"field":"status","op":"eq","value":"open"},
                    {"field":"score","op":"gt","value":10}]}' \
  --sort '[{"field":"score","direction":"desc"}]' --limit 50
```

`--sort` is JSON for the same reason: it is an ordered list of keys, each with a
`field` and a `direction` of `asc` or `desc`.

Row columns are discovered at runtime from the returned data, unioned across the
page so a sparse row doesn't hide a column.

Deletions require an explicit selector *and* `--yes`; there is no "delete
everything" default.

### Output formats

Output format can be selected per command with `--output`, saved as a profile
default with `sim configure --set-output <format>`, or set ambiently with
`SIM_OUTPUT` for CI:

| Format | For |
| --- | --- |
| `table` | reading (default) |
| `json` | piping into `jq` |
| `yaml` | piping into anything that reads YAML |
| `text` | shell loops — tab-separated, no header, no colour |

`json` and `yaml` emit the API's **raw** values, not the table's formatting — a
duration stays `1500`, not `"1.5s"` — so switching format never changes the data.
`text` uses the rendered cells, since it is meant for shell plumbing rather than
parsing.

```bash
sim configure --set-output json                      # for this profile, from now on
sim configure --set-output text --profile scripts    # a profile dedicated to scripting

sim --output json logs list --level error | jq -r '.[].runId'
sim logs list --level error --output json | jq -r '.[].runId'
SIM_OUTPUT=yaml sim logs list --level error > logs.yaml

SIM_OUTPUT=text sim files list |
  while IFS=$'\t' read -r id name folder size type uploaded_by uploaded; do
    echo "$id $name"
  done
```

An absent value is an em-dash in `table` and an **empty field** in `text`, so
emptiness tests downstream behave.

An invalid active `SIM_OUTPUT` or `output =` value fails with the accepted
formats. A valid higher-priority `--output` still overrides a stale lower tier,
so `sim --output table configure --set-output json` can repair a profile.

## How this stays in sync with the API

`src/generated/v2-api.ts` is generated from the Zod route contracts in
`apps/sim/lib/api/contracts/v2/**` — the same contracts the routes validate
against, so a shape that disagrees with them is a shape the server would reject.
It holds every response/request type plus the operation table (method, path,
path params) the client dispatches through.

```bash
bun run generate:cli-api   # regenerate after changing a contract
bun run check:cli-api      # CI: fails if the generated file is stale
bun run check:openapi      # CI: fails if the docs and contracts disagree
```

The generated file contains only type declarations and one const — no imports —
so the `packages/*` must not import `apps/*` boundary is preserved; the script
does the crossing at build time.

The OpenAPI documents under `apps/docs` are deliberately **not** generated. They
carry hand-written descriptions, examples, and error responses that Zod schemas
don't encode, so regenerating them would trade real documentation for mechanical
accuracy. `check:openapi` reconciles them against the same contracts instead —
field by field, and it parses every documented example with the real Zod schema —
so the prose survives while drift still fails the build.

## Notes

- Commands talk to the `/api/v2` surface, which returns `{ data }` and
  `{ data, nextCursor }`. List commands auto-page up to `--limit`.

## License

Apache-2.0
