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
import { SOURCE_AGENTS_FILE } from './source-dir'

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
  return `- **Identity**: a block is its entry in \`${SOURCE_LOCK_FILE}\`, which binds it by its const name or its display name. Change the display name (first argument) freely: references through the const follow it, and the apply rewrites every \`$ref.<old key>\` and \`<old key.…>\` for you. Renaming the const too keeps it when settings, neighbours or references still tie it to the old block; otherwise the apply refuses a delete (\`E_APPLY_BLOCK_DELETE\`).
- **References**: in \`${SOURCE_ENTRY_FILE}\` read an output as \`x.content\`, a loop or parallel item as \`p.currentItem\` (\`p.index\`), text as \`\` t\`…\` \`\`, env as \`env.NAME\`. In a function file (\`codeFile('./functions/x.js')\`) read an output as \`$ref.<key>.<path>\`, the key: the display name lowercased, whitespace and dots removed ("Triage Agent" → \`$ref.triageagent.content\`); in a loop body \`$ref.loop.currentItem\` / \`$ref.loop.index\`, in a parallel \`$ref.parallel.currentItem\` / \`$ref.parallel.index\`; env as \`$env.NAME\`. In \`.py\`/\`.sh\` files write \`<key.path>\` and \`{{NAME}}\`, not \`$ref\`/\`$env\`. Read an index or item only inside its container (\`E_APPLY_REF_OUT_OF_SCOPE\`), after it its \`.results\`. A \`$ref\` naming no block is an error in a function file you edited (\`E_APPLY_UNRESOLVED_REF\`).
- **Renames**: one variable per apply (two at once read as a delete and an add).${extraRenames}
- **Look up a builder**: \`${PARAMS_COMMAND} <builder>\` (a namespace like \`gmail\` lists them).
- **Credentials**: \`sim credentials connect <provider> --name "<Name>"\`, give the owner its link, then \`credential('<key>')\` (\`sim workflows source resources\`).
- **Failures**: \`x.onError(y)\` runs \`y\` when \`x\` fails, reading the message as \`x.error\` (a Function's \`x.errorMessage\` drops the line and code: reply with it). Retry is block meta (third argument): \`agent('Name', {…}, { retry: { enabled: true, maxTries: 3, waitBetweenTriesMs: 2000 } })\`. A reference to a block that did not run is \`null\` (a whole value, function code, a condition) or \`''\` in text. Branches may rejoin; only branches that end separately each need a \`response\`.
- **Run and debug**: \`--manual\` runs the saved draft, without it the deployed version. Runs write real data (rows, emails): use test resources. With \`--dir <the workflow's folder>\`, a failed run names the failing file and line; then \`sim logs get <runId> --trace --no-include-workflow-state\`; rows: \`sim tables rows list <table name>\`.
- **Exit codes**: 0 ok, 1 errors, ${SOURCE_STALE_EXIT_CODE} stale (\`${group} get --dir <fresh dir>\`, redo the edit there), ${RATE_LIMITED_EXIT_CODE} rate limited, ${SOURCE_BUSY_EXIT_CODE} busy, ${SOURCE_LOCAL_CHANGES_EXIT_CODE}/${SOURCE_DRIFT_EXIT_CODE} \`status\`: your edits / the server changed.`
}

const WORKFLOW_PRIMER = `# Sim workflow source: primer

\`${SOURCE_ENTRY_FILE}\` is a Sim workflow as TypeScript; the server compiles it statically and nothing in it runs. Commands read the workflow id from \`${SOURCE_BASE_FILE}\`; run them from this directory.

**Edit loop**: write every file, then run one chained command and fix what it reports next: \`sim workflows source check --dir . && sim workflows source apply --dir . --yes && sim workflows run <workflowId> --manual --input '{…}'\`. A non-zero exit stops the chain. \`check\` compiles and type-checks (no separate \`tsc\`). Apply re-checks the source and its base, so \`apply --dry-run\` is only the review for people and CI. Apply saves the draft in canonical form: read \`${SOURCE_ENTRY_FILE}\` again before the next edit.

- **Deletes**: removing a block or a variable needs \`apply --allow-delete\` (\`E_APPLY_BLOCK_DELETE\` / \`E_APPLY_VARIABLE_DELETE\`).
- **Deploy**: apply saves a draft; \`apply --deploy\` also deploys it, or \`sim workflows deploy <workflowId>\` publishes the saved draft later.
${sharedRules('sim workflows source')}
`

/** What a rename in a workspace directory rewrites beyond a workflow's own blocks. */
const WORKSPACE_RENAMES =
  " A column: change its \`name\`, keep its key (cells stay). Table blocks (\`data\`, \`conflictColumn\`, filters) use the name, not the key, and keep old names (\`W_TABLE_COLUMN_RENAMED_IN_USE\`). A file's key never changes (\`E_KEY_RENAMED\`): rename by \`name\`."

const WORKSPACE_PRIMER = `# Sim workspace source: primer

This directory is a Sim workspace as files (\`tables/\`, \`workflows/<key>/workflow.ts\`, …); nothing in it runs. Commands read the workspace id from \`${SOURCE_BASE_FILE}\`; run them from this directory. Every \`.ts\` file, \`deployments/\` too, starts with \`// @sim-sdk ${SDK_MAJOR}\`.

**Edit loop**: write every file, then run one chained command and fix what it reports next: \`sim workspaces source check --dir . && sim workspaces source apply --dir . --yes\` (add a \`sim workflows run\` to test). A non-zero exit stops the chain. \`check\` compiles and type-checks (no separate \`tsc\`). Apply re-checks the source and its base, so \`apply --dry-run\` is only the review for people and CI. Apply rewrites the directory: read a file again before the next edit.

- **Deletes**: a file or folder missing from a kind's folder, or a removed table column, workflow block or variable, is a delete: refused without \`apply --allow-delete\`, and it cannot be undone.
- **Deploy**: \`deployments/<workflow key>.ts\` (\`defineDeployment({ live: 'draft' })\`) deploys that workflow on apply; without one, apply never deploys.
- **Exit ${SOURCE_HELD_EXIT_CODE}**: written in part; changes using an unset secret or unbound credential were held back: set it, apply again.
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

/** The primer for a `kind` directory, without builder snippets. */
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
