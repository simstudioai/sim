/**
 * The primer a source get prints and writes atop `.sim/AGENTS.md`: the few rules an agent needs to
 * edit a source directory without reading the guide, plus a snippet for each builder the source
 * already calls, so the blocks in front of it need no lookup. The guide below it is the reference.
 */
import type { BlockCatalog } from '@sim/workflow-code'
import { SOURCE_BASE_FILE, SOURCE_ENTRY_FILE, SOURCE_LOCK_FILE } from '@sim/workflow-code/limits'
import { SDK_MAJOR, SDK_SPECIAL_BUILDERS } from '@sim/workflow-code/sdk'
import { builderSnippet, describeBuilder, referencedBuilders } from '@sim/workflow-sdk/codegen'
import {
  RATE_LIMITED_EXIT_CODE,
  SOURCE_BUSY_EXIT_CODE,
  SOURCE_DRIFT_EXIT_CODE,
  SOURCE_HELD_EXIT_CODE,
  SOURCE_LOCAL_CHANGES_EXIT_CODE,
  SOURCE_STALE_EXIT_CODE,
} from '../../exit-codes'
import { SOURCE_AGENTS_FILE, SOURCE_STARTER_FILE } from './source-dir'

/** Which directory a primer is for. */
export type PrimerKind = 'workflow' | 'workspace'

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
function sharedRules(group: string, extra: { renames?: string; patterns?: string } = {}): string {
  return `- **Renames**: rename any number of blocks' display names (first argument) or consts, with other edits: \`${SOURCE_LOCK_FILE}\` keeps each block and apply rewrites every reference, \`$ref.<key>\` too. Changing both on one block keeps it only if its settings or neighbours match, else a delete (\`E_APPLY_BLOCK_DELETE\`). One workflow variable per apply.${extra.renames ?? ''}
- **References**: \`${SOURCE_ENTRY_FILE}\` reads \`x.content\`, text as \`\` t\`…\` \`\`, env as \`env.NAME\`. A function file (\`codeFile('./functions/x.js')\`) reads \`$ref.<key>.<path>\` (key: display name lowercased, no spaces or dots), \`$ref.loop.currentItem\` / \`.index\` in a body (\`parallel\` too), \`$env.NAME\`; \`.py\`/\`.sh\` files \`<key.path>\`, \`{{NAME}}\`. A block that never ran reads \`null\` (\`''\` in text).
${PATTERNS_HEADING} (\`.sim/examples/\`, indexed atop \`cookbook.ts\`; any builder: \`${PARAMS_COMMAND} <builder>\`):
  - Condition: keys test in order, first true wins, \`else: true\` last; wire \`route.high.to(alert)\`.
  - Loop: \`const each = loop.forEach('Each Order', { collection: recent.rows }, (p) => {\`; inside, \`p.currentItem.data.orderId\` and \`p.index\`; after, \`each.results\`.
  - Failure: \`shape.onError(invalid)\`; \`invalid\` reads \`shape.error\` (an \`api\` block's too); only a Function also has \`.errorMessage\` (message only).
  - Retry: an \`api\` block's retries and retry delay are \`retries: 3\`, \`retryDelayMs: 500\` (resend the request); a block's Retry on fail is the 3rd argument, \`{ retry: { enabled: true, maxTries: 3, waitBetweenTriesMs: 2000 } }\`.
  - Child: \`const enrich = runWorkflow('Enrich Lead', {\` with \`workflowId: childWorkflow('enrich-lead')\`, \`inputMapping: { email: start.email }\`; read \`enrich.result.data.<field>\`.
  - Tables: \`table.queryRows\` outputs \`rows\` (\`recent.rows[0].data.status\`), not \`row\`; \`table.upsertRow\` takes \`conflictColumn: 'orderId'\`.
  - Rejoin: before one \`response\`, a Function picks the branch that ran with \`??\`.${extra.patterns ?? ''}
- **Credentials**: \`sim credentials connect <provider> --name "<Name>"\`, send the owner its link, then \`credential('<key>')\`.
- **Run**: \`sim workflows run <workflowId>\` runs the active deployment (\`--deployment-version <n>\`: that version); \`--draft\` runs the draft for real (use test resources); \`--dry\` runs it stubbing writes and MCP tools (even read-only: \`mcp-read-only\`), listed in \`sideEffects\` (\`dry_run_*\` placeholders; a read given one too: \`placeholder\`); GET \`api\` calls and plain-JS GET fetches run; sandboxed code (Python, shell, imports): \`unchecked\`. \`--allow <block>\` sends its writes (use test resources); \`--mock <block>='{…}'\` fixes its output (bare, with \`--mock-from <runId>\`: that run's); a child's block: \`<workflow>.<block>\`.
- **Debug**: \`--dir .\` maps a failure to file:line; \`sim logs get <runId> --trace --no-include-workflow-state\`; rows: \`sim tables rows list <table>\`; rerun: \`--from-block <block> --source-run <runId>\`; \`--stop-after <block>\`.
- **Exit codes**: 0 ok, 1 errors, ${SOURCE_STALE_EXIT_CODE} stale (redo in a fresh \`${group} get\`), ${RATE_LIMITED_EXIT_CODE} rate limited, ${SOURCE_BUSY_EXIT_CODE} busy, ${SOURCE_LOCAL_CHANGES_EXIT_CODE}/${SOURCE_DRIFT_EXIT_CODE} \`status\`: your edits / the server changed.`
}

const WORKFLOW_PRIMER = `# Sim workflow source: primer

\`${SOURCE_ENTRY_FILE}\` is a Sim workflow as TypeScript; the server compiles it statically and nothing in it runs. Commands here (table ones too) act on the workflow \`${SOURCE_BASE_FILE}\` names and its workspace (a starter's \`${SOURCE_STARTER_FILE}\` names the workspace, and its loop runs \`create\` in place of \`apply\`: no workflow exists yet).

**Edit loop**: write every file, then run one chained command; fix what it reports: \`sim workflows source check --dir . && sim workflows source apply --dir . --yes --run '{…}' --deploy\` applies, dry-runs that input, and deploys only if it completed (no \`--deploy\`: stays a draft). \`check\` also type-checks (no \`tsc\`). Apply re-checks (\`apply --dry\` only plans) and rewrites \`${SOURCE_ENTRY_FILE}\`: reread it before the next edit.

- **Scope**: the workflow alone. A table's columns and rows: \`sim tables columns update <table> --column-name <column> --updates '{…}'\`, \`sim tables rows update <table> <row> --data '{…}'\`.
- **Deletes**: removing a block or variable needs \`apply --allow-delete\`.
${sharedRules('sim workflows source')}
`

/** What a workspace directory adds to the shared rules. */
const WORKSPACE_EXTRA = {
  renames: ' A column: change its `name`, keep its key.',
  patterns:
    "\n  - Workspace: a text column is `column.string`; `deployments/<workflow key>.ts` with `defineDeployment({` and `live: 'draft'` deploys on apply.",
}

const WORKSPACE_PRIMER = `# Sim workspace source: primer

A Sim workspace as files (\`tables/\`, \`workflows/<key>/\`); nothing here runs. Commands here (table ones too) act on the workspace \`${SOURCE_BASE_FILE}\` names. Every \`.ts\` file starts with \`// @sim-sdk ${SDK_MAJOR}\`.

**Edit loop**: write every file, then run one chained command; fix what it reports: \`sim workspaces source check --dir . && sim workspaces source apply --dir . --yes\`; then \`sim workflows run <workflowId> --dry --input '{…}'\`. \`check\` also type-checks (no \`tsc\`). Apply re-checks (\`apply --dry\` only plans) and rewrites files: reread before editing.

- **Deletes**: removing a file, folder, column, block or variable needs \`apply --allow-delete\` and is permanent.
- **Exit ${SOURCE_HELD_EXIT_CODE}**: partly written: what needs an unset secret or unbound credential waits; set it, reapply.
${sharedRules('sim workspaces source', WORKSPACE_EXTRA)}
`

/**
 * The first line of the `AGENTS.md` pointer a get writes at the directory root. A root `AGENTS.md`
 * without it is the person's own, and a get never replaces it.
 */
export const AGENTS_POINTER_MARKER =
  '<!-- Written by the Sim CLI (`source get`); remove this line to keep your own edits. -->'

/**
 * The root `AGENTS.md` pointer: an agent that opens `workflow.ts` loads the nearest `AGENTS.md`
 * above it, and `.sim/` is a sibling of the source, so without this file the guide is never found.
 */
export function agentsPointer(kind: PrimerKind): string {
  const group = kind === 'workflow' ? 'sim workflows source' : 'sim workspaces source'
  return `${AGENTS_POINTER_MARKER}
# Sim ${kind} source

${kind === 'workflow' ? '`workflow.ts` is a Sim workflow as TypeScript that Sim compiles' : 'This directory is a Sim workspace as files that Sim applies'}; nothing in it runs. Read \`${SOURCE_AGENTS_FILE}\` before editing: the rules, the edit loop, patterns and exit codes.

Loop: write every file, then one chained command: \`${group} check --dir . && ${group} apply --dir . --yes${kind === 'workflow' ? " --run '{…}' --deploy" : ''}\`; fix what it reports next.${kind === 'workflow' ? ` A starter (\`${SOURCE_STARTER_FILE}\`, no workflow yet) runs \`create\` in place of \`apply\`.` : ''}
Exit codes: 0 ok, 1 errors, ${SOURCE_STALE_EXIT_CODE} stale (get a fresh copy and redo the edit), ${SOURCE_DRIFT_EXIT_CODE} \`status\`: the server changed.
`
}

/**
 * The primer for a `kind` directory, without builder snippets. The mothership worker preloads the
 * same text as its `workflow-source` skill (`scripts/print-source-primers.ts`), so an edit here
 * shows up as worker drift until the next grammar sync.
 */
export function sourcePrimer(kind: PrimerKind): string {
  return kind === 'workflow' ? WORKFLOW_PRIMER : WORKSPACE_PRIMER
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

/** The primer with the snippets of the builders `sources` call. */
export function primerFor(
  kind: PrimerKind,
  catalog: BlockCatalog,
  sources: Iterable<string>
): string {
  const snippets = builderSnippets(catalog, sources)
  return snippets ? `${sourcePrimer(kind)}\n${snippets}` : sourcePrimer(kind)
}
