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
  typecheckCommand,
} from '@sim/workflow-sdk/codegen'
import {
  RATE_LIMITED_EXIT_CODE,
  SOURCE_BUSY_EXIT_CODE,
  SOURCE_DRIFT_EXIT_CODE,
  SOURCE_LOCAL_CHANGES_EXIT_CODE,
  SOURCE_STALE_EXIT_CODE,
} from '../../exit-codes'
import { SOURCE_AGENTS_FILE } from './source-dir'

/** Which directory a primer is for. */
export type PrimerKind = 'workflow' | 'workspace'

/** The primer without its builder snippets stays within this many bytes. */
export const PRIMER_MAX_BYTES = 3072

/** At most this many snippets, and this many bytes of them; the rest are named for `params`. */
const MAX_SNIPPETS = 12
const MAX_SNIPPET_BYTES = 4096

/** The command that prints any builder's params (`workflow-source-params.ts`). */
const PARAMS_COMMAND = 'sim workflows source params'

/** The rules every source directory shares, after the kind's own edit loop. */
function sharedRules(group: string): string {
  return `- **Identity**: a block is its entry in \`${SOURCE_LOCK_FILE}\`, which binds it by its const name or its display name. Change the display name (first argument) freely: the block keeps its id. Renaming the const too keeps the id when its settings, neighbours or references still tie it to the old block; otherwise the apply refuses it as a delete (\`E_APPLY_BLOCK_DELETE\`), and the dry run names it. Safest: keep the const in the same apply.
- **References**: in \`${SOURCE_ENTRY_FILE}\` read an output as \`x.content\`, a loop or parallel item as \`p.currentItem\` (\`p.index\`), text as \`\` t\`…\` \`\`, env as \`env.NAME\`. In a function code file (\`codeFile('./functions/x.js')\`) read an output as \`$ref.<key>.<path>\`, the key being the display name lowercased with whitespace and dots removed ("Triage Agent" → \`$ref.triageagent.content\`); in a loop body \`$ref.loop.currentItem\` / \`$ref.loop.index\`, in a parallel \`$ref.parallel.currentItem\` / \`$ref.parallel.index\`; env as \`$env.NAME\`. An index or item is read only from a block inside its container: outside it (\`lp.index\` after the loop, or a block moved out) the run fails, which the apply refuses (\`E_APPLY_REF_OUT_OF_SCOPE\`); read \`lp.results\` after the loop instead. A rename keeps its references working: the apply rewrites every \`$ref.<old key>\` in the function files to the new key (and the files it writes back hold it), so leave them or write the new key yourself. A \`$ref\` that names no block is an error in a function file you edited (\`E_APPLY_UNRESOLVED_REF\` in \`check\` and the dry run).
- **Look up a builder**: \`${PARAMS_COMMAND} <builder>\` (\`table.upsertRow\`, \`agent\`, \`trigger.schedule\`; a namespace such as \`gmail\` lists its builders), offline.
- **Exit codes**: 0 ok, 1 errors (fix what it printed), ${SOURCE_STALE_EXIT_CODE} stale (\`${group} get --dir <fresh dir>\`, redo the edit there), ${RATE_LIMITED_EXIT_CODE} rate limited, ${SOURCE_BUSY_EXIT_CODE} busy, ${SOURCE_LOCAL_CHANGES_EXIT_CODE}/${SOURCE_DRIFT_EXIT_CODE} \`status\`: your edits / the server changed. Every code: \`${SOURCE_AGENTS_FILE}\`.`
}

const WORKFLOW_PRIMER = `# Sim workflow source: primer

\`${SOURCE_ENTRY_FILE}\` is a Sim workflow as TypeScript; the server compiles it statically and nothing in it runs. Commands read the workflow id from \`${SOURCE_BASE_FILE}\`; run them from this directory.

**Edit loop**: edit \`${SOURCE_ENTRY_FILE}\` (and \`functions/*\`) → \`sim workflows source check --dir .\` (offline; it also adds new blocks to \`tsconfig.json\`) → \`${typecheckCommand()}\` → \`sim workflows source apply --dir . --dry-run\` → \`--yes\`. Rerun each step until it exits 0. Apply saves the draft in canonical form: read \`${SOURCE_ENTRY_FILE}\` again before the next edit.

- **Deletes**: removing a block's declaration deletes the block only with \`apply --allow-delete\`; without it the apply is refused (\`E_APPLY_BLOCK_DELETE\`).
- **Deploy**: apply saves a draft; \`apply --deploy\` also deploys it, or \`sim workflows deploy <workflowId>\` publishes the saved draft later.
${sharedRules('sim workflows source')}
`

const WORKSPACE_PRIMER = `# Sim workspace source: primer

This directory is a Sim workspace as files (\`tables/\`, \`workflows/<key>/workflow.ts\`, …); the server reads them statically and nothing runs. Commands read the workspace id from \`${SOURCE_BASE_FILE}\`; run them from this directory.

**Edit loop**: edit the files → \`sim workspaces source check --dir .\` (offline; regenerates \`.sim/sdk/workspace.d.ts\`, adds new blocks to \`tsconfig.json\`) → \`${typecheckCommand()}\` → \`sim workspaces source apply --dir . --dry-run\` (the plan) → \`--yes\`. Rerun each step until it exits 0. Apply rewrites the directory from what it stored: read a file again before the next edit.

- **Deletes**: a removed file (a resource this directory managed), table column or workflow block is deleted only with \`apply --allow-delete\`; without it the apply is refused. A kind is managed only when its folder exists. Deletes cannot be undone.
- **Deploy**: \`deployments/<workflow key>.ts\` (\`defineDeployment({ live: 'draft' })\`) deploys that workflow on apply; without one, apply never deploys.
${sharedRules('sim workspaces source')}
`

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
