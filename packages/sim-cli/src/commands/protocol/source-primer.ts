/**
 * The primer a source get prints and writes atop `.sim/AGENTS.md`: the few rules an agent needs to
 * edit a source directory without reading the guide, plus a snippet for each builder the source
 * already calls, so the blocks in front of it need no lookup. The guide below it is the reference.
 */
import type { BlockCatalog } from '@sim/workflow-code'
import { SOURCE_BASE_FILE, SOURCE_ENTRY_FILE, SOURCE_LOCK_FILE } from '@sim/workflow-code/limits'
import { SDK_SPECIAL_BUILDERS } from '@sim/workflow-code/sdk'
import {
  builderSnippet,
  describeBuilder,
  referencedBuilders,
  SDK_MAJOR,
} from '@sim/workflow-sdk/codegen'
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

/** The rules every source directory shares, after the kind's own edit loop. */
function sharedRules(group: string, extraRenames = ''): string {
  return `- **Identity**: a block is its entry in \`${SOURCE_LOCK_FILE}\`, bound by its const or display name. Rename display names (first argument) or consts, any number per apply, with other edits: apply rewrites every reference, \`$ref.<key>\` too. Renaming both a block's const and display name (one such block per apply) keeps it if settings, neighbours or references match, else a delete (\`E_APPLY_BLOCK_DELETE\`).
- **References**: in \`${SOURCE_ENTRY_FILE}\` read an output as \`x.content\`, a loop or parallel item as \`p.currentItem\` (\`p.index\`), a child call \`runWorkflow('Name', { workflowId: childWorkflow('<key>') })\`'s response field as \`c.result.data.<field>\` (typed by its \`response\`), text as \`\` t\`…\` \`\`, env as \`env.NAME\`. In a function file (\`codeFile('./functions/x.js')\`) read an output as \`$ref.<key>.<path>\`, key: the display name lowercased, no whitespace or dots ("Triage Agent" → \`$ref.triageagent.content\`); in a loop body \`$ref.loop.currentItem\` / \`$ref.loop.index\` (a parallel: \`$ref.parallel.…\`); env as \`$env.NAME\`. In \`.py\`/\`.sh\` files: \`<key.path>\` and \`{{NAME}}\`, not \`$ref\`/\`$env\`. Read an index or item only inside its container (\`E_APPLY_REF_OUT_OF_SCOPE\`), after it its \`.results\`. A \`$ref\` naming no block errors in a function file you edited (\`E_APPLY_UNRESOLVED_REF\`).
- **Renames**: one workflow variable per apply (two at once: delete + add).${extraRenames}
- **Builders**: \`${PARAMS_COMMAND} <builder>\` (or a namespace).
- **Credentials**: \`sim credentials connect <provider> --name "<Name>"\`, give the owner its link, then \`credential('<key>')\` (\`sim workflows source resources\`).
- **Failures**: \`x.onError(y)\` runs \`y\` when \`x\` fails, with the message in \`x.error\` (a Function's \`x.errorMessage\` lacks line and code: reply with it). Retry is block meta (3rd argument): \`agent('Name', {…}, { retry: { enabled: true, maxTries: 3 } })\` reruns a failed block; an \`api\` block's \`retries\` repeat only its request (timeout, reset, 429, 5xx) per try. A reference to a block that never ran is \`null\` (\`''\` in text). Branches may rejoin before one \`response\` (a function picks the value with \`??\`: \`.sim/examples/cookbook.ts\`); branches ending apart each need one.
- **Run and debug**: \`--dry\` runs the draft, stubbing writes (\`sideEffects.stubbed\`); code runs for real (\`sideEffects.unchecked\`). \`--manual\` and \`--allow <block>\` write real data: use test resources. Else the deployment runs. \`--dir <folder>\` names a failed run's file and line; then \`sim logs get <runId> --trace --no-include-workflow-state\`; rows: \`sim tables rows list <table>\`. Rerun from a block: \`--from-block <block> --source-run <runId>\` (a failed run's \`next\`); \`--stop-after <block>\` stops after it.
- **Exit codes**: 0 ok, 1 errors, ${SOURCE_STALE_EXIT_CODE} stale (redo the edit in a fresh \`${group} get\`), ${RATE_LIMITED_EXIT_CODE} rate limited, ${SOURCE_BUSY_EXIT_CODE} busy, ${SOURCE_LOCAL_CHANGES_EXIT_CODE}/${SOURCE_DRIFT_EXIT_CODE} \`status\`: your edits / the server changed.`
}

const WORKFLOW_PRIMER = `# Sim workflow source: primer

\`${SOURCE_ENTRY_FILE}\` is a Sim workflow as TypeScript; the server compiles it statically and nothing in it runs. Run commands here: they read the workflow id from \`${SOURCE_BASE_FILE}\` (a starter has none: \`${SOURCE_STARTER_FILE}\` names its workspace, and its loop ends in \`sim workflows source create --dir . --yes\`, not \`apply\`, which makes the workflow), and each (table commands too) acts on its workspace; source commands refuse a \`-w\` naming another; others follow it.

**Edit loop**: write every file, then run one chained command; fix what it reports: \`sim workflows source check --dir . && sim workflows source apply --dir . --yes && sim workflows run <workflowId> --dry --input '{…}'\`. A non-zero exit stops the chain. \`check\` also type-checks (no \`tsc\`). Apply re-checks: \`apply --dry-run\` only reviews. Apply saves the draft in canonical form: read \`${SOURCE_ENTRY_FILE}\` again before the next edit.

- **Deletes**: removing a block or a variable needs \`apply --allow-delete\` (\`E_APPLY_BLOCK_DELETE\` / \`E_APPLY_VARIABLE_DELETE\`).
- **Deploy**: apply saves a draft; \`apply --deploy\` also deploys it, or \`sim workflows deploy <workflowId>\` publishes the saved draft later.
${sharedRules('sim workflows source')}
`

/** What a rename in a workspace directory rewrites beyond a workflow's own blocks. */
const WORKSPACE_RENAMES =
  " A column or file: change its \`name\`, keep its key (cells stay; a file's never changes: \`E_KEY_RENAMED\`). Table blocks (\`data\`, \`conflictColumn\`, filters) use column names and keep old ones (\`W_TABLE_COLUMN_RENAMED_IN_USE\`)."

const WORKSPACE_PRIMER = `# Sim workspace source: primer

A Sim workspace as files (\`tables/\`, \`workflows/<key>/\`); nothing here runs. Commands here (table commands too) act on the workspace \`${SOURCE_BASE_FILE}\` names; source commands refuse a \`-w\` naming another; others follow it. Every \`.ts\` file starts with \`// @sim-sdk ${SDK_MAJOR}\`.

**Edit loop**: write every file, then run one chained command; fix what it reports: \`sim workspaces source check --dir . && sim workspaces source apply --dir . --yes\`; test with \`sim workflows run <workflowId> --dry --input '{…}'\`. \`check\` also type-checks (no \`tsc\`). Apply re-checks: \`apply --dry-run\` only reviews. Apply rewrites files: reread before editing.

- **Deletes**: removing a file, folder, column, block or variable needs \`apply --allow-delete\` and is permanent.
- **Deploy**: \`deployments/<workflow key>.ts\` (\`defineDeployment({ live: 'draft' })\`) deploys on apply; no file, no deploy.
- **Exit ${SOURCE_HELD_EXIT_CODE}**: partly written; changes needing an unset secret or unbound credential wait: set it, reapply.
${sharedRules('sim workspaces source', WORKSPACE_RENAMES)}
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

${kind === 'workflow' ? '`workflow.ts` is a Sim workflow as TypeScript that Sim compiles' : 'This directory is a Sim workspace as files that Sim applies'}; nothing in it runs. Read \`${SOURCE_AGENTS_FILE}\` before editing: the rules, the edit loop and every exit code.

Loop: write every file, then one chained command: \`${group} check --dir . && ${group} apply --dir . --yes\`; fix what it reports next.
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
