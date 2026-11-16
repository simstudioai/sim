import { join } from 'node:path'
import { isRecordLike } from '@sim/utils/object'
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
import { readJsonFile, writeJsonFile } from '../../config/json-file'
import { configDir } from '../../config/paths'
import { embedStore } from '../../embed-context'
import type { GetSourceResourcesResponse, GetWorkflowSourceResponse } from '../../generated/v2-api'
import { SimApiError } from '../../http/client'
import { callsOperations, type OperationClient } from '../../runtime/called-operations'
import { buildRequest } from '../../runtime/request'
import { printProtocolResult } from './result'
import {
  mergedGitattributes,
  readPreviousLock,
  readSourceText,
  SOURCE_SDK_DIR as SDK_DIR,
  SOURCE_AGENTS_FILE,
  SOURCE_BASE_FILE,
  SOURCE_GITATTRIBUTES_FILE,
  SOURCE_LOCK_FILE,
  sourceRelativePath,
  writeBack,
} from './workflow-source-layout'

const DIR_FLAG = 'dir'
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

/** Refuses a response file path outside the directory before anything is fetched or written. */
function assertSafePaths(source: WorkflowSource): void {
  for (const path of Object.keys(source.files)) {
    if (sourceRelativePath(path) !== path) {
      throw new SimApiError(`The workflow source named an unsafe file path: ${path}`, 0)
    }
  }
}

/**
 * Where the workspace's catalog is cached: one file per workspace in the CLI's config directory,
 * so every `source get` in the workspace (whatever the workflow or output directory) revalidates
 * the same copy. Workspace ids are uuids, so the name is safe as given.
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
  source: WorkflowSource
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
  if (source.blockTypes.every((type) => catalogBlock(catalog, type) !== undefined)) return catalog
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

/** Lets an editor or `tsc -p` resolve `@sim/workflow-sdk` to the written declarations. */
const TSCONFIG = `${JSON.stringify(
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

/** The guide an agent working in the directory reads first; the SDK README has the rest. */
const AGENTS_GUIDE = `# Sim workflow source

This directory is a Sim workflow written as TypeScript. The server compiles \`${SOURCE_ENTRY_FILE}\` statically; nothing in it runs. The workflow id is \`workflowId\` in \`${SOURCE_BASE_FILE}\`.

## Edit loop (run from this directory)

1. Edit \`${SOURCE_ENTRY_FILE}\` (and \`functions/*\`). \`tsc -p .\` type-checks locally.
2. \`sim workflows source apply <workflowId> --dir . --dry-run\`: fix every error it prints, rerun until it exits 0.
3. \`sim workflows source apply <workflowId> --dir . --yes\`: saves the draft (never deploys) and rewrites this directory from what was stored.
4. Exit 5 (\`SOURCE_STALE\`, HTTP 409): the workflow changed and nothing was saved. Run \`sim workflows source get <workflowId> --dir <fresh dir>\`, reapply your edit there, dry-run, apply.

A new workflow: write \`${SOURCE_ENTRY_FILE}\` in an empty directory and run \`sim workflows source create --dir <dir> --yes\`.

## Types

- \`${SDK_DIR}/core.d.ts\`: the SDK (\`workflow\`, \`t\`, \`env\`, \`credential\`, \`table\`, \`BlockMeta\`).
- \`${SDK_DIR}/operations/<block>/<operation>.d.ts\`: one operation's params and outputs. Read these to learn a block; \`${SDK_DIR}/blocks/*.d.ts\` lists every builder.
- \`${WORKSPACE_TYPES_FILE}\`: this workspace's tables, knowledge bases, credentials, workflows and env names.

## Diagnostics and exit codes

Findings print as \`file:line:column severity CODE: message\`, then the code frame and a hint. \`E_*\` refuses the whole apply; \`W_*\` is saved as written and names a real problem. Exit 0 applied, 1 source errors, 5 stale, 6 workflow locked, 7 source too large.

## Rules

- The file holds imports from \`@sim/workflow-sdk\`, block declarations (\`const x = builder('Name', params)\`) and wiring (\`x.to(y)\`). Helpers, loops, conditionals and other imports have no stored form, so the compiler refuses them: use \`loop.forEach\`, \`condition\` and \`runWorkflow\` blocks instead.
- Logic that does not fit a block goes in a function block with \`code: codeFile('./functions/name.js')\`; in JavaScript read outputs as \`$ref.block.path\` and env vars as \`$env.NAME\`.
- Keep \`${SOURCE_LOCK_FILE}\` and \`${SOURCE_BASE_FILE}\` as written: they bind each block to its stored id and make the next apply safe.

The full guide is the \`@sim/workflow-sdk\` README.
`

interface SourceTree {
  written: number
  /** Whether `workspace.d.ts` was written. */
  workspaceTypes: boolean
}

/**
 * Writes the source tree in one staged update. Declarations are regenerated only when the index
 * on disk names another catalog, and replaced whole so a block the catalog dropped loses its file.
 * A refused manifest removes the `workspace.d.ts` an earlier get wrote, function files the new lock
 * no longer names are pruned, and `.gitattributes` gains the LF lines it lacks.
 */
async function writeSourceTree(
  dir: string,
  source: WorkflowSource,
  catalog: BlockCatalog,
  workspaceTypes: string | null
): Promise<SourceTree> {
  const write: Array<readonly [string, string]> = [
    ['tsconfig.json', TSCONFIG],
    [SOURCE_AGENTS_FILE, AGENTS_GUIDE],
    [`${SDK_DIR}/core.d.ts`, CORE_DTS],
  ]
  const remove: string[] = []
  const [previousLock, gitattributes, index] = await Promise.all([
    readPreviousLock(dir),
    readSourceText(dir, SOURCE_GITATTRIBUTES_FILE),
    readSourceText(dir, SDK_INDEX_FILE),
  ])
  const mergedAttributes = mergedGitattributes(gitattributes)
  if (mergedAttributes !== null) write.push([SOURCE_GITATTRIBUTES_FILE, mergedAttributes])
  if (index?.split('\n', 1)[0] !== sdkIndexHeader(catalog)) {
    remove.push(SDK_DIR)
    for (const file of generateSdkTypes(catalog)) write.push([`${SDK_DIR}/${file.path}`, file.text])
  }
  if (workspaceTypes === null) remove.push(WORKSPACE_TYPES_FILE)
  else write.push([WORKSPACE_TYPES_FILE, workspaceTypes])
  const written = await writeBack(dir, source, previousLock, { write, remove })
  return { written, workspaceTypes: workspaceTypes !== null }
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
  get.action(async (workflowId: string, _options: unknown, command: Command): Promise<void> => {
    const flags = command.optsWithGlobals() as Record<string, unknown>
    const dir = flags[DIR_FLAG]
    if (typeof dir !== 'string') {
      await previous(command.processedArgs)
      return
    }
    const { client, profile } = connectGet()
    const request = await buildRequest(
      'getWorkflowSource',
      [workflowId],
      flags,
      profile.workspaceId
    )
    const { data: workflowSource } = await client.request<GetWorkflowSourceResponse>(
      'getWorkflowSource',
      { params: request.params, query: request.query }
    )
    assertSafePaths(workflowSource)
    const [catalog, workspaceTypes] = await Promise.all([
      loadCatalog(client, workflowSource),
      loadWorkspaceTypes(client, workflowSource.workspaceId),
    ])
    assertSdkMajor(catalog)
    const tree = await writeSourceTree(dir, workflowSource, catalog, workspaceTypes)
    printProtocolResult(profile.output, {
      workflowId: workflowSource.workflowId,
      dir,
      files: tree.written,
      workspaceTypes: tree.workspaceTypes,
      fingerprint: workflowSource.base.fingerprint,
    })
  })
}
