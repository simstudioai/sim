import { toRecord } from '@sim/utils/object'
import type { BlockCatalog } from '@sim/workflow-code'
import { SOURCE_BASE_FILE, SOURCE_ENTRY_FILE, SOURCE_LOCK_FILE } from '@sim/workflow-code/limits'
import {
  SDK_GUIDE_FILE,
  SOURCE_COMPILER_OPTIONS,
  typecheckCommand,
} from '@sim/workflow-sdk/codegen'
import type { Command } from 'commander'
import type { GetWorkflowSourceResponse } from '../../generated/v2-api'
import { SimApiError } from '../../http/client'
import { callsOperations, type OperationClient } from '../../runtime/called-operations'
import { buildRequest } from '../../runtime/request'
import { printProtocolResult } from './result'
import {
  absoluteDirOption,
  assertPrintedSourcePaths,
  locallyEditedFiles,
  readPreviousLock,
  readSourceJson,
  SOURCE_SDK_DIR as SDK_DIR,
  SOURCE_EXAMPLES_DIR,
  SOURCE_STARTER_FILE,
  updateSourceDir,
  WORKSPACE_FOLDER_BUSY_HELP,
  withWorkspaceFolderLock,
  writeBack,
} from './source-dir'
import { sourceExitCodesTable } from './source-exit-codes'
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
  withSourceExitCode,
} from './source-tree'
import { storedEdgesWrite } from './stored-edges'

const DIR_FLAG = 'dir'
const FORCE_FLAG = 'force'
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

/** The guide an agent working in the directory reads first; the docs page has the rest. */
const AGENTS_GUIDE = `# Sim workflow source

This directory is a Sim workflow written as TypeScript. The server compiles \`${SOURCE_ENTRY_FILE}\` statically; nothing in it runs. The workflow id is \`workflowId\` in \`${SOURCE_BASE_FILE}\`; every command below reads it from there.

## Start here

1. Read the examples in \`${SOURCE_EXAMPLES_DIR}/\` before writing: \`cookbook.ts\` (agent with structured output, condition, function, table query and insert, knowledge search, Slack, human in the loop, loop, response), \`integrations.ts\` (webhook trigger, weekday cron schedule, HTTP request with headers, table update by row id, Gmail, an error path) and \`agents.ts\` (router, agent tools: custom tool, MCP tool, integration operation, child workflow; run a child workflow; parallel). Their resource keys are examples; this workspace's are in \`${WORKSPACE_TYPES_FILE}\`.
2. For any other block, find its builder in \`${SDK_DIR}/${SDK_GUIDE_FILE}\` (one line per builder: \`grep -i "gmail" ${SDK_DIR}/${SDK_GUIDE_FILE}\`). It names the builder, the file and the params type; read just that type: \`grep -n -A40 "export type GmailSendEmailParams" ${SDK_DIR}/blocks/gmail_v2.d.ts\`. Builders are named for the service, not the block type: \`gmail_v2\` is \`gmail.*\`, \`workflow_input\` is \`runWorkflow\`, the HTTP request block is \`api\`, and \`legacy.*\` builders are old versions not to write.
3. Do not read \`${SDK_DIR}/blocks/*.d.ts\` or \`${SDK_DIR}/models.d.ts\` whole: they are large. \`grep\` them for a type or a model id.

## Edit loop (run from this directory)

1. Edit \`${SOURCE_ENTRY_FILE}\` (and \`functions/*\`).
2. \`sim workflows source check --dir .\`: compiles offline with the server's compiler, in milliseconds. It catches what \`tsc\` cannot (duplicate names, cycles, literal secrets), and fails (exit 1) on a missing required field, an unknown option or output path, a wrong value kind, an out-of-range value, an unwired condition or router branch or a literal secret in a block you added (\`--strict\`: in every block). It also adds the blocks the source now uses to \`tsconfig.json\`. Fix and rerun until it exits 0.
3. Run \`${typecheckCommand()}\` after every edit, before any dry run or apply, and fix what it reports: it takes about a second and catches what step 2 and the dry run do not (such as a reference to a start input the trigger does not declare). It type-checks with the TypeScript release the declarations are built for (the directory has no \`package.json\`; plain \`bunx tsc\` would run whatever version it finds). \`tsconfig.json\` includes only the blocks the source used at the last check, get or apply, which keeps it fast: a builder from another block fails with \`has no exported member\` until you run step 2 (or check with \`${typecheckCommand(TSCONFIG_FULL_FILE)}\`, every current block). The dry run is the authority: a printed line you did not edit that \`tsc\` flags and the dry run accepts is fine, so leave it as it is.
4. \`sim workflows source status --dir .\` before applying: the files you changed (\`sim workflows source diff --dir .\` shows the edits), whether the workflow changed on the server since the get, and the command to run next. Exit 0 nothing changed, 11 only your edits, 12 the server changed it since (\`--offline\`: skip the server). Then \`sim workflows source apply --dir . --dry-run\`: fix every error it prints, rerun until it exits 0.
5. \`sim workflows source apply --dir . --yes\`: saves the draft, refusing errors, block deletions without \`--allow-delete\` and a stale directory, so it needs no separate dry run (without \`--yes\` and a terminal it prints the plan and exits 14). \`--deploy\` also deploys it; without it, a deployed workflow's next \`sim workflows deploy <id>\` is printed. It then rewrites \`${SOURCE_ENTRY_FILE}\` in canonical form (order, quoting, defaults left out), so read the file again before the next edit rather than editing from memory.
6. Exit 5 (\`SOURCE_STALE\`, HTTP 409, or \`E_APPLY_STALE\` on a dry run): the workflow changed and nothing was saved. Run \`sim workflows source get <workflowId> --dir <fresh dir>\`, reapply your edit there, dry-run, apply. A get into this directory refuses to overwrite your unapplied edits unless you pass \`--force\`. Exit 5 right after an apply that ended without an answer (a timeout, a dropped connection) means the draft changed, by that apply or by someone else: get into a fresh directory and compare it with this one. Only when it holds your edit, run \`sim workflows source get <workflowId> --dir . --force\`; otherwise reapply your edit in the fresh directory.

An apply that deletes blocks (a declaration removed from \`${SOURCE_ENTRY_FILE}\`) is refused with \`E_APPLY_BLOCK_DELETE\` naming them; pass \`--allow-delete\` when the deletion is intended. Editing the \`workflow('…')\` name or description renames or redescribes the workflow; a name another workflow in its folder holds is refused with \`E_NAME_TAKEN\`.

Lines starting \`note:\` explain something the write did differently than the source says; read them.

A new workflow: \`sim workflows source create --dir <new dir> --workspace <workspaceId>\` (without \`--dry-run\` or \`--yes\`) on a directory without \`${SOURCE_ENTRY_FILE}\` writes a starter \`${SOURCE_ENTRY_FILE}\`, the types of that workspace, \`tsconfig.json\` and this guide, records the workspace in \`${SOURCE_STARTER_FILE}\`, and creates nothing. Until the workflow exists there is no \`${SOURCE_BASE_FILE}\`, so \`status\`, \`diff\` and \`apply\` refuse the directory: edit the starter, run step 2 and 3, then \`sim workflows source create --dir <dir> --workspace <workspaceId> --dry-run\` and the same with \`--yes\` (the starter prints both with its workspace filled in): it prints the new workflow id and writes the lock files. A create goes to the starter's workspace whatever the profile's default, unless \`--workspace\` names another. Exit 1 with \`SOURCE_NAME_TAKEN\` means another workflow has that name: pass \`--name\`. To fork a workflow, copy its directory, delete the copy's \`.sim/\` and run \`sim workflows source create --dir <copy> --workspace <workspaceId> --name <new name> --yes\`.

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

## Types

- \`${SDK_DIR}/core.d.ts\`: the SDK (\`workflow\`, \`t\`, \`env\`, \`credential\`, \`table\`, \`BlockMeta\`).
- \`${SDK_DIR}/${SDK_GUIDE_FILE}\`: every builder, its block and operation, file and params type.
- \`${SDK_DIR}/blocks/<block type>.d.ts\`: one block's builders with their params and outputs.
- \`${WORKSPACE_TYPES_FILE}\`: this workspace's tables, knowledge bases, credentials, workflows and env names.

## Diagnostics and exit codes

Findings print as \`file:line:column severity CODE: message\`, then the code frame and a hint. \`E_*\` refuses the whole apply; \`W_*\` is saved as written and names a real problem. \`check\` prints the \`W_*\` codes step 2 lists as \`error\` on a block you added, since they fail it there; the apply still saves them as warnings. Exit codes of every \`workflows source\` command:

${sourceExitCodesTable('sim workflows source')}

## Rules

- Beside the header and the imports from \`@sim/workflow-sdk\`, the file holds only the default-exported workflow. Its callback holds block declarations (\`const x = builder('Name', params)\`) and wiring (\`x.to(y)\`). Helpers, loops, conditionals and other imports have no stored form, so the compiler refuses them: use \`loop.forEach\`, \`condition\` and \`runWorkflow\` blocks instead.
- Logic that does not fit a block goes in a function block with \`code: codeFile('./functions/name.js')\`; in JavaScript read outputs as \`$ref.blockKey.path\` (the block's key: its name lowercased with every whitespace run and every \`.\` removed, so "Triage Agent" is \`triageagent\`; not its variable) and env vars as \`$env.NAME\`.
- Hosted Sim supplies an agent's model key. On self-hosted Sim the agent needs \`apiKey: env.NAME\` (a secret the workspace holds); without it \`check\` reports \`W_REQUIRED_MISSING: apiKey is required\`.
- A child workflow's output is \`c.result\`, untyped: its \`response\` block's \`{ data, status, headers }\`, so a field of the child's response body is \`c.result.data.field\` (\`${SDK_DIR}/${SDK_GUIDE_FILE}\` "How it runs" has the rest).
- A table block's row is \`{ id, data }\`: read a cell as \`row.data.column\` (in a loop over \`query.rows\`, \`p.currentItem.data.column\`).
- Keep \`${SOURCE_LOCK_FILE}\` and \`${SOURCE_BASE_FILE}\` as written: they bind each block to its stored id and make the next apply safe.

The full guide: ${SOURCE_DOCS_URL}
`

/** The printed source a tree write saves: a get's answer, or an applied create's. */
type PrintedSource = Pick<WorkflowSource, 'workflowId' | 'workspaceId' | 'files' | 'lock' | 'base'>

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
  return finishTree(dir, written, workspaceTypes, tree.ownsTsconfig)
}

/** The workflow directory's tree beside the printed source. */
export const WORKFLOW_TREE: SourceTreeProfile = {
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
  return finishTree(dir, write.length, workspaceTypes, tree.ownsTsconfig)
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

/** The workflow `.sim/base.json` says the directory holds, or `null` when it names none. */
async function heldWorkflowId(dir: string): Promise<string | null> {
  const held = toRecord(await readSourceJson(dir, SOURCE_BASE_FILE)).workflowId
  return typeof held === 'string' ? held : null
}

/**
 * Refuses, unless `--force`, a get into a directory holding another workflow's source: it would
 * replace that source and prune its function files.
 */
async function assertSameWorkflow(dir: string, workflowId: string): Promise<void> {
  const held = await heldWorkflowId(dir)
  if (held === null || held === workflowId) return
  throw new SimApiError(
    `${dir} holds the source of workflow ${held}, not ${workflowId}. Get it into another directory, or pass --force to replace it.`,
    0,
    'SOURCE_WORKFLOW_MISMATCH'
  )
}

/**
 * Refuses, unless `--force`, a get that would replace or prune a source file with edits no apply
 * has saved, such as the edit a stale apply refused.
 */
async function assertNoLocalEdits(dir: string, source: PrintedSource): Promise<void> {
  const edited = await locallyEditedFiles(dir, source, await readPreviousLock(dir))
  if (edited.length === 0) return
  throw new SimApiError(
    `${dir} has edits no apply has saved (${edited.join(', ')}). Apply them, get into another directory, or pass --force to discard them.`,
    0,
    'SOURCE_LOCAL_EDITS'
  )
}

const GET_EXIT_CODES_HELP = `
Exit codes with --dir: 0 written; 1 the command failed, or the directory holds another workflow's
source (SOURCE_WORKFLOW_MISMATCH) or edits no apply has saved (SOURCE_LOCAL_EDITS: apply them,
get into another directory, or pass --force); 7 the workflow is too large to print as source;
9 rate limited (HTTP 429) after the CLI's retries: wait a minute and run it again.`

/**
 * Teaches the generated `workflows source get` leaf `--dir <dir>`: instead of printing the
 * response, it writes `workflow.ts`, `functions/*`, `.sim/lock.json`, `.sim/base.json`, SDK
 * declarations for every block in the workspace's catalog (`.sim/sdk/**`, so a block an agent
 * adds resolves too; the catalog is ETag-cached per workspace in the CLI's config directory),
 * `.sim/sdk/workspace.d.ts` from the resource manifest, a `tsconfig.json` that resolves them, a
 * short `.sim/AGENTS.md`, the example `.sim/examples/cookbook.ts` and the `.gitattributes` lines
 * that keep the source LF. Without `--dir` the generated handler runs unchanged. Commander offers
 * no way to read the action it holds, so it is captured and delegated to, as `runs get` does.
 */
export function attachWorkflowSourceGet(source: Command): void {
  const get = source.commands.find((command) => command.name() === 'get')
  const held = (get as (Command & { _actionHandler?: unknown }) | undefined)?._actionHandler
  if (!get || typeof held !== 'function') {
    throw new Error('workflows source get must be registered before --dir can be attached to it')
  }
  const previous = held as (args: unknown[]) => unknown
  const connectGet = callsOperations(get, [
    'getWorkflowSource',
    'getSourceCatalog',
    'getSourceResources',
  ])

  get.option(
    `--${DIR_FLAG} <dir>`,
    'Write the source, its lock and SDK type declarations into this directory instead of printing them'
  )
  get.option(
    `--${FORCE_FLAG}`,
    "With --dir: replace another workflow's source or edits no apply has saved"
  )
  absoluteDirOption(get)
  get.addHelpText('after', `${GET_EXIT_CODES_HELP}${WORKSPACE_FOLDER_BUSY_HELP}`)
  get.action(async (workflowId: string, _options: unknown, command: Command): Promise<void> => {
    const flags = command.optsWithGlobals() as Record<string, unknown>
    const dir = flags[DIR_FLAG]
    if (typeof dir !== 'string') {
      try {
        await previous(command.processedArgs)
      } catch (error) {
        throw withSourceExitCode(error)
      }
      return
    }
    await withWorkspaceFolderLock(dir, async () => {
      const force = flags[FORCE_FLAG] === true
      if (!force) await assertSameWorkflow(dir, workflowId)
      const { client, profile } = connectGet()
      const request = await buildRequest(
        'getWorkflowSource',
        [workflowId],
        flags,
        profile.workspaceId
      )
      const workflowSource = await client
        .request<GetWorkflowSourceResponse>('getWorkflowSource', {
          params: request.params,
          query: request.query,
        })
        .then(
          (response) => response.data,
          (error: unknown) => {
            throw withSourceExitCode(error)
          }
        )
      assertPrintedSourcePaths(workflowSource.files)
      if (!force) await assertNoLocalEdits(dir, workflowSource)
      const tree = await writeSourceDirectory(
        client,
        dir,
        workflowSource,
        workflowSource.blockTypes
      )
      printProtocolResult(profile.output, {
        workflowId: workflowSource.workflowId,
        dir,
        ...tree,
        fingerprint: workflowSource.base.fingerprint,
      })
    })
  })
}
