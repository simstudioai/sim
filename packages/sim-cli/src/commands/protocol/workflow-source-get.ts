import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { isRecordLike, toRecord } from '@sim/utils/object'
import type { BlockCatalog } from '@sim/workflow-code'
import { catalogBlock } from '@sim/workflow-code/catalog/view'
import { SOURCE_ENTRY_FILE } from '@sim/workflow-code/limits'
import {
  CORE_DTS,
  generateSdkTypes,
  generateWorkspaceTypes,
  SDK_MAJOR,
  sdkIndexHeader,
  type WorkspaceManifest,
} from '@sim/workflow-sdk/codegen'
import type { Command } from 'commander'
import { printError } from '#sim-cli/output/io'
import { readJsonFile, writeJsonFile } from '../../config/json-file'
import { configDir } from '../../config/paths'
import { embedStore } from '../../embed-context'
import { SOURCE_TOO_LARGE_EXIT_CODE } from '../../exit-codes'
import type { GetSourceResourcesResponse, GetWorkflowSourceResponse } from '../../generated/v2-api'
import { SimApiError } from '../../http/client'
import { callsOperations, type OperationClient } from '../../runtime/called-operations'
import { buildRequest } from '../../runtime/request'
import { cliVersion } from '../../version'
import { printProtocolResult } from './result'
import {
  assertPrintedSourcePaths,
  locallyEditedFiles,
  mergedGitattributes,
  readPreviousLock,
  readSourceText,
  SOURCE_SDK_DIR as SDK_DIR,
  SOURCE_AGENTS_FILE,
  SOURCE_BASE_FILE,
  SOURCE_GITATTRIBUTES_FILE,
  SOURCE_LOCK_FILE,
  type SourceDirChange,
  updateSourceDir,
  writeBack,
} from './workflow-source-layout'

const DIR_FLAG = 'dir'
const FORCE_FLAG = 'force'
const TSCONFIG_FILE = 'tsconfig.json'
/** The public guide to workflow source, which AGENTS.md points an agent at. */
const SOURCE_DOCS_URL = 'https://docs.sim.ai/workflows/code'
/** The SDK file whose first line names the catalog the declarations were generated from. */
const SDK_INDEX_FILE = `${SDK_DIR}/index.d.ts`
const WORKSPACE_TYPES_FILE = `${SDK_DIR}/workspace.d.ts`
/** A cached catalog is a few megabytes of JSON; a larger file was not written by this CLI. */
const MAX_CATALOG_CACHE_BYTES = 32 * 1024 * 1024

type WorkflowSource = GetWorkflowSourceResponse['data']

/**
 * Enough of a block catalog to generate from, for the cache file and the server's answer alike:
 * the generated response type declares an optional condition `value` the package type requires.
 */
function isBlockCatalog(value: unknown): value is BlockCatalog {
  return (
    isRecordLike(value) &&
    typeof value.hash === 'string' &&
    typeof value.sdkMajor === 'number' &&
    isRecordLike(value.blocks) &&
    isRecordLike(value.builders) &&
    isRecordLike(value.triggers)
  )
}

/** Workspace ids are uuids; anything else is never used to name a cache file. */
const CACHE_KEY = /^[\w-]+$/

/**
 * Where the workspace's catalog is cached: one file per workspace in the CLI's config directory,
 * so every `source get` in the workspace (whatever the workflow or output directory) revalidates
 * the same copy. Callers gate the id with `CACHE_KEY` first.
 */
function catalogCachePath(workspaceId: string): string {
  return join(configDir(), 'cache', 'source-catalog', `${workspaceId}.json`)
}

/**
 * The cached catalog, or `null`. Standalone runs only: an embedded run has no local disk of its
 * own to cache on. The file is read without following a link and under a size cap.
 */
function readCachedCatalog(workspaceId: string): BlockCatalog | null {
  if (embedStore.getStore() || !CACHE_KEY.test(workspaceId)) return null
  const cached = readJsonFile(catalogCachePath(workspaceId), MAX_CATALOG_CACHE_BYTES)
  return isBlockCatalog(cached) ? cached : null
}

/** The catalog a `getSourceCatalog` answer carries. */
function catalogFrom(response: { data: unknown }): BlockCatalog {
  if (!isBlockCatalog(response.data)) {
    throw new SimApiError('The block catalog response was not in the expected shape.', 0)
  }
  return response.data
}

/** Replaces the cached catalog atomically; a failed write only costs the next get a download. */
function writeCachedCatalog(workspaceId: string, catalog: BlockCatalog): void {
  if (embedStore.getStore() || !CACHE_KEY.test(workspaceId)) return
  writeJsonFile(catalogCachePath(workspaceId), catalog)
}

/**
 * The workspace's block catalog, revalidated by ETag against the per-workspace cache: a `304`
 * reuses it, anything else replaces it. A workflow can hold a type the workspace no longer offers
 * (a legacy version, a block an allowlist now withholds); only then is that workflow's compile
 * catalog fetched instead, uncached, so its types still resolve.
 */
async function loadCatalog(
  client: OperationClient<'getSourceCatalog'>,
  source: Pick<WorkflowSource, 'workspaceId' | 'blockTypes'> & { workflowId?: string }
): Promise<BlockCatalog> {
  const cached = readCachedCatalog(source.workspaceId)
  let catalog: BlockCatalog
  try {
    catalog = catalogFrom(
      await client.request<{ data: unknown }>('getSourceCatalog', {
        params: { workspaceId: source.workspaceId },
        ...(cached ? { headers: { 'if-none-match': `"${cached.hash}"` } } : {}),
      })
    )
    writeCachedCatalog(source.workspaceId, catalog)
  } catch (error) {
    if (!cached || !(error instanceof SimApiError) || error.status !== 304) throw error
    catalog = cached
  }
  if (
    source.workflowId === undefined ||
    source.blockTypes.every((type) => catalogBlock(catalog, type) !== undefined)
  ) {
    return catalog
  }
  return catalogFrom(
    await client.request<{ data: unknown }>('getSourceCatalog', {
      params: { workspaceId: source.workspaceId },
      query: { workflowId: source.workflowId },
    })
  )
}

/** The resource manifest as `generateWorkspaceTypes` reads it. */
function workspaceManifestFrom({
  tables,
  knowledgeBases,
  credentials,
  workflows,
  env,
}: GetSourceResourcesResponse['data']): WorkspaceManifest {
  return {
    tables: Object.fromEntries(
      tables.map((table) => [
        table.key,
        { columns: Object.fromEntries(table.columns.map(({ name, ...column }) => [name, column])) },
      ])
    ),
    knowledgeBases: knowledgeBases.map((knowledgeBase) => knowledgeBase.key),
    credentials: Object.fromEntries(
      credentials.map((credential) => [credential.key, { provider: credential.provider }])
    ),
    workflows: Object.fromEntries(
      workflows.map((workflow) => [
        workflow.key,
        { inputs: Object.fromEntries(workflow.inputs.map((input) => [input.name, input.type])) },
      ])
    ),
    env,
  }
}

/**
 * The workspace's resources as `workspace.d.ts`, or `null` when they cannot be listed: a `403`
 * for a caller the manifest does not admit (a Copilot delegation), a `404` from a server that
 * predates the route. The source still writes and type-checks, with every key a plain string.
 */
async function loadWorkspaceTypes(
  client: OperationClient<'getSourceResources'>,
  workspaceId: string
): Promise<string | null> {
  try {
    const { data } = await client.request<GetSourceResourcesResponse>('getSourceResources', {
      params: { workspaceId },
    })
    return generateWorkspaceTypes(workspaceManifestFrom(data)).text
  } catch (error) {
    if (error instanceof SimApiError && (error.status === 403 || error.status === 404)) return null
    throw error
  }
}

/**
 * Refuses a catalog for another SDK major than the bundled `core.d.ts`: its builders would be
 * written beside declarations that cannot type them.
 */
function assertSdkMajor(catalog: BlockCatalog): void {
  if (catalog.sdkMajor === SDK_MAJOR) return
  throw new SimApiError(
    catalog.sdkMajor > SDK_MAJOR
      ? `This workspace uses workflow SDK ${catalog.sdkMajor}, but this CLI writes SDK ${SDK_MAJOR} declarations. Upgrade the CLI (npm install -g sim@latest) and run the command again.`
      : `This workspace uses workflow SDK ${catalog.sdkMajor}, but this CLI writes SDK ${SDK_MAJOR} declarations. Install a CLI release for SDK ${catalog.sdkMajor} to work with this server.`,
    0,
    'SDK_MAJOR_MISMATCH'
  )
}

/**
 * The first line of every `tsconfig.json` the CLI writes. A `tsconfig.json` without it is the
 * person's own (an existing TypeScript project), and a get never replaces it.
 */
const TSCONFIG_MARKER = `// Written by \`sim workflows source get\`; remove this line to keep your own edits.`

/** Lets an editor or `tsc -p` resolve `@sim/workflow-sdk` to the written declarations. */
const TSCONFIG = `${TSCONFIG_MARKER}\n${JSON.stringify(
  {
    compilerOptions: {
      target: 'ES2022',
      lib: ['ES2022'],
      module: 'ESNext',
      moduleResolution: 'bundler',
      moduleDetection: 'force',
      types: [],
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      paths: { '@sim/workflow-sdk': [`./${SDK_DIR}/core.d.ts`] },
    },
    include: [SOURCE_ENTRY_FILE, `${SDK_DIR}/**/*.d.ts`],
  },
  null,
  2
)}\n`

/** The guide an agent working in the directory reads first; the docs page has the rest. */
const AGENTS_GUIDE = `# Sim workflow source

This directory is a Sim workflow written as TypeScript. The server compiles \`${SOURCE_ENTRY_FILE}\` statically; nothing in it runs. The workflow id is \`workflowId\` in \`${SOURCE_BASE_FILE}\`.

## Edit loop (run from this directory)

1. Edit \`${SOURCE_ENTRY_FILE}\` (and \`functions/*\`). \`tsc -p .\` type-checks locally.
2. \`sim workflows source apply <workflowId> --dir . --dry-run\`: fix every error it prints, rerun until it exits 0.
3. \`sim workflows source apply <workflowId> --dir . --yes\`: saves the draft (never deploys) and rewrites this directory from what was stored.
4. Exit 5 (\`SOURCE_STALE\`, HTTP 409, or \`E_APPLY_STALE\` on a dry run): the workflow changed and nothing was saved. Run \`sim workflows source get <workflowId> --dir <fresh dir>\`, reapply your edit there, dry-run, apply. A get into this directory refuses to overwrite your unapplied edits unless you pass \`--force\`.

Lines starting \`note:\` explain something the write did differently than the source says (a renamed workflow keeps its stored name, for example); read them.

A new workflow: \`sim workflows source create --dir <new dir>\` on a directory without \`${SOURCE_ENTRY_FILE}\` writes a starter \`${SOURCE_ENTRY_FILE}\`, these types, \`tsconfig.json\` and this guide, and creates nothing. Edit the starter, then run \`sim workflows source create --dir <dir> --yes\`: it prints the new workflow id and writes the lock files. Exit 1 with \`SOURCE_NAME_TAKEN\` means another workflow has that name: pass \`--name\`.

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
- \`${SDK_DIR}/operations/<block>/<operation>.d.ts\`: one operation's params and outputs. Read these to learn a block; \`${SDK_DIR}/blocks/*.d.ts\` lists every builder.
- \`${WORKSPACE_TYPES_FILE}\`: this workspace's tables, knowledge bases, credentials, workflows and env names.

## Diagnostics and exit codes

Findings print as \`file:line:column severity CODE: message\`, then the code frame and a hint. \`E_*\` refuses the whole apply; \`W_*\` is saved as written and names a real problem. Exit 0 applied, 1 source errors (or a name another workflow holds), 5 stale, 6 workflow locked, 7 source too large (on a get too).

## Rules

- Beside the header and the imports from \`@sim/workflow-sdk\`, the file holds only the default-exported workflow. Its callback holds block declarations (\`const x = builder('Name', params)\`) and wiring (\`x.to(y)\`). Helpers, loops, conditionals and other imports have no stored form, so the compiler refuses them: use \`loop.forEach\`, \`condition\` and \`runWorkflow\` blocks instead.
- Logic that does not fit a block goes in a function block with \`code: codeFile('./functions/name.js')\`; in JavaScript read outputs as \`$ref.blockKey.path\` (the block's key: its name lowercased without spaces, not its variable) and env vars as \`$env.NAME\`.
- Keep \`${SOURCE_LOCK_FILE}\` and \`${SOURCE_BASE_FILE}\` as written: they bind each block to its stored id and make the next apply safe.

The full guide: ${SOURCE_DOCS_URL}
`

/**
 * The second line of the generated `index.d.ts`: the CLI release and the `core.d.ts` it bundles.
 * The catalog header alone cannot tell declarations a new CLI generates differently (a codegen or
 * `core.d.ts` change within the same SDK major) from the old ones, so both lines key the cache.
 */
function sdkGeneratorLine(): string {
  const core = createHash('sha256').update(CORE_DTS, 'utf8').digest('hex').slice(0, 16)
  return `// generated by sim ${cliVersion()} · core.d.ts ${core}`
}

/** The generated declarations, with the generator line under the index's catalog header. */
function sdkTypeFiles(catalog: BlockCatalog): Array<readonly [string, string]> {
  const generator = sdkGeneratorLine()
  return generateSdkTypes(catalog).map((file) => {
    if (file.path !== 'index.d.ts') return [`${SDK_DIR}/${file.path}`, file.text] as const
    const [header, ...rest] = file.text.split('\n')
    return [`${SDK_DIR}/${file.path}`, [header, generator, ...rest].join('\n')] as const
  })
}

/** The printed source a tree write saves: a get's answer, or an applied create's. */
type PrintedSource = Pick<WorkflowSource, 'workflowId' | 'workspaceId' | 'files' | 'lock' | 'base'>

interface SourceTree {
  written: number
  /** Whether `workspace.d.ts` was written. */
  workspaceTypes: boolean
  /** Whether `tsconfig.json` is the CLI's; `false` when the directory's own was left alone. */
  tsconfig: boolean
}

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
  workspaceTypes: string | null
): Promise<SourceTree> {
  const [previousLock, tree] = await Promise.all([
    readPreviousLock(dir),
    sourceTreeChange(dir, catalog, workspaceTypes),
  ])
  const written = await writeBack(dir, source, previousLock, tree.change)
  return finishTree(dir, written, workspaceTypes, tree.ownsTsconfig)
}

/** Reports a `tsconfig.json` the CLI left alone and summarizes a tree write. */
function finishTree(
  dir: string,
  written: number,
  workspaceTypes: string | null,
  ownsTsconfig: boolean
): SourceTree {
  if (!ownsTsconfig) {
    printError(
      `note: ${TSCONFIG_FILE} in ${dir} is not the CLI's, so it was left as it is. To type-check the source, map "@sim/workflow-sdk" to ["./${SDK_DIR}/core.d.ts"] in its compilerOptions.paths.`
    )
  }
  return { written, workspaceTypes: workspaceTypes !== null, tsconfig: ownsTsconfig }
}

/**
 * Everything beside the printed source that makes a directory editable: the agent guide, the
 * declarations (regenerated only when the catalog or generator changed), `workspace.d.ts`, the
 * CLI's `tsconfig.json` and the LF lines.
 */
async function sourceTreeChange(
  dir: string,
  catalog: BlockCatalog,
  workspaceTypes: string | null
): Promise<{ change: SourceDirChange; ownsTsconfig: boolean }> {
  const write: Array<readonly [string, string]> = [
    [SOURCE_AGENTS_FILE, AGENTS_GUIDE],
    [`${SDK_DIR}/core.d.ts`, CORE_DTS],
  ]
  const remove: string[] = []
  const [gitattributes, index, tsconfig] = await Promise.all([
    readSourceText(dir, SOURCE_GITATTRIBUTES_FILE),
    readSourceText(dir, SDK_INDEX_FILE),
    readSourceText(dir, TSCONFIG_FILE),
  ])
  const ownsTsconfig = tsconfig === null || tsconfig.startsWith(TSCONFIG_MARKER)
  if (ownsTsconfig) write.push([TSCONFIG_FILE, TSCONFIG])
  const mergedAttributes = mergedGitattributes(gitattributes)
  if (mergedAttributes !== null) write.push([SOURCE_GITATTRIBUTES_FILE, mergedAttributes])
  const indexHead = index?.split('\n', 2).join('\n')
  if (indexHead !== `${sdkIndexHeader(catalog)}\n${sdkGeneratorLine()}`) {
    remove.push(SDK_DIR)
    write.push(...sdkTypeFiles(catalog))
  }
  if (workspaceTypes === null) remove.push(WORKSPACE_TYPES_FILE)
  else write.push([WORKSPACE_TYPES_FILE, workspaceTypes])
  return { change: { write, remove }, ownsTsconfig }
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
 * with no lock or base, since no workflow exists yet. Only for a directory with no `workflow.ts`.
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
  const tree = await sourceTreeChange(dir, catalog, workspaceTypes)
  const write = [[SOURCE_ENTRY_FILE, STARTER_SOURCE] as const, ...tree.change.write]
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
      blockTypes: [...blockTypes],
    }),
    loadWorkspaceTypes(client, source.workspaceId),
  ])
  assertSdkMajor(catalog)
  return writeSourceTree(dir, source, catalog, workspaceTypes)
}

/** The workflow `.sim/base.json` says the directory holds, or `null` when it names none. */
async function heldWorkflowId(dir: string): Promise<string | null> {
  const text = await readSourceText(dir, SOURCE_BASE_FILE)
  if (text === null) return null
  try {
    const held = toRecord(JSON.parse(text)).workflowId
    return typeof held === 'string' ? held : null
  } catch {
    return null
  }
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
get into another directory, or pass --force); 7 the workflow is too large to print as source.`

/** A read the server refused as over the source size limits exits 7, as a refused apply does. */
function withSourceExitCode(error: unknown): unknown {
  if (!(error instanceof SimApiError) || error.status !== 413) return error
  return new SimApiError(
    error.message,
    error.status,
    error.code,
    error.details,
    SOURCE_TOO_LARGE_EXIT_CODE,
    error.requestId
  )
}

/**
 * Teaches the generated `workflows source get` leaf `--dir <dir>`: instead of printing the
 * response, it writes `workflow.ts`, `functions/*`, `.sim/lock.json`, `.sim/base.json`, SDK
 * declarations for every block in the workspace's catalog (`.sim/sdk/**`, so a block an agent
 * adds resolves too; the catalog is ETag-cached per workspace in the CLI's config directory),
 * `.sim/sdk/workspace.d.ts` from the resource manifest, a `tsconfig.json` that resolves them, a
 * short `.sim/AGENTS.md` and the `.gitattributes` lines that keep the source LF. Without `--dir`
 * the generated handler runs unchanged. Commander offers no way to read the action it holds, so
 * it is captured and delegated to, as `runs get` does.
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
  get.addHelpText('after', GET_EXIT_CODES_HELP)
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
    const tree = await writeSourceDirectory(client, dir, workflowSource, workflowSource.blockTypes)
    printProtocolResult(profile.output, {
      workflowId: workflowSource.workflowId,
      dir,
      files: tree.written,
      workspaceTypes: tree.workspaceTypes,
      fingerprint: workflowSource.base.fingerprint,
    })
  })
}
