import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { isRecordLike, toRecordOrNull } from '@sim/utils/object'
import type { BlockCatalog } from '@sim/workflow-code'
import { catalogBlock } from '@sim/workflow-code/catalog/view'
import {
  CORE_DTS,
  generateSdkTypes,
  generateWorkspaceTypes,
  SDK_MAJOR,
  type WorkspaceManifest,
} from '@sim/workflow-sdk/codegen'
import type { Command } from 'commander'
import { configDir } from '../../config/paths'
import { embedStore } from '../../embed-context'
import { SimApiError } from '../../http/client'
import { callsOperations, type OperationClient } from '../../runtime/called-operations'
import { buildRequest } from '../../runtime/request'
import { printProtocolResult } from './result'
import {
  mergedGitattributes,
  orphanedCodeFiles,
  readPreviousLock,
  readSourceText,
  SOURCE_SDK_DIR as SDK_DIR,
  SOURCE_AGENTS_FILE,
  SOURCE_BASE_FILE,
  SOURCE_ENTRY_FILE,
  SOURCE_GITATTRIBUTES_FILE,
  SOURCE_LOCK_FILE,
  sourceRelativePath,
  updateSourceDir,
} from './workflow-source-layout'

const DIR_FLAG = 'dir'
/** The SDK file that names the catalog hash; unchanged text means unchanged declarations. */
const SDK_INDEX_FILE = `${SDK_DIR}/index.d.ts`
const WORKSPACE_TYPES_FILE = `${SDK_DIR}/workspace.d.ts`

/** The part of the source response the writer reads; the contract owns the full shape. */
interface WorkflowSource {
  workflowId: string
  workspaceId: string
  files: Record<string, string>
  lock: unknown
  base: unknown
  fingerprint: string
  blockTypes: string[]
}

interface CachedCatalog {
  hash: string
  catalog: BlockCatalog
}

/** Enough of a block catalog to generate from; the server owns the full shape. */
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

function readSource(raw: unknown): WorkflowSource {
  const data = isRecordLike(raw) && isRecordLike(raw.data) ? raw.data : raw
  if (
    !isRecordLike(data) ||
    typeof data.workflowId !== 'string' ||
    typeof data.workspaceId !== 'string' ||
    !isRecordLike(data.files) ||
    typeof data.fingerprint !== 'string' ||
    !Array.isArray(data.blockTypes)
  ) {
    throw new SimApiError('The workflow source response was not in the expected shape.', 0)
  }
  const files: Record<string, string> = {}
  for (const [path, text] of Object.entries(data.files)) {
    if (typeof text !== 'string' || sourceRelativePath(path) !== path) {
      throw new SimApiError(`The workflow source named an unsafe file path: ${path}`, 0)
    }
    files[path] = text
  }
  return {
    workflowId: data.workflowId,
    workspaceId: data.workspaceId,
    files,
    lock: data.lock,
    base: data.base,
    fingerprint: data.fingerprint,
    blockTypes: data.blockTypes.filter((type): type is string => typeof type === 'string'),
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

/** Standalone runs only: an embedded run has no local disk of its own to cache on. */
async function readCachedCatalog(workspaceId: string): Promise<CachedCatalog | null> {
  if (embedStore.getStore() || !CACHE_KEY.test(workspaceId)) return null
  try {
    const parsed: unknown = JSON.parse(await readFile(catalogCachePath(workspaceId), 'utf8'))
    if (isRecordLike(parsed) && typeof parsed.hash === 'string' && isBlockCatalog(parsed.catalog)) {
      return { hash: parsed.hash, catalog: parsed.catalog }
    }
  } catch {}
  return null
}

async function writeCachedCatalog(workspaceId: string, catalog: BlockCatalog): Promise<void> {
  if (embedStore.getStore() || !CACHE_KEY.test(workspaceId)) return
  const path = catalogCachePath(workspaceId)
  const cache: CachedCatalog = { hash: catalog.hash, catalog }
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(cache))
}

function catalogFrom(raw: unknown): BlockCatalog {
  const catalog = isRecordLike(raw) ? raw.data : null
  if (!isBlockCatalog(catalog)) {
    throw new SimApiError('The block catalog response was not in the expected shape.', 0)
  }
  return catalog
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
  const cached = await readCachedCatalog(source.workspaceId)
  let catalog: BlockCatalog
  try {
    catalog = catalogFrom(
      await client.request<unknown>('getSourceCatalog', {
        params: { workspaceId: source.workspaceId },
        ...(cached ? { headers: { 'if-none-match': `"${cached.hash}"` } } : {}),
      })
    )
    await writeCachedCatalog(source.workspaceId, catalog)
  } catch (error) {
    if (!cached || !(error instanceof SimApiError) || error.status !== 304) throw error
    catalog = cached.catalog
  }
  if (source.blockTypes.every((type) => catalogBlock(catalog, type) !== undefined)) return catalog
  return catalogFrom(
    await client.request<unknown>('getSourceCatalog', {
      params: { workspaceId: source.workspaceId },
      query: { workflowId: source.workflowId },
    })
  )
}

interface ManifestResource {
  key: string
}

/** The resource manifest response, as `generateWorkspaceTypes` reads it. */
function workspaceManifestFrom(raw: unknown): WorkspaceManifest {
  const data = isRecordLike(raw) ? toRecordOrNull(raw.data) : null
  if (!data)
    throw new SimApiError('The resource manifest response was not in the expected shape.', 0)
  const list = <T extends ManifestResource>(value: unknown): T[] =>
    Array.isArray(value)
      ? value.filter((item): item is T => isRecordLike(item) && typeof item.key === 'string')
      : []
  const manifest: WorkspaceManifest = {
    tables: Object.fromEntries(
      list<ManifestResource & { columns?: unknown }>(data.tables).map((table) => [
        table.key,
        {
          columns: Object.fromEntries(
            (Array.isArray(table.columns) ? table.columns : []).flatMap((column) =>
              isRecordLike(column) && typeof column.name === 'string'
                ? [
                    [
                      column.name,
                      {
                        type: typeof column.type === 'string' ? column.type : 'string',
                        ...(Array.isArray(column.options)
                          ? {
                              options: column.options.filter(
                                (option): option is string => typeof option === 'string'
                              ),
                            }
                          : {}),
                      },
                    ],
                  ]
                : []
            )
          ),
        },
      ])
    ),
    knowledgeBases: list(data.knowledgeBases).map((kb) => kb.key),
    credentials: Object.fromEntries(
      list<ManifestResource & { provider?: unknown }>(data.credentials).map((credential) => [
        credential.key,
        { provider: typeof credential.provider === 'string' ? credential.provider : '' },
      ])
    ),
    workflows: Object.fromEntries(
      list<ManifestResource & { inputs?: unknown }>(data.workflows).map((workflow) => [
        workflow.key,
        {
          inputs: Object.fromEntries(
            (Array.isArray(workflow.inputs) ? workflow.inputs : []).flatMap((input) =>
              isRecordLike(input) && typeof input.name === 'string'
                ? [[input.name, typeof input.type === 'string' ? input.type : 'string']]
                : []
            )
          ),
        },
      ])
    ),
    env: Array.isArray(data.env)
      ? data.env.filter((name): name is string => typeof name === 'string')
      : [],
  }
  return manifest
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
    const raw = await client.request<unknown>('getSourceResources', { params: { workspaceId } })
    return generateWorkspaceTypes(workspaceManifestFrom(raw)).text
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

/** Points an agent working in the directory at the SDK's own guide. */
const AGENTS_GUIDE = `# Sim workflow source

The directory holding this \`.sim\` folder is a Sim workflow written as TypeScript. Edit \`${SOURCE_ENTRY_FILE}\` (and \`functions/*\`), then, from that directory:

\`\`\`bash
sim workflows source apply <workflowId> --dir . --dry-run   # check; prints file:line diagnostics
sim workflows source apply <workflowId> --dir . --yes       # save the draft
\`\`\`

- Types: \`${SDK_DIR}/core.d.ts\` (SDK), \`${SDK_DIR}/blocks/*.d.ts\` and \`${SDK_DIR}/operations/<block>/<operation>.d.ts\` (every block's builders, params and outputs), \`${WORKSPACE_TYPES_FILE}\` (this workspace's tables, knowledge bases, credentials, workflows and env names). \`tsc -p .\` checks the file locally.
- Keep \`${SOURCE_LOCK_FILE}\` and \`${SOURCE_BASE_FILE}\`. A \`409\` (\`SOURCE_STALE\`, exit 5) means the workflow changed: run \`sim workflows source get <workflowId> --dir <fresh dir>\`, reapply your edit there and retry.
- The full guide is the \`@sim/workflow-sdk\` README: the edit loop, the diagnostics format and the rebase loop.
`

interface SourceTree {
  written: number
  /** Whether `workspace.d.ts` was written. */
  workspaceTypes: boolean
}

/**
 * Writes the source tree in one staged update. Declarations are replaced only when the catalog
 * index changed, and replaced whole so a block the catalog dropped loses its file. A refused
 * manifest removes the `workspace.d.ts` an earlier get wrote, function files the new lock no
 * longer names are pruned, and `.gitattributes` gains the LF lines it lacks.
 */
async function writeSourceTree(
  dir: string,
  source: WorkflowSource,
  catalog: BlockCatalog,
  workspaceTypes: string | null
): Promise<SourceTree> {
  const write: Array<[string, string]> = [
    ...Object.entries(source.files),
    [SOURCE_LOCK_FILE, `${JSON.stringify(source.lock, null, 2)}\n`],
    [SOURCE_BASE_FILE, `${JSON.stringify(source.base, null, 2)}\n`],
    ['tsconfig.json', TSCONFIG],
    [SOURCE_AGENTS_FILE, AGENTS_GUIDE],
    [`${SDK_DIR}/core.d.ts`, CORE_DTS],
  ]
  const remove = orphanedCodeFiles(
    await readPreviousLock(dir),
    source.lock,
    Object.keys(source.files)
  )
  const gitattributes = mergedGitattributes(await readSourceText(dir, SOURCE_GITATTRIBUTES_FILE))
  if (gitattributes !== null) write.push([SOURCE_GITATTRIBUTES_FILE, gitattributes])

  const sdkFiles = generateSdkTypes(catalog).map((file): [string, string] => [
    `${SDK_DIR}/${file.path}`,
    file.text,
  ])
  const index = sdkFiles.find(([path]) => path === SDK_INDEX_FILE)?.[1]
  if (index === undefined || index !== (await readSourceText(dir, SDK_INDEX_FILE))) {
    remove.push(SDK_DIR)
    write.push(...sdkFiles)
  }
  if (workspaceTypes === null) remove.push(WORKSPACE_TYPES_FILE)
  else write.push([WORKSPACE_TYPES_FILE, workspaceTypes])
  await updateSourceDir(dir, { write, remove })
  return { written: write.length, workspaceTypes: workspaceTypes !== null }
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
    const workflowSource = readSource(
      await client.request<unknown>('getWorkflowSource', {
        params: request.params,
        query: request.query,
      })
    )
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
      fingerprint: workflowSource.fingerprint,
    })
  })
}
