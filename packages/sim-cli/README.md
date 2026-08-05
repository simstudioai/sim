# Sim CLI

Talk to the [Sim](https://sim.ai) API from your terminal.

```bash
npm install -g @sim/cli
sim login
sim workflows list
```

## Profiles

Profiles work like the AWS CLI: one identity and one set of defaults per named
profile, selected with `--profile` or `SIM_PROFILE`. This is what lets you keep
production and a local dev stack side by side without re-authenticating.

Non-secret settings live in `~/.sim/config`:

```ini
[default]
endpoint = https://sim.ai
workspace = ws_abc123
output = table

[profile dev]
endpoint = http://localhost:3000
workspace = ws_local
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
sim configure --set-workspace ws_local --profile dev
sim profiles          # list them; * marks the active one
sim whoami            # resolved values, and where each came from
```

## Where settings come from

Each setting resolves independently, first match wins:

| Rank | Source |
| --- | --- |
| 1 | Command-line flag (`--endpoint`, `--workspace`) |
| 2 | Environment (`SIM_ENDPOINT`, `SIM_API_KEY`, `SIM_WORKSPACE`, `SIM_OUTPUT`) |
| 3 | `~/.sim/config` / `~/.sim/credentials` for the selected profile |
| 4 | Built-in default (`https://sim.ai`, `table`) |

Formats are listed under [Output formats](#output-formats).

`sim whoami` prints the winning source per setting, which is usually the fastest
way to explain a surprising result.

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
  Workspace-scoped key, pinned to ws_local.
```

The approval page is where you pick the workspace — the terminal has no key yet,
so it cannot list them for you. Whichever you pick becomes the profile's default
`workspace`, so you never have to go look up its id.

What the key itself can reach depends on your role in that workspace, and the
page says which you are about to get before you approve:

| Your role | Key issued | Reach |
| --- | --- | --- |
| Workspace admin | Workspace-scoped | That workspace only |
| Anything else | Personal | Every workspace you can access; `--workspace` overrides the default |

`sim login --workspace <id>` preselects a workspace in the picker, and an
existing profile's workspace preselects itself on re-login.

`sim logout` removes the stored key. It does not revoke it — do that in
Settings → API keys.

## Commands

Plural resource names are canonical, but every plural top-level resource group
also accepts its singular form: for example, `sim table list`,
`sim file download`, and `sim workflow get` are equivalent to their plural
spellings.

```bash
sim workflows ls [path] [--search <text>] [--limit <n>]
sim workflows list [--folder <path>] [--deployed-only] [--limit <n>]
sim workflows get <id>
sim workflows mv <id> --folder <path>
sim workflows deploy|undeploy|rollback <id>

sim logs list [--level error] [--workflow <id>…] [--trigger <name>…] [--start <date>]
sim logs get <id>
sim logs execution <executionId>

sim tables ls [path] [--search <text>] [--limit <n>]
sim tables list [--folder <path>]
sim tables get <tableId>
sim tables mv <tableId> --folder <path>
sim tables columns <tableId>
sim tables rows list <tableId> [--limit <n>]
sim tables rows query <tableId> [--filter <json>] [--sort <json>] [--limit <n>]
sim tables upsert <tableId> --data <json>
sim tables rows batch-delete <tableId> (--row <id>… | --filter <json>) --yes

sim files ls [path] [--search <text>] [--limit <n>]
sim files list [--folder <path>]
sim files get <fileId>
sim files create --name <name> [--folder <path>] [--content <value>] [--encoding utf-8|base64]
sim files upload <path> [--name <name>] [--folder <path>]
sim files download <fileId> [-o <path>]
sim files mv --file-ids <id>… [--to <path>]
sim files batch-delete --file-ids <id>… --yes
sim files delete <fileId>

sim knowledge ls [path] [--search <text>] [--limit <n>]
sim knowledge list [--folder <path>]
sim knowledge get <id>
sim knowledge mv <id> --folder <path>
sim knowledge documents <id> [--search <text>]
sim knowledge documents upload <id> <path> [--tag <value>...]
sim knowledge search --query <text> --kb <id>… [--search-mode vector|hybrid]
```

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
sim tables folders delete Archive/Quarterly --recursive false --yes
```

`mkdir` is the concise form of `folders create`. Replace `tables` with `files`,
`workflows`, or `knowledge`. The leading `/` is optional on CLI inputs; the CLI
adds it before calling the API. Omit the `ls` path to list root. A slash that
belongs to a folder name is percent-encoded as `%2F` rather than treated as a
separator.

### List inputs

Primitive lists take space-separated values. Prefix a path with `@` to read
one value per line, or use `@-` to read the list from stdin.

```bash
sim files mv --file-ids file_1 file_2 --to Archive
sim files mv --file-ids @file-ids.txt --to Archive
printf 'file_1\nfile_2\n' | sim files mv --file-ids @- --to Archive
```

Arrays of objects remain JSON inputs because they cannot be represented as a
flat list without losing structure.

### Filtering table rows

`--filter` takes the same predicate tree the API uses — `all` (AND) or `any`
(OR) groups of `{field, op, value}` conditions, nestable. It's JSON because the
grammar is a tree; there's no honest flag encoding for it.

```bash
sim tables rows query tbl_123 \
  --filter '{"all":[{"field":"status","op":"eq","value":"open"},
                    {"field":"score","op":"gt","value":10}]}' \
  --sort score:desc --limit 50
```

Row columns are discovered at runtime from the returned data, unioned across the
page so a sparse row doesn't hide a column.

Deletions require an explicit selector *and* `--yes`; there is no "delete
everything" default.

### Output formats

Output format is a **profile setting**, not a per-command flag — there is no
`--output`. Set it once with `sim configure --set-output <format>`, or override
ambiently with `SIM_OUTPUT` for a one-off or for CI:

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

SIM_OUTPUT=json sim logs list --level error | jq -r '.[].executionId'
SIM_OUTPUT=yaml sim logs list --level error > logs.yaml

SIM_OUTPUT=text sim files list | while IFS=$'\t' read -r id name size type uploaded; do
  echo "$id $name"
done
```

An absent value is an em-dash in `table` and an **empty field** in `text`, so
emptiness tests downstream behave.

A bad `SIM_OUTPUT` or `output =` is ignored and falls back to `table`. Both are
ambient — set once, then read by every later command — so one bad value should
not break the CLI outright.

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
