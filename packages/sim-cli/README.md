# Sim CLI

Talk to the [Sim](https://sim.ai) API from your terminal.

```bash
bun add --global @sim/cli
sim login
sim workflows list
```

## Profiles

Profiles work like the AWS CLI: one identity and one set of defaults per named
profile, selected with `-P`, `--profile`, or `SIM_PROFILE`. This is what lets you keep
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
| 1 | Command-line flag (`--endpoint`, `--workspace`, `--output`) |
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
  Personal key, defaulting to ws_local. Override per command with --workspace.
```

The approval page is where you pick the workspace — the terminal has no key yet,
so it cannot list them for you. `sim login` issues a personal key, and whichever
workspace you pick becomes only the profile's default `workspace`; it does not
limit the key to that workspace. Use `--workspace` to target another workspace
the key can access.

`sim login --workspace <id>` preselects a workspace in the picker, and an
existing profile's workspace preselects itself on re-login.

`sim logout` removes the stored key. It does not revoke it — do that in
Settings → API keys.

## Commands

Plural resource names are canonical, but every plural top-level resource group
also accepts its singular form: for example, `sim table list`,
`sim file download`, and `sim workflow get` are equivalent to their plural
spellings.

`knowledge` also accepts the shorter `kb` alias, and `documents` accepts
`document`.

```bash
sim chat [prompt...] [-f <path>...] [--read-only]
sim chat -p [prompt...] [-f <path>...] [--read-only]

sim workflows ls [path] [--search <text>] [--limit <n>]
sim workflows list [--folder <path>] [--deployed-only] [--limit <n>]
sim workflows get <id>
sim workflows update <id> [--name <name>] [--description <text>] [--folder <path>]
sim workflows mv <id> <folder>
sim workflows deploy|undeploy|rollback <id>
sim workflows run <id> [--input <json|@file>] [--select-output <path>…] [--async]
sim workflows executions list --workflow <workflowId> [--status <status>]
sim workflows executions get <executionId> --workflow <workflowId> [--include-output]
sim workflows executions cancel <executionId> --workflow <workflowId>
sim workflows executions resume <executionId> --workflow <workflowId> --context <contextId> [--input <json|@file>]

sim logs list [--level error] [--workflow <id>…] [--trigger <name>…] [--start-date <date>]
sim logs get <executionId>

sim audit-logs list --organization <organizationId> [--all-workspaces]
sim audit-logs get <id> --organization <organizationId>

sim tables ls [path] [--search <text>] [--limit <n>]
sim tables list [--folder <path>]
sim tables get <tableId>
sim tables update <tableId> [--name <name>] [--description <text>] [--folder <path>]
sim tables mv <tableId> <folder>
sim tables columns <tableId>
sim tables rows list <tableId> [--limit <n>]
sim tables rows create <tableId> --data <json|@file>
sim tables rows create <tableId> --rows <json|@file>
sim tables rows query <tableId> [--filter <json>] [--sort <json>] [--limit <n>]
sim tables rows query <tableId> --filter '{"all":[{"field":"status","op":"eq","value":"active"}]}'
sim tables upsert <tableId> --data <json>
sim tables rows batch-delete <tableId> (--row <id>… | --filter <json>) --yes

sim files ls [path] [--search <text>] [--limit <n>]
sim files list [--folder <path>]
sim files get <fileId>
sim files create --name <name> [--folder <path>] [--content <value>] [--encoding utf-8|base64]
sim files upload <path> [--name <name>] [--folder <path>]
sim files download <fileId> [-o <path|->]
sim files mv --file-ids <id>… [--to <path>]
sim files batch-delete --file-ids <id>… --yes
sim files delete <fileId> --yes

sim knowledge ls [path] [--search <text>] [--limit <n>]
sim knowledge list [--folder <path>]
sim knowledge get <id>
sim knowledge update <id> [--name <name>] [--description <text>] [--folder <path>]
sim knowledge mv <id> <folder>
sim knowledge search --query <text> --kb <id>… [--search-mode vector|hybrid]

sim documents list --kb <knowledgeBaseId> [--search <text>]
sim documents get <documentId> --kb <knowledgeBaseId>
sim documents upload <path> --kb <knowledgeBaseId> [--tag <value>...]
sim documents delete <documentId> --kb <knowledgeBaseId> --yes

sim billing status [--all-workspaces]
sim billing logs [--period 7d] [--source sim-chat] [--limit <n>] [--all-workspaces]
```

The `sim-chat` billing source combines Copilot and workspace chat usage.
Organization audit logs require a personal API key. Commands with
`--all-workspaces` otherwise default to the workspace in the active profile.

`workflows executions get` is the lightweight status and polling resource.
`--workflow` names the parent resource, while the execution ID remains positional.
For a paused execution, its status includes the context ID needed by `resume`.
`logs get` is the full diagnostic resource. It keeps the default human output
concise; add `--trace` for the expanded recursive trace with span inputs,
outputs, errors, timing, and cost. JSON and YAML retain the complete structured
response.

### Ask Sim Chat

`sim chat` opens a terminal conversation about the workspace saved by `sim
login`. It streams answers with a compact working indicator, keeps the
conversation across turns, and provides input history. In a real TTY, the
transcript and current activity stay in the upper viewport while the
free-form `❯` composer remains pinned at the bottom. Use the global
`--workspace` flag to target another workspace the active key can access.
Structured questions use a separate compact panel: Up/Down moves, Enter selects,
Space toggles multi-select items, typing supplies a custom answer, and Esc returns
to the ordinary composer. Suggested follow-up metadata is omitted.

The composer stays editable while Sim is working. Press Enter with a follow-up
to queue it and immediately steer the active turn (the TUI performs the web
chat's queue-then-send-now handoff in one step); additional submitted prompts
remain FIFO. Press Up on an empty composer to recall the newest queued prompt.
Shift+Enter, Option/Meta+Enter, or a trailing `\` followed by Enter inserts a
newline instead of submitting.

Type `@` at the start of a token to tag a workspace workflow, table, file, or
knowledge base. The latest 50 execution logs appear after those primary
resources instead of expanding an unbounded logs tree. Past chats never enter
the `@` list; use `/chats` to open their searchable picker. Type `/` to invoke a
workspace skill or an enabled MCP server; read-only chat omits MCP servers,
and CLI control commands remain in that menu at the start of the composer.
These are structured tags, not decorative prompt text: Sim receives the
selected resource id, and a tagged MCP server remains enabled for later turns
in the same terminal conversation.

```bash
sim chat
sim chat "Start by explaining this workspace"
sim chat --file screenshot.png "What is failing here?"
sim chat --read-only "Summarize this workspace without changing it"
```

Inside the chat, `/attach <paths>` attaches up to five local images, PDFs, or
UTF-8 text files to the next turn. A pasted or dragged file path preloads an
`/attach` command; review it and press Enter before the CLI reads the file. On
macOS, press Ctrl+V or use `/paste-image` to attach a clipboard image;
any draft text remains in the prompt. `/chats` loads the chat history and opens
a searchable picker. Selecting one restores its transcript and continues it
with a fresh opaque token. The header shows the active chat title and keeps the
`/chats` switch hint visible; a new chat's generated title appears there as soon
as the server publishes it. `/rename <title>` retitles the active synced chat in
both the terminal and Sim Home. `/clear` clears the visible transcript and
starts a new conversation, `/help` lists commands, and `/exit` or Ctrl+D exits.
Ctrl+C clears idle input or cancels the active generation and returns to the
prompt.

Chats sent with the personal API key issued by `sim login` use the same history
as Sim Home, so a CLI conversation appears in the web UI and a web conversation
can be resumed in the terminal. Shared workspace keys intentionally do not
expose their creator's private chat history. Profiles created by an older login
flow may still contain a workspace-scoped key; run `sim login` again for that
profile to replace it with a personal key and enable synchronized history and
`/chats`.

Chat uses the full Mothership toolset by default. Add `--read-only` in either
interactive or print mode when the conversation must be restricted to
workspace-reading tools.

`sim chat -p` is the non-interactive form. It never opens a prompt: the
completed, terminal-safe answer is the only thing written to stdout, so it
composes cleanly with shell tools. Bare `sim chat` requires a real terminal;
pipelines and redirected output must use `-p`.

```bash
sim chat -p "Which workflows handle support tickets?"
cat incident.txt | sim chat -p "Which workflow is most likely involved?"
sim chat -p < question.txt
sim chat -p --file report.pdf "Summarize this in workspace context"
```

When both a positional prompt and stdin are present, the positional prompt comes
first and the piped content follows on the next line. This matches Claude Code's
print-mode input behavior. Combined input is limited to 10 MiB of UTF-8 text.
Files are sent inline by basename only: local paths never cross the API
boundary. Images and PDFs are limited to 5 MiB each, text files to 200 KiB, and
all attachments in a turn to 10 MiB total.

On an auth-disabled self-hosted Sim deployment, configure the endpoint and
workspace without logging in locally:

```bash
sim configure --set-endpoint http://localhost:3000 --set-workspace ws_local
sim chat -p "What is in this workspace?"
```

That deployment must enable `V2_API=true` and set `COPILOT_API_KEY` server-side.
A CLI API key, when one is present, authenticates only the public Sim request
and is never reused as the deployment's Mothership key.

`sim logs get` keeps the default human output concise. Use JSON or YAML to
inspect its complete `executionData` and recursive `traceSpans` tree:

```bash
sim logs get <executionId> --trace
sim logs get <executionId> --output json | jq '.traceSpans'
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

sim --output json logs list --level error | jq -r '.[].executionId'
sim logs list --level error --output json | jq -r '.[].executionId'
SIM_OUTPUT=yaml sim logs list --level error > logs.yaml

SIM_OUTPUT=text sim files list | while IFS=$'\t' read -r id name size type uploaded; do
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
