/**
 * The primer a source get prints and writes atop `.sim/AGENTS.md`: the few rules an agent needs to
 * edit a source directory without reading the guide, plus a snippet for each builder the source
 * already calls, so the blocks in front of it need no lookup. The guide below it is the reference.
 */
import type { BlockCatalog } from '@sim/workflow-code'
import { SOURCE_BASE_FILE, SOURCE_ENTRY_FILE, SOURCE_LOCK_FILE } from '@sim/workflow-code/limits'
import { SDK_MAJOR, SDK_SPECIAL_BUILDERS } from '@sim/workflow-code/sdk'
import { builderSnippet, describeBuilder, referencedBuilders } from '@sim/workflow-sdk/codegen'
import { embedStore } from '../../embed-context'
import {
  RATE_LIMITED_EXIT_CODE,
  SOURCE_BUSY_EXIT_CODE,
  SOURCE_DRIFT_EXIT_CODE,
  SOURCE_HELD_EXIT_CODE,
  SOURCE_LOCAL_CHANGES_EXIT_CODE,
  SOURCE_STALE_EXIT_CODE,
} from '../../exit-codes'
import { CLI_HOST_ENV, MOTHERSHIP_CLI_HOST } from '../../host'
import { SOURCE_AGENTS_FILE, SOURCE_STARTER_FILE } from './source-dir'

/** Which directory a primer is for. */
export type PrimerKind = 'workflow' | 'workspace'

/**
 * Who reads a primer: a coding agent with a shell of its own (`cli`), or Mothership's chat
 * (`chat`), whose workbench shell refuses a synchronous run (it tests through its `sim_cli` tool)
 * and which Sim refuses workspace source. A workspace directory has the `cli` primer alone.
 */
export type PrimerSurface = 'cli' | 'chat'

/**
 * The surface this CLI serves: `chat` where its host is Mothership, named by the embedding call
 * (Mothership's `sim_cli` tool) or by {@link CLI_HOST_ENV} (its workbench), else `cli`.
 */
export function primerSurface(): PrimerSurface {
  const embedded = embedStore.getStore()
  const host = embedded ? embedded.host : process.env[CLI_HOST_ENV]
  return host === MOTHERSHIP_CLI_HOST ? 'chat' : 'cli'
}

/**
 * The primer without its builder snippets stays within this many bytes: about one screen, room for
 * the rules agents otherwise spend a lookup on (renames, failures, test runs).
 */
export const PRIMER_MAX_BYTES = 4096

/** At most this many snippets, and this many bytes of them; the rest are named for `params`. */
const MAX_SNIPPETS = 12
const MAX_SNIPPET_BYTES = 4096

/** The command that prints any builder's params (`workflow-source-params.ts`). */
const PARAMS_COMMAND = 'sim workflows source params'

/** The heading of the patterns list, which a test checks line by line against the examples. */
export const PATTERNS_HEADING = '- **Patterns**'

/** The rules every source directory shares, after the kind's own edit loop. */
function sharedRules(extra: { renames?: string; patterns?: string; debug?: string } = {}): string {
  return `- **Renames**: rename display names (first argument) or consts, with other edits: \`${SOURCE_LOCK_FILE}\` keeps each block and apply rewrites every reference, \`$ref.<key>\` too. Changing both on one block keeps it only if its settings or neighbours match, else a delete (\`E_APPLY_BLOCK_DELETE\`). One workflow variable per apply.${extra.renames ?? ''}
- **References**: \`${SOURCE_ENTRY_FILE}\` reads \`x.content\`, text as \`\` t\`…\` \`\`, env as \`env.NAME\`. A function file (\`codeFile('./functions/x.js')\`) reads \`$ref.<key>.<path>\` (key: display name lowercased, no spaces or dots), \`$ref.loop.currentItem\` / \`.index\` in a body (\`parallel\` too), \`$env.NAME\`; \`.py\`/\`.sh\` files \`<key.path>\`, \`{{NAME}}\`. A block that never ran reads \`null\` (\`''\` in text).
${PATTERNS_HEADING} (\`.sim/examples/\`, indexed atop \`cookbook.ts\`; any builder: \`${PARAMS_COMMAND} <builder>\`):
  - Condition: keys test in order, first true wins, \`else: true\` last; wire \`route.high.to(alert)\`.
  - Loop: \`const each = loop.forEach('Each Order', { collection: recent.rows }, (p) => {\`; inside, \`p.currentItem.data.orderId\` and \`p.index\`; after, \`each.results\`.
  - Failure: \`shape.onError(invalid)\`; \`invalid\` reads \`shape.error\` (an \`api\` block's too); only a Function also has \`.errorMessage\` (message only).
  - Retry: an \`api\` block resends with \`retries: 3\`, \`retryDelayMs: 500\`; any block's Retry on fail: 3rd argument, \`{ retry: { enabled: true, maxTries: 3, waitBetweenTriesMs: 2000 } }\`.
  - Child: \`const enrich = runWorkflow('Enrich Lead', {\` with \`workflowId: childWorkflow('enrich-lead')\`, \`inputMapping: { email: start.email }\`; read \`enrich.result.data.<field>\`.
  - Tables: \`table.queryRows\` outputs \`rows\` (\`recent.rows[0].data.status\`), not \`row\`; \`table.upsertRow\` takes \`conflictColumn: 'orderId'\`.
  - Rejoin: before one \`response\`, a Function picks the branch that ran with \`??\`.${extra.patterns ?? ''}
- **Credentials**: \`sim credentials connect <provider> --name "<Name>"\`, send the owner its link, then \`credential('<key>')\`.
- **Run**: \`sim workflows run <workflowId>\` runs the active deployment; \`--dry\` runs the draft stubbing writes and MCP tools (even read-only: \`mcp-read-only\`), listed in \`sideEffects\` (\`dry_run_*\` placeholders); GET \`api\` calls and plain-JS GET fetches run; sandboxed code (Python, shell, imports): \`unchecked\`. \`--allow <block>\` (implies \`--dry\`) sends its writes; \`--draft\` alone sends all (use test resources). \`--mock <block>='{…}'\` fixes its output (bare, with \`--mock-from <runId>\`: that run's); a child's block: \`<workflow>.<block>\`.
- **Debug**: \`--dir <dir>\` maps a failure to file:line; \`sim logs get <runId> --trace --no-include-workflow-state\`; rows: \`sim tables rows list <table>\`; rerun: \`--from-block <block> --source-run <runId>\`; \`--stop-after <block>\`.${extra.debug ?? ''}
- **Exit codes**: 0 ok, 1 errors, ${SOURCE_STALE_EXIT_CODE} stale (redo in a fresh get), ${RATE_LIMITED_EXIT_CODE} rate limited, ${SOURCE_BUSY_EXIT_CODE} busy, ${SOURCE_LOCAL_CHANGES_EXIT_CODE}/${SOURCE_DRIFT_EXIT_CODE} \`status\`: your edits / the server changed.`
}

const WORKFLOW_LOOP =
  'sim workflows source check --dir . && sim workflows source apply --dir . --yes'

/**
 * What a coding agent chains onto each kind's apply: a workflow's test run, then its deploy; a
 * workspace's test run of each workflow it changes. Mothership's shell refuses runs, so its loop
 * stops at the apply.
 */
export const CLI_LOOP_RUN: Record<PrimerKind, string> = {
  workflow: " --run '{…}' --deploy",
  workspace: " --run <key>='{…}'",
}

const WORKSPACE_LOOP = `sim workspaces source check --dir . && sim workspaces source apply --dir . --yes${CLI_LOOP_RUN.workspace}`

const EDIT_LOOP_LEAD = '**Edit loop**: write every file, then run one chained command'

const APPLY_REWRITES = `\`check\` also type-checks (no \`tsc\`). Apply re-checks (\`apply --dry\` only plans) and rewrites \`${SOURCE_ENTRY_FILE}\`: reread it before editing.`

/**
 * The workflow edit loop of each surface. A coding agent chains the test run and the deploy onto
 * the apply; the chat's shell refuses a synchronous run, so its loop stops at the apply and the
 * test runs through `sim_cli`, whose `--dir` reads the same workbench.
 */
const WORKFLOW_EDIT_LOOP: Record<PrimerSurface, string> = {
  cli: `${EDIT_LOOP_LEAD}; fix what it reports: \`${WORKFLOW_LOOP}${CLI_LOOP_RUN.workflow}\` applies, dry-runs that input, and deploys only if it completed (no \`--deploy\`: stays a draft). ${APPLY_REWRITES}`,
  chat: `${EDIT_LOOP_LEAD} in run_code's shell; fix what it reports: \`${WORKFLOW_LOOP}\`. ${APPLY_REWRITES} Test the draft with sim_cli, as the shell refuses runs: \`workflows run <workflowId> --dry --input '{…}' --dir <dir>\` (from /home/user), then \`workflows deploy <workflowId> --expected-draft-fingerprint <fingerprint>\` (from \`.sim/base.json\`).`,
}

function workflowPrimer(surface: PrimerSurface): string {
  return `# Sim workflow source: primer

\`${SOURCE_ENTRY_FILE}\` is a Sim workflow as TypeScript; the server compiles it; nothing in it runs. Commands here (table ones too) act on the workflow \`${SOURCE_BASE_FILE}\` names and its workspace (a starter's \`${SOURCE_STARTER_FILE}\` names the workspace; its loop runs \`create\`, not \`apply\`).

${WORKFLOW_EDIT_LOOP[surface]}

- **Scope**: the workflow alone. Tables: \`sim tables columns create <table> --column '{…}'\`, \`sim tables columns update <table> --column-name <c> --updates '{…}'\`, \`sim tables rows update <table> <row> --data '{…}'\`; change columns before the get (its table types go stale).
- **Deletes**: removing a block or variable: \`apply --allow-delete\`.
${sharedRules()}
`
}

/** What a workspace directory adds to the shared rules. */
const WORKSPACE_EXTRA = {
  renames: ' A column: change its `name`, keep its key.',
  patterns:
    "\n  - Workspace: a text column is `column.string`; `deployments/<workflow key>.ts` with `defineDeployment({` and `live: 'draft'` deploys on apply.",
  debug: ' Block: `sim workflows source find <name> --dir workflows/<key>`.',
}

const WORKSPACE_PRIMER = `# Sim workspace source: primer

A Sim workspace as files; nothing here runs. Commands here (table ones too) act on the workspace \`${SOURCE_BASE_FILE}\` names. Every \`.ts\` file starts with \`// @sim-sdk ${SDK_MAJOR}\`.

**Edit loop**: write every file, then run one chained command; fix what it reports: \`${WORKSPACE_LOOP}\` dry-runs \`workflows/<key>/\`'s draft (one \`--run\` per workflow you changed; drop it when you changed none) and deploys only if all complete. \`check\` also type-checks (no \`tsc\`). Apply re-checks (\`apply --dry\` only plans) and rewrites files: reread before editing.

- **Deletes**: removing anything (file, column, block) needs \`apply --allow-delete\` and is permanent.
- **Exit ${SOURCE_HELD_EXIT_CODE}**: partly written: what needs an unset secret or unbound credential waits; set it, reapply.
${sharedRules(WORKSPACE_EXTRA)}
`

/**
 * The first line of the `AGENTS.md` pointer a get writes at the directory root. A root `AGENTS.md`
 * without it is the person's own, and a get never replaces it.
 */
export const AGENTS_POINTER_MARKER =
  '<!-- Written by the Sim CLI (`source get`); remove this line to keep your own edits. -->'

const STARTER_LOOP = ` A starter (\`${SOURCE_STARTER_FILE}\`, no workflow yet) runs \`create\` in place of \`apply\`.`

const WORKSPACE_POINTER_LOOP = `\`${WORKSPACE_LOOP}\` (one \`--run\` per workflow you changed); fix what it reports next.`

/** The loop line of the pointer, after its lead, by directory kind and surface. */
const POINTER_LOOPS: Record<PrimerKind, Record<PrimerSurface, string>> = {
  workflow: {
    cli: `\`${WORKFLOW_LOOP}${CLI_LOOP_RUN.workflow}\`; fix what it reports next.${STARTER_LOOP}`,
    chat: `\`${WORKFLOW_LOOP}\`; fix what it reports next. Then test the draft with sim_cli as \`${SOURCE_AGENTS_FILE}\` says.${STARTER_LOOP}`,
  },
  workspace: { cli: WORKSPACE_POINTER_LOOP, chat: WORKSPACE_POINTER_LOOP },
}

/**
 * The root `AGENTS.md` pointer: an agent that opens `workflow.ts` loads the nearest `AGENTS.md`
 * above it, and `.sim/` is a sibling of the source, so without this file the guide is never found.
 */
export function agentsPointer(kind: PrimerKind, surface: PrimerSurface = 'cli'): string {
  return `${AGENTS_POINTER_MARKER}
# Sim ${kind} source

${kind === 'workflow' ? '`workflow.ts` is a Sim workflow as TypeScript that Sim compiles' : 'This directory is a Sim workspace as files that Sim applies'}; nothing in it runs. Read \`${SOURCE_AGENTS_FILE}\` before editing: the rules, the edit loop, patterns and exit codes.

Loop: write every file, then one chained command: ${POINTER_LOOPS[kind][surface]}
Exit codes: 0 ok, 1 errors, ${SOURCE_STALE_EXIT_CODE} stale (get a fresh copy and redo the edit), ${SOURCE_DRIFT_EXIT_CODE} \`status\`: the server changed.
`
}

/**
 * The primer for a `kind` directory read on `surface`, without builder snippets. The mothership
 * worker preloads the `chat` workflow primer verbatim as its `workflow-source` skill
 * (`scripts/print-source-primers.ts`), so an edit here shows up as worker drift until the next
 * grammar sync.
 */
export function sourcePrimer(kind: PrimerKind, surface: PrimerSurface = 'cli'): string {
  return kind === 'workflow' ? workflowPrimer(surface) : WORKSPACE_PRIMER
}

/**
 * A snippet for each builder `sources` call ({@link builderSnippet}), integration builders before
 * the core ones (`agent`, `fn`), whose shape the source shows. Over the cap, the rest are named
 * for `params`. Empty when the source calls none.
 */
function builderSnippets(catalog: BlockCatalog, sources: Iterable<string>): string {
  const core = (key: string) => Object.hasOwn(SDK_SPECIAL_BUILDERS, key) || key === 'agent'
  const keys = referencedBuilders(catalog, sources)
  const ordered = [...keys.filter((key) => !core(key)), ...keys.filter(core)]
  const snippets: string[] = []
  const skipped: string[] = []
  let bytes = 0
  for (const key of ordered) {
    const reference = describeBuilder(catalog, key)
    if (!reference) continue
    const snippet = builderSnippet(reference)
    if (snippets.length >= MAX_SNIPPETS || bytes + snippet.length > MAX_SNIPPET_BYTES) {
      skipped.push(key)
      continue
    }
    snippets.push(snippet)
    bytes += snippet.length
  }
  if (snippets.length === 0) return ''
  const rest =
    skipped.length > 0
      ? `\nAlso used (\`${PARAMS_COMMAND} <builder>\`): ${skipped.map((key) => `\`${key}\``).join(', ')}.\n`
      : ''
  return `## Builders this source uses\n\n${snippets.join('\n')}\n${rest}`
}

/** The `surface` primer with the snippets of the builders `sources` call. */
export function primerFor(
  kind: PrimerKind,
  surface: PrimerSurface,
  catalog: BlockCatalog,
  sources: Iterable<string>
): string {
  const primer = sourcePrimer(kind, surface)
  const snippets = builderSnippets(catalog, sources)
  return snippets ? `${primer}\n${snippets}` : primer
}
