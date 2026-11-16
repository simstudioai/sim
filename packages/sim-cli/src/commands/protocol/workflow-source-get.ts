import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, posix } from 'node:path'
import { isRecordLike } from '@sim/utils/object'
import type { BlockCatalog, CatalogBlock, CatalogBuilder, CatalogTrigger } from '@sim/workflow-code'
import {
  catalogBlock,
  catalogBuilder,
  catalogBuilderPaths,
  catalogTrigger,
} from '@sim/workflow-code/catalog/view'
import { CORE_DTS, generateSdkTypes } from '@sim/workflow-sdk/codegen'
import type { Command } from 'commander'
import { embedStore } from '../../embed-context'
import { SimApiError } from '../../http/client'
import { callsOperations, type OperationClient } from '../../runtime/called-operations'
import { buildRequest } from '../../runtime/request'
import { saveToFile } from './files-get'
import { printProtocolResult } from './result'

const OUT_FLAG = 'out'
const SDK_DIR = '.sim/sdk'
const CATALOG_CACHE = '.sim/cache/block-catalog.json'

/** The part of the source response the writer reads; the contract owns the full shape. */
interface WorkflowSource {
  workflowId: string
  workspaceId: string
  files: Record<string, string>
  lock: unknown
  lockBase: unknown
  fingerprint: string
  blockTypes: string[]
}

interface CachedCatalog {
  hash: string
  catalog: BlockCatalog
}

/** Enough of a block catalog to narrow and generate from; the server owns the full shape. */
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

/** A server-supplied relative path that stays inside the output directory. */
function isSafeRelativePath(path: string): boolean {
  if (!path || path.includes('\\') || path.startsWith('/') || /^[A-Za-z]:/.test(path)) return false
  return path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..')
}

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
    if (typeof text !== 'string' || !isSafeRelativePath(path)) {
      throw new SimApiError(`The workflow source named an unsafe file path: ${path}`, 0)
    }
    files[path] = text
  }
  return {
    workflowId: data.workflowId,
    workspaceId: data.workspaceId,
    files,
    lock: data.lock,
    lockBase: data.lockBase,
    fingerprint: data.fingerprint,
    blockTypes: data.blockTypes.filter((type): type is string => typeof type === 'string'),
  }
}

/**
 * The catalog narrowed to the block types the workflow uses: their blocks, the builders that
 * create them, and the triggers they can run, read through the catalog view (an expanded entry is
 * a valid core-shard entry). Core declarations come from `core.d.ts`, so this is
 * all an editor or agent needs to type-check the file.
 */
function narrowCatalog(catalog: BlockCatalog, types: readonly string[]): BlockCatalog {
  const blocks: Record<string, CatalogBlock> = {}
  for (const type of types) {
    const block = catalogBlock(catalog, type)
    if (block) blocks[type] = block
  }
  const triggers: Record<string, CatalogTrigger> = {}
  for (const id of Object.values(blocks).flatMap((block) => block.triggers?.available ?? [])) {
    const trigger = catalogTrigger(catalog, id)
    if (trigger) triggers[id] = trigger
  }
  const builders: Record<string, CatalogBuilder> = {}
  for (const path of catalogBuilderPaths(catalog)) {
    const builder = catalogBuilder(catalog, path)
    if (builder && Object.hasOwn(blocks, builder.type)) builders[path] = builder
  }
  return { ...catalog, blocks, triggers, builders }
}

/** Standalone runs only: an embedded run has no local disk of its own to cache on. */
async function readCachedCatalog(outDir: string): Promise<CachedCatalog | null> {
  if (embedStore.getStore()) return null
  try {
    const parsed: unknown = JSON.parse(await readFile(join(outDir, CATALOG_CACHE), 'utf8'))
    if (isRecordLike(parsed) && typeof parsed.hash === 'string' && isBlockCatalog(parsed.catalog)) {
      return { hash: parsed.hash, catalog: parsed.catalog }
    }
  } catch {}
  return null
}

/**
 * The workflow's compile catalog, revalidated by ETag against the cached copy: a `304` reuses
 * it, anything else replaces it.
 */
async function loadCatalog(
  client: OperationClient<'getBlockCatalog'>,
  source: WorkflowSource,
  outDir: string
): Promise<{ catalog: BlockCatalog; fresh: boolean }> {
  const cached = await readCachedCatalog(outDir)
  try {
    const raw = await client.request<unknown>('getBlockCatalog', {
      params: { workspaceId: source.workspaceId },
      query: { workflowId: source.workflowId },
      ...(cached ? { headers: { 'if-none-match': `"${cached.hash}"` } } : {}),
    })
    const catalog = isRecordLike(raw) ? raw.data : null
    if (!isBlockCatalog(catalog)) {
      throw new SimApiError('The block catalog response was not in the expected shape.', 0)
    }
    return { catalog, fresh: true }
  } catch (error) {
    if (cached && error instanceof SimApiError && error.status === 304) {
      return { catalog: cached.catalog, fresh: false }
    }
    throw error
  }
}

/** Writes one file under `outDir`, through the host's writer when embedded. */
async function writeOutFile(outDir: string, relativePath: string, text: string): Promise<void> {
  const target = embedStore.getStore()
    ? posix.join(outDir, relativePath)
    : join(outDir, ...relativePath.split('/'))
  if (!embedStore.getStore()) await mkdir(dirname(target), { recursive: true })
  await saveToFile(new Blob([text]).stream(), target, true)
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
      paths: { '@sim/workflow-sdk': [`./${SDK_DIR}/core.d.ts`] },
    },
    include: ['workflow.ts', `${SDK_DIR}/**/*.d.ts`],
  },
  null,
  2
)}\n`

async function writeSourceTree(
  outDir: string,
  source: WorkflowSource,
  catalog: BlockCatalog
): Promise<number> {
  const sdkFiles = generateSdkTypes(narrowCatalog(catalog, source.blockTypes))
  const files: Array<[string, string]> = [
    ...Object.entries(source.files),
    ['.sim/lock.json', `${JSON.stringify(source.lock, null, 2)}\n`],
    ['.sim/base.json', `${JSON.stringify(source.lockBase, null, 2)}\n`],
    [`${SDK_DIR}/core.d.ts`, CORE_DTS],
    ...sdkFiles.map((file): [string, string] => [`${SDK_DIR}/${file.path}`, file.text]),
    ['tsconfig.json', TSCONFIG],
  ]
  for (const [path, text] of files) await writeOutFile(outDir, path, text)
  return files.length
}

/**
 * Teaches the generated `workflows source get` leaf `--out <dir>`: instead of printing the
 * response, it writes `workflow.ts`, `functions/*`, `.sim/lock.json`, `.sim/base.json`, the SDK
 * declarations for the block types the workflow uses (`.sim/sdk/**`, generated from the block
 * catalog, ETag-cached under `.sim/cache`) and a `tsconfig.json` that resolves them. Without
 * `--out` the generated handler runs unchanged. Commander offers no way to read the action it
 * holds, so it is captured and delegated to, as `runs get` does.
 */
export function attachWorkflowSourceGet(source: Command): void {
  const get = source.commands.find((command) => command.name() === 'get')
  const held = (get as (Command & { _actionHandler?: unknown }) | undefined)?._actionHandler
  if (!get || typeof held !== 'function') {
    throw new Error('workflows source get must be registered before --out can be attached to it')
  }
  const previous = held as (args: unknown[]) => unknown
  const connectGet = callsOperations(get, ['getWorkflowSource', 'getBlockCatalog'])

  get.option(
    `--${OUT_FLAG} <dir>`,
    'Write the source, its lock and SDK type declarations into this directory instead of printing them'
  )
  get.action(async (workflowId: string, _options: unknown, command: Command): Promise<void> => {
    const flags = command.optsWithGlobals() as Record<string, unknown>
    const outDir = flags[OUT_FLAG]
    if (typeof outDir !== 'string') {
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
    const source = readSource(
      await client.request<unknown>('getWorkflowSource', {
        params: request.params,
        query: request.query,
      })
    )
    const { catalog, fresh } = await loadCatalog(client, source, outDir)
    const written = await writeSourceTree(outDir, source, catalog)
    if (fresh && !embedStore.getStore()) {
      const cache: CachedCatalog = { hash: catalog.hash, catalog }
      await mkdir(dirname(join(outDir, CATALOG_CACHE)), { recursive: true })
      await writeFile(join(outDir, CATALOG_CACHE), JSON.stringify(cache))
    }
    printProtocolResult(profile.output, {
      workflowId: source.workflowId,
      outDir,
      files: written,
      fingerprint: source.fingerprint,
    })
  })
}
