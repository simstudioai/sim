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
| 1 | Command-line flag (`--endpoint`, `--workspace`, `--output`) |
| 2 | Environment (`SIM_ENDPOINT`, `SIM_API_KEY`, `SIM_WORKSPACE`, `SIM_OUTPUT`) |
| 3 | `~/.sim/config` / `~/.sim/credentials` for the selected profile |
| 4 | Built-in default (`https://sim.ai`, `table`) |

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

```bash
sim workflows list [--folder <id>] [--deployed] [--limit <n>]
sim workflows get <id>
sim workflows deploy|undeploy|rollback <id>

sim logs list [--level error] [--workflow <id>…] [--trigger <name>…] [--start <date>]
sim logs get <id>
sim logs execution <executionId>

sim files list
sim files download <fileId> [-o <path>]
sim files delete <fileId>

sim knowledge list
sim knowledge get <id>
sim knowledge documents <id> [--search <text>]
sim knowledge search <query> --kb <id>…
```

Every command takes `--output json` for scripting; the JSON is the API's own
response shape, so it pipes cleanly into `jq`.

```bash
sim logs list --level error --output json | jq -r '.[].executionId'
```

## Notes

- Commands talk to the `/api/v2` surface, which returns `{ data }` and
  `{ data, nextCursor }`. List commands auto-page up to `--limit`.
- `sim tables` is not here yet — the tables v2 surface is still changing.

## License

Apache-2.0
