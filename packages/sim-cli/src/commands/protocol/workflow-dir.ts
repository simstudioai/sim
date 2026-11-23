/**
 * A workflow source directory (`workflow.ts`, its function files, `.sim/lock.json` and
 * `.sim/base.json`): what an apply, status or check reads from it, and what a get or create writes
 * into it, so no command reads another's directory through that command's file.
 */

import { mapWithConcurrency } from '@sim/utils/concurrency'
import type { BlockCatalog } from '@sim/workflow-code'
import { parseSourceBase, parseWorkflowLock, type WorkflowLockV1 } from '@sim/workflow-code'
import { codeFileReferences } from '@sim/workflow-code/code-files/references'
import {
  CODE_FILE_EXTENSIONS,
  SOURCE_BASE_FILE,
  SOURCE_ENTRY_FILE,
  SOURCE_LOCK_FILE,
} from '@sim/workflow-code/limits'
import {
  SDK_GUIDE_FILE,
  SOURCE_COMPILER_OPTIONS,
  typecheckCommand,
} from '@sim/workflow-sdk/codegen'
import { SOURCE_PLANNED_EXIT_CODE, SOURCE_STALE_EXIT_CODE } from '../../exit-codes'
import type { ApplyWorkflowSourceBody, GetWorkflowSourceResponse } from '../../generated/v2-api'
import type { OperationClient } from '../../runtime/called-operations'
import { SourceDirError } from './local-errors'
import {
  assertSourceDirKind,
  FILE_CONCURRENCY,
  lockCodeFiles,
  readPreviousLock,
  readSourceText,
  readStarterWorkspace,
  SOURCE_SDK_DIR as SDK_DIR,
  SOURCE_EXAMPLES_DIR,
  SOURCE_STARTER_FILE,
  sourceRelativePath,
  updateSourceDir,
  writeBack,
} from './source-dir'
import { sourceExitCodesTable } from './source-exit-codes'
import { STRICT_FINDINGS_CLAUSE } from './source-strict'
import {
  assertSdkMajor,
  finishTree,
  loadCatalog,
  loadWorkspaceTypes,
  refreshTsconfigs,
  type SourceTree,
  type SourceTreeProfile,
  sourceTreeChange,
  TSCONFIG_FULL_FILE,
  TSCONFIG_MARKER,
  WORKSPACE_TYPES_FILE,
  type WorkspaceTypes,
} from './source-tree'
import { storedEdgesWrite } from './stored-edges'

type SourceBase = ApplyWorkflowSourceBody['base']

/** The only files an apply sends beside the entry: function code in a language a block runs. */
const CODE_FILE_EXTENSION = new RegExp(`\\.(?:${Object.values(CODE_FILE_EXTENSIONS).join('|')})$`)

/**
 * The text of a file the directory must hold, or a refusal that says how to write it: `hint`, or
 * for a starter no workflow was created from yet, the create that makes it one.
 */
async function requireText(directory: string, path: string, hint: string): Promise<string> {
  const text = await readSourceText(directory, path)
  if (text !== null) return text
  const starterWorkspace = await readStarterWorkspace(directory)
  throw new SourceDirError(
    `${directory} has no ${path}. ${
      starterWorkspace === null
        ? hint
        : `It holds a starter no workflow was created from yet: run \`${createCommand(directory, starterWorkspace)} --dry-run\`, then the same with --yes.`
    }`
  )
}

async function readJson(directory: string, path: string, hint: string): Promise<unknown> {
  const text = await requireText(directory, path, hint)
  try {
    return JSON.parse(text)
  } catch {
    throw new SourceDirError(`${path} in ${directory} is not valid JSON. ${hint}`)
  }
}

/**
 * The function-code files the source can reference: every `codeFile(…)` call the entry file makes,
 * found by parsing it as compile does (an aliased import or spacing before the parenthesis still
 * counts; a comment or string that spells one does not), plus every `codeFile` the lock records,
 * limited to `.js`, `.py` and `.sh` files inside the directory. Only those are sent, so a
 * reference to any other file never uploads it; the server reports a referenced file that is
 * missing or of another kind.
 */
export function codeFilePaths(entry: string | null, lock: unknown): string[] {
  const candidates = lockCodeFiles(lock)
  for (const literal of entry === null ? [] : codeFileReferences(entry)) {
    const path = sourceRelativePath(literal)
    if (path) candidates.add(path)
  }
  return [...candidates].filter((path) => CODE_FILE_EXTENSION.test(path))
}

const GET_HINT = 'Write the directory with `sim workflows source get` first.'

/**
 * The base an apply sends, refused when it is not the named workflow's: a directory written for
 * one workflow and applied to another would replace that workflow's draft with a stranger's
 * source. Without a `workflowId` the apply targets the workflow the base names.
 */
export async function readBase(
  directory: string,
  workflowId: string | undefined
): Promise<SourceBase> {
  await assertSourceDirKind(directory, 'workflow')
  const parsed = parseSourceBase(await readJson(directory, SOURCE_BASE_FILE, GET_HINT))
  if ('problem' in parsed) {
    throw new SourceDirError(
      `${SOURCE_BASE_FILE} in ${directory} is not a base: ${parsed.problem} ${GET_HINT}`
    )
  }
  const { base } = parsed
  if (workflowId !== undefined && base.workflowId !== workflowId) {
    throw new SourceDirError(
      `${directory} holds the source of workflow ${base.workflowId}, not ${workflowId}. Apply it to ${base.workflowId}, or write this workflow's source with \`sim workflows source get ${workflowId} --dir <dir>\`.`,
      { code: 'SOURCE_WORKFLOW_MISMATCH' }
    )
  }
  return base
}

/** The command that writes a fresh copy of a workflow source directory, for {@link lockRecoveryHint}. */
const WORKFLOW_GET = `\`sim workflows source get <workflowId> --dir <new dir>\`, with the id from ${SOURCE_BASE_FILE}`

/**
 * How to recover from a lock no apply accepts: the CLI writes the lock, so the fix is a copy it
 * wrote, not an edit. `get` is the command that writes a fresh directory.
 */
export function lockRecoveryHint(get: string = WORKFLOW_GET): string {
  return `Restore ${SOURCE_LOCK_FILE} from version control, or write the source into a fresh directory (${get}) and carry your edits across.`
}

function lockProblem(finding: { path?: string; message: string }): string {
  return `${finding.path ? `${finding.path}: ` : ''}${finding.message}`
}

/** The directory's lock, refused with every problem the lock parser finds. */
export async function readLock(directory: string): Promise<WorkflowLockV1> {
  const parsed = parseWorkflowLock(await readJson(directory, SOURCE_LOCK_FILE, GET_HINT))
  if (parsed.lock) return parsed.lock
  throw new SourceDirError(
    `${SOURCE_LOCK_FILE} in ${directory} is not a valid lock: ${parsed.diagnostics.map(lockProblem).join('; ')}. ${lockRecoveryHint()}`
  )
}

/** The directory's `workflow.ts`, or a refusal naming the command that writes one. */
export function requireEntry(directory: string): Promise<string> {
  return requireText(directory, SOURCE_ENTRY_FILE, GET_HINT)
}

/**
 * The files a write sends: the entry file and the code files it or the lock references. A
 * referenced file that is missing is left out, and the server reports it with its source line.
 */
export async function readSourceFiles(
  directory: string,
  lock: WorkflowLockV1 | null
): Promise<Record<string, string>> {
  const entry = await requireEntry(directory)
  const files: Record<string, string> = { [SOURCE_ENTRY_FILE]: entry }
  const paths = codeFilePaths(entry, lock)
  const texts = await mapWithConcurrency(paths, FILE_CONCURRENCY, (path) =>
    readSourceText(directory, path)
  )
  paths.forEach((path, index) => {
    const text = texts[index]
    if (text !== null) files[path] = text
  })
  return files
}

/** The create command for `dir` in `workspaceId`, as the next step a starter prints. */
export function createCommand(dir: string, workspaceId: string): string {
  return `sim workflows source create --dir ${dir} --workspace ${workspaceId}`
}

/** The public guide to workflow source, which AGENTS.md points an agent at. */
const SOURCE_DOCS_URL = 'https://docs.sim.ai/workflows/code'

type WorkflowSource = GetWorkflowSourceResponse['data']

/**
 * A `tsconfig.json` that lets an editor or `tsc -p` resolve `@sim/workflow-sdk` to the written
 * declarations and type-checks `workflow.ts` with the SDK files `sdkFiles`.
 */
function workflowTsconfig(sdkFiles: readonly string[]): string {
  return `${TSCONFIG_MARKER}\n${JSON.stringify(
    {
      compilerOptions: {
        ...SOURCE_COMPILER_OPTIONS,
        skipLibCheck: true,
        paths: { '@sim/workflow-sdk': [`./${SDK_DIR}/core.d.ts`] },
      },
      include: [SOURCE_ENTRY_FILE, ...sdkFiles],
    },
    null,
    2
  )}\n`
}

/**
 * The reference below the primer in `.sim/AGENTS.md`, by task: the edit loop in detail, a new or
 * forked workflow, the file shape, lookups, the rules and every exit code. The docs page has the
 * rest.
 */
const AGENTS_GUIDE = `# Reference

The primer above is enough to edit; read a section here when a step needs it.

## Edit loop in detail

1. Edit \`${SOURCE_ENTRY_FILE}\` (and \`functions/*\`). \`${SOURCE_EXAMPLES_DIR}/\` holds correct examples to copy from: \`cookbook.ts\` (agent with structured output, condition, function, table query and upsert, knowledge search, Slack, human in the loop, loop, response), \`integrations.ts\` (webhook trigger, weekday cron schedule, HTTP request with headers, table update by row id, Gmail, an error path) and \`agents.ts\` (router, agent tools: custom tool, MCP tool, integration operation, child workflow; run a child workflow; parallel). Their resource keys are examples; this workspace's are in \`${WORKSPACE_TYPES_FILE}\`.
2. \`sim workflows source check --dir .\`: compiles offline with the server's compiler, in milliseconds. It catches what \`tsc\` cannot (duplicate names, cycles, literal secrets), and fails (exit 1) on ${STRICT_FINDINGS_CLAUSE} in a block you added (\`--strict\`: in every block). It also adds the blocks the source now uses to \`tsconfig.json\`.
3. \`${typecheckCommand()}\`: about a second; catches what step 2 and the dry run do not (such as a reference to a start input the trigger does not declare). It runs the TypeScript release the declarations are built for (the directory has no \`package.json\`; plain \`bunx tsc\` would run whatever version it finds). \`tsconfig.json\` includes only the blocks the source used at the last check, get or apply: a builder from another block fails with \`has no exported member\` until you run step 2 (or use \`${typecheckCommand(TSCONFIG_FULL_FILE)}\`, every current block). The dry run is the authority: a printed line you did not edit that \`tsc\` flags and the dry run accepts is fine.
4. \`sim workflows source status --dir .\`: the files you changed (\`sim workflows source diff --dir .\` shows the edits), whether the workflow changed on the server since the get, and the command to run next (\`--offline\`: skip the server). Then \`sim workflows source apply --dir . --dry-run\` until it exits 0.
5. \`sim workflows source apply --dir . --yes\`: saves the draft, refusing errors, block deletions without \`--allow-delete\` and a stale directory, so it needs no separate dry run (without \`--yes\` and a terminal it prints the plan and exits ${SOURCE_PLANNED_EXIT_CODE}). \`--deploy\` also deploys it; without it, a deployed workflow's next \`sim workflows deploy <id> --expected-draft-fingerprint <fingerprint>\` is printed, which deploys only the draft this apply saved. It then rewrites \`${SOURCE_ENTRY_FILE}\` in canonical form (order, quoting, defaults left out).
6. Exit ${SOURCE_STALE_EXIT_CODE} (\`SOURCE_STALE\`, HTTP 409, or \`E_APPLY_STALE\` on a dry run): the workflow changed and nothing was saved. Run \`sim workflows source get <workflowId> --dir <fresh dir>\`, reapply your edit there, dry-run, apply. A get into this directory refuses to overwrite your unapplied edits unless you pass \`--force\`. Exit ${SOURCE_STALE_EXIT_CODE} right after an apply that ended without an answer (a timeout, a dropped connection) means the draft changed, by that apply or by someone else: get into a fresh directory and compare. Only when it holds your edit, run \`sim workflows source get <workflowId> --dir . --force\`; otherwise reapply your edit in the fresh directory.

Editing the \`workflow('…')\` name or description renames or redescribes the workflow; a name another workflow in its folder holds is refused with \`E_NAME_TAKEN\`. Lines starting \`note:\` explain something the write did differently than the source says; read them.

## A new workflow, or a fork

\`sim workflows source create --dir <new dir> --workspace <workspaceId>\` (without \`--dry-run\` or \`--yes\`) on a directory without \`${SOURCE_ENTRY_FILE}\` writes a starter \`${SOURCE_ENTRY_FILE}\`, the types of that workspace, \`tsconfig.json\` and this guide, records the workspace in \`${SOURCE_STARTER_FILE}\`, and creates nothing. Until the workflow exists there is no \`${SOURCE_BASE_FILE}\`, so \`status\`, \`diff\` and \`apply\` refuse the directory: edit the starter, check and type-check it, then \`sim workflows source create --dir <dir> --workspace <workspaceId> --dry-run\` and the same with \`--yes\` (the starter prints both with its workspace filled in): it prints the new workflow id and writes the lock files. A create goes to the starter's workspace whatever the profile's default, unless \`--workspace\` names another. Exit 1 with \`SOURCE_NAME_TAKEN\` means another workflow has that name: pass \`--name\`. To fork a workflow, copy its directory, delete the copy's \`.sim/\` and run \`sim workflows source create --dir <copy> --workspace <workspaceId> --name <new name> --yes\`.

## File shape

\`\`\`ts
// @sim-sdk 1
import { response, trigger, workflow } from '@sim/workflow-sdk'

export default workflow('Workflow name', {}, () => {
  const start = trigger.start('Start', {})
  const done = response('Done', { body: { ok: true } })

  start.to(done)
})
\`\`\`

The \`// @sim-sdk 1\` header must be the first line, and the file has exactly one \`export default workflow(name, options, () => { ... })\`; \`options\` holds \`description\` and \`variables\` and may be \`{}\`.

## Finding a builder and its types

- \`sim workflows source params <builder>\`: one builder's params (required first, enums, defaults) and outputs; a namespace (\`gmail\`) lists its builders; a miss names the closest. Builders are named for the service, not the block type: \`gmail_v2\` is \`gmail.*\`, \`workflow_input\` is \`runWorkflow\`, the HTTP request block is \`api\`, and \`legacy.*\` builders are old versions not to write.
- \`${SDK_DIR}/core.d.ts\`: the SDK (\`workflow\`, \`t\`, \`env\`, \`credential\`, \`table\`, \`loop\`, \`parallel\`, \`BlockMeta\`).
- \`${SDK_DIR}/blocks/<block type>.d.ts\`: the builders of a block the source uses, with their params and outputs (check adds the file of a block an edit starts using). Do not read them, or \`${SDK_DIR}/models.d.ts\`, whole: \`params\` prints the part you need, and \`grep\` finds a model id.
- \`${WORKSPACE_TYPES_FILE}\`: this workspace's tables, knowledge bases, credentials, workflows, skills, custom tools, MCP servers and env names.

## Rules

- Beside the header and the imports from \`@sim/workflow-sdk\`, the file holds only the default-exported workflow. Its callback holds block declarations (\`const x = builder('Name', params)\`) and wiring (\`x.to(y)\`). Helpers, loops, conditionals and other imports have no stored form, so the compiler refuses them: use \`loop.forEach\`, \`condition\` and \`runWorkflow\` blocks instead.
- Logic that does not fit a block goes in a function block with \`code: codeFile('./functions/name.js')\` (references as the primer says).
- Hosted Sim supplies an agent's model key. On self-hosted Sim the agent needs \`apiKey: env.NAME\` (a secret the workspace holds); without it \`check\` reports \`W_REQUIRED_MISSING: apiKey is required\`.
- A child workflow's output is \`c.result\`, untyped: its \`response\` block's \`{ data, status, headers }\`, so a field of the child's response body is \`c.result.data.field\` (\`${SDK_DIR}/${SDK_GUIDE_FILE}\` "How it runs" has the rest).
- A table block's row is \`{ id, data }\`: read a cell as \`row.data.column\` (in a loop over \`query.rows\`, \`p.currentItem.data.column\`).
- Keep \`${SOURCE_LOCK_FILE}\` and \`${SOURCE_BASE_FILE}\` as written: they bind each block to its stored id and make the next apply safe.

## Diagnostics and exit codes

Findings print as \`file:line:column severity CODE: message\`, then the code frame and a hint. \`E_*\` refuses the whole apply; \`W_*\` is saved as written and names a real problem. \`check\` prints the \`W_*\` codes it fails on as \`error\` on a block you added; the apply still saves them as warnings. A path no output has (\`W_UNKNOWN_OUTPUT_PATH\`), in a block you added or changed, is the error \`E_APPLY_UNRESOLVED_REF\` in both, whatever \`--strict\` says; a path the run may still resolve (\`W_OUTPUT_PATH_UNDECLARED\`: an input the start does not declare, \`x.error\` with no error edge) stays a warning. Exit codes of every \`workflows source\` command:

${sourceExitCodesTable('sim workflows source')}

The full guide: ${SOURCE_DOCS_URL}
`

/** The printed source a tree write saves: a get's answer, or an applied create's. */
export type PrintedSource = Pick<
  WorkflowSource,
  'workflowId' | 'workspaceId' | 'files' | 'lock' | 'base'
>

/**
 * Writes the source tree in one staged update. Declarations are regenerated only when the index
 * on disk names another catalog or another generator, and replaced whole so a block the catalog
 * dropped loses its file. A refused manifest removes the `workspace.d.ts` an earlier get wrote,
 * function files the new lock no longer names are pruned, `.gitattributes` gains the LF lines it
 * lacks, and a `tsconfig.json` the CLI did not write is left as it is.
 */
async function writeSourceTree(
  dir: string,
  source: PrintedSource,
  catalog: BlockCatalog,
  workspaceTypes: WorkspaceTypes | null,
  blockTypes: readonly string[]
): Promise<SourceTree> {
  const [previousLock, tree] = await Promise.all([
    readPreviousLock(dir),
    sourceTreeChange(dir, catalog, workspaceTypes, WORKFLOW_TREE, {
      sources: [source.files[SOURCE_ENTRY_FILE] ?? ''],
      blockTypes,
    }),
  ])
  const edges = storedEdgesWrite(source, catalog)
  const written = await writeBack(
    dir,
    source,
    previousLock,
    edges ? { ...tree.change, write: [...tree.change.write, edges] } : tree.change
  )
  return finishTree(dir, written, workspaceTypes, tree)
}

/** The workflow directory's tree beside the printed source. */
export const WORKFLOW_TREE: SourceTreeProfile = {
  kind: 'workflow',
  agents: AGENTS_GUIDE,
  tsconfig: workflowTsconfig,
}

/** The `workflow.ts` a new directory starts from: the smallest workflow that compiles. */
const STARTER_SOURCE = `// @sim-sdk 1
import { response, trigger, workflow } from '@sim/workflow-sdk'

export default workflow('New workflow', { description: 'Describe what this workflow does.' }, () => {
  const start = trigger.start('Start', { inputFormat: { message: 'string' } })
  const done = response('Done', { body: { received: start.message } })

  start.to(done)
})
`

/**
 * Starts a new source directory: a starter `workflow.ts` plus the tree a get writes (the
 * declarations for the workspace catalog and its resources, `tsconfig.json`, the agent guide),
 * with no lock or base, since no workflow exists yet, and {@link SOURCE_STARTER_FILE} naming the
 * workspace those declarations are for. Only for a directory with no `workflow.ts`.
 */
export async function writeSourceScaffold(
  client: OperationClient<'getSourceCatalog' | 'getSourceResources'>,
  dir: string,
  workspaceId: string
): Promise<SourceTree> {
  const [catalog, workspaceTypes] = await Promise.all([
    loadCatalog(client, { workspaceId, blockTypes: [] }),
    loadWorkspaceTypes(client, workspaceId),
  ])
  assertSdkMajor(catalog)
  const tree = await sourceTreeChange(dir, catalog, workspaceTypes, WORKFLOW_TREE, {
    sources: [STARTER_SOURCE],
  })
  const write = [
    [SOURCE_ENTRY_FILE, STARTER_SOURCE] as const,
    [SOURCE_STARTER_FILE, `${JSON.stringify({ workspaceId }, null, 2)}\n`] as const,
    ...tree.change.write,
  ]
  await updateSourceDir(dir, { ...tree.change, write })
  return finishTree(dir, write.length, workspaceTypes, tree)
}

/**
 * Writes a printed source with everything that makes the directory editable: the declarations
 * for the workspace catalog and its resources, `tsconfig.json`, the agent guide and the LF lines.
 * Shared by `get --dir` and `create --dir`, so a created workflow's directory is the one a get
 * would have written.
 */
export async function writeSourceDirectory(
  client: OperationClient<'getSourceCatalog' | 'getSourceResources'>,
  dir: string,
  source: PrintedSource,
  blockTypes: readonly string[]
): Promise<SourceTree> {
  const [catalog, workspaceTypes] = await Promise.all([
    loadCatalog(client, {
      workspaceId: source.workspaceId,
      workflowId: source.workflowId,
      catalogHash: source.base.catalogHash,
      blockTypes: [...blockTypes],
    }),
    loadWorkspaceTypes(client, source.workspaceId),
  ])
  assertSdkMajor(catalog)
  return writeSourceTree(dir, source, catalog, workspaceTypes, blockTypes)
}

/**
 * After an apply, points the CLI's tsconfig files at the blocks the applied source uses, so a
 * block the edit added is type-checked by `tsconfig.json` from then on.
 */
export async function refreshWorkflowTsconfigs(
  dir: string,
  source: Pick<PrintedSource, 'workspaceId' | 'files'>
): Promise<void> {
  await refreshTsconfigs(dir, source.workspaceId, WORKFLOW_TREE, {
    sources: [source.files[SOURCE_ENTRY_FILE] ?? ''],
  })
}
