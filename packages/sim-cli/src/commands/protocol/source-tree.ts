/**
 * What makes a source directory editable beside its printed files, shared by `workflows source`
 * and `workspaces source`: the block catalog (ETag-cached per workspace), the SDK declarations
 * generated from it, `workspace.d.ts` from the workspace's resources, the CLI's `tsconfig.json`,
 * the agent guide and the LF lines.
 */
import { createHash } from 'node:crypto'
import { rmSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { mapWithConcurrency } from '@sim/utils/concurrency'
import { isRecordLike, toRecord } from '@sim/utils/object'
import { escapeRegExp } from '@sim/utils/string'
import type { BlockCatalog } from '@sim/workflow-code'
import { catalogBlock } from '@sim/workflow-code/catalog/view'
import { SOURCE_BASE_FILE } from '@sim/workflow-code/limits'
import {
  COOKBOOK_EXAMPLES,
  CORE_DTS,
  checkedBlockTypes,
  defaultBlockFiles,
  fullBlockFiles,
  generateSdkTypes,
  generateWorkspaceTypes,
  referencedBlockTypes,
  SDK_INDEX_FILE,
  SDK_MAJOR,
  SDK_MODELS_FILE,
  sdkIndexHeader,
  type WorkspaceManifest,
} from '@sim/workflow-sdk/codegen'
import { printError, printLine } from '#sim-cli/output/io'
import type { OutputFormat } from '../../config/index'
import { readJsonFile, writeJsonFile } from '../../config/json-file'
import { configDir } from '../../config/paths'
import { embedStore } from '../../embed-context'
import { SOURCE_TOO_LARGE_EXIT_CODE } from '../../exit-codes'
import type { GetSourceResourcesResponse, GetWorkflowSourceResponse } from '../../generated/v2-api'
import { SimApiError } from '../../http/client'
import type { OperationClient } from '../../runtime/called-operations'
import { cliVersion } from '../../version'
import { SourceDirError } from './local-errors'
import { printProtocolResult } from './result'
import {
  FILE_CONCURRENCY,
  readSourceJson,
  readSourceText,
  SOURCE_SDK_DIR as SDK_DIR,
  SOURCE_AGENTS_FILE,
  SOURCE_EXAMPLES_DIR,
  SOURCE_GITATTRIBUTES_FILE,
  SOURCE_GITIGNORE_FILE,
  type SourceDirChange,
  updateSourceDir,
  withMissingLines,
} from './source-dir'
import { type PrimerKind, primerFor } from './source-primer'

const TSCONFIG_FILE = 'tsconfig.json'
/** Type-checks the source against every current block, for a block the default one leaves out. */
export const TSCONFIG_FULL_FILE = 'tsconfig.full.json'
/** The SDK file whose first line names the catalog the declarations were generated from. */
const SDK_INDEX_PATH = `${SDK_DIR}/${SDK_INDEX_FILE}`
/** The workspace's resources as types (`generateWorkspaceTypes`), beside the SDK. */
export const WORKSPACE_TYPES_FILE = `${SDK_DIR}/workspace.d.ts`
/**
 * The stored resources `workspace.d.ts` was generated from (the server's manifest at the last get),
 * so a check regenerates the file with what the directory declares now, without a request.
 */
const WORKSPACE_MANIFEST_FILE = `${SDK_DIR}/workspace.manifest.json`
/** A cached catalog is a few megabytes of JSON; a larger file was not written by this CLI. */
const MAX_CATALOG_CACHE_BYTES = 32 * 1024 * 1024

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

/** Workspace ids are uuids and catalog hashes hex; anything else never names a cache file. */
const CACHE_KEY = /^[\w-]+$/

/** The CLI's catalog cache: every catalog by its hash, and each workspace's current hash. */
function catalogCacheDir(): string {
  return join(configDir(), 'cache', 'source-catalog')
}

/**
 * Where a catalog is cached: by its content hash, so the workspace catalog and every per-workflow
 * catalog share one file per distinct catalog, however many workflows and workspaces name it.
 * Callers gate the hash with `CACHE_KEY` first.
 */
function catalogCachePath(hash: string): string {
  return join(catalogCacheDir(), `${hash}.json`)
}

/**
 * Where the hash of a workspace's catalog is recorded, so a get revalidates it by ETag and an
 * offline command finds it. Callers gate the id with `CACHE_KEY` first.
 */
function workspaceCatalogPointerPath(workspaceId: string): string {
  return join(catalogCacheDir(), 'workspaces', `${workspaceId}.json`)
}

/** A pointer is one hash; a larger file was not written by this CLI. */
const MAX_POINTER_BYTES = 4096

/**
 * The cached catalog of `hash`, or `null`. Standalone runs only: an embedded run has no local disk
 * of its own to cache on. The file is read without following a link and under a size cap, and
 * kept only when the catalog in it names the hash its file does.
 */
export function cachedCatalogByHash(hash: unknown): BlockCatalog | null {
  if (embedStore.getStore() || typeof hash !== 'string' || !CACHE_KEY.test(hash)) return null
  const cached = readJsonFile(catalogCachePath(hash), MAX_CATALOG_CACHE_BYTES)
  return isBlockCatalog(cached) && cached.hash === hash ? cached : null
}

/** The cached catalog of the workspace, by the hash its last catalog read recorded, or `null`. */
export function cachedCatalog(workspaceId: string): BlockCatalog | null {
  if (embedStore.getStore() || !CACHE_KEY.test(workspaceId)) return null
  const pointer = readJsonFile(workspaceCatalogPointerPath(workspaceId), MAX_POINTER_BYTES)
  return isRecordLike(pointer) ? cachedCatalogByHash(pointer.hash) : null
}

/**
 * The cached catalog a workflow source directory was printed against, by the hash its
 * `.sim/base.json` records (the workspace's, or the workflow's own for a workflow holding a type
 * the workspace catalog lacks), or `null` when the directory has no base or that catalog is not
 * cached. An offline check compiles against it, so it agrees with the dry run, which compiles
 * against the same catalog.
 */
export async function cachedSourceCatalog(dir: string): Promise<BlockCatalog | null> {
  return cachedCatalogByHash(toRecord(await readSourceJson(dir, SOURCE_BASE_FILE)).catalogHash)
}

/** The catalog a `getSourceCatalog` answer carries. */
function catalogFrom(response: { data: unknown }): BlockCatalog {
  if (!isBlockCatalog(response.data)) {
    throw new SourceDirError('The block catalog response was not in the expected shape.')
  }
  return response.data
}

/**
 * Caches `catalog` by its hash, replacing the file atomically; a failed write only costs the next
 * get a download. An unchanged catalog is not rewritten.
 */
function writeCachedCatalog(catalog: BlockCatalog): void {
  if (embedStore.getStore() || !CACHE_KEY.test(catalog.hash)) return
  if (cachedCatalogByHash(catalog.hash)) return
  writeJsonFile(catalogCachePath(catalog.hash), catalog)
}

/**
 * Records `hash` as the workspace's catalog, dropping the per-workspace copy and the
 * per-workflow copies an older CLI cached under the workspace id.
 */
function writeWorkspaceCatalogPointer(workspaceId: string, hash: string): void {
  if (embedStore.getStore() || !CACHE_KEY.test(workspaceId)) return
  writeJsonFile(workspaceCatalogPointerPath(workspaceId), { hash })
  for (const legacy of [`${workspaceId}.json`, workspaceId]) {
    if (legacy === `${hash}.json`) continue
    try {
      rmSync(join(catalogCacheDir(), legacy), { recursive: true, force: true })
    } catch {}
  }
}

/**
 * The catalog of the workflow `workflowId` (the workspace catalog plus the types it stores that the
 * workspace catalog lacks), fetched and cached by hash; `knownHash`, a hash the workflow's catalog
 * may have, is sent as its ETag, so a catalog already cached answers `304` with no body.
 */
export async function loadWorkflowCatalog(
  client: OperationClient<'getSourceCatalog'>,
  workspaceId: string,
  workflowId: string,
  knownHash?: string
): Promise<BlockCatalog> {
  const known = cachedCatalogByHash(knownHash)
  try {
    const catalog = catalogFrom(
      await client.request<{ data: unknown }>('getSourceCatalog', {
        params: { workspaceId },
        query: { workflowId },
        ...(known ? { headers: { 'if-none-match': `"${known.hash}"` } } : {}),
      })
    )
    writeCachedCatalog(catalog)
    return catalog
  } catch (error) {
    if (!known || !(error instanceof SimApiError) || error.status !== 304) throw error
    return known
  }
}

/**
 * The workspace's block catalog, revalidated by ETag against the cached one: a `304` reuses it,
 * anything else replaces it. A workflow can hold a type the workspace no longer offers (a legacy
 * version, a block an allowlist now withholds); only then is that workflow's own catalog used
 * instead, so its types still resolve: the one cached under the hash its base records
 * (`catalogHash`), else fetched ({@link loadWorkflowCatalog}).
 */
export async function loadCatalog(
  client: OperationClient<'getSourceCatalog'>,
  source: Pick<GetWorkflowSourceResponse['data'], 'workspaceId' | 'blockTypes'> & {
    workflowId?: string
    catalogHash?: string
  }
): Promise<BlockCatalog> {
  const cached = cachedCatalog(source.workspaceId)
  let catalog: BlockCatalog
  try {
    catalog = catalogFrom(
      await client.request<{ data: unknown }>('getSourceCatalog', {
        params: { workspaceId: source.workspaceId },
        ...(cached ? { headers: { 'if-none-match': `"${cached.hash}"` } } : {}),
      })
    )
    writeCachedCatalog(catalog)
  } catch (error) {
    if (!cached || !(error instanceof SimApiError) || error.status !== 304) throw error
    catalog = cached
  }
  writeWorkspaceCatalogPointer(source.workspaceId, catalog.hash)
  const declaresAll = (candidate: BlockCatalog) =>
    source.blockTypes.every((type) => catalogBlock(candidate, type) !== undefined)
  if (source.workflowId === undefined || declaresAll(catalog)) return catalog
  const printedWith = cachedCatalogByHash(source.catalogHash)
  if (printedWith && declaresAll(printedWith)) return printedWith
  return loadWorkflowCatalog(client, source.workspaceId, source.workflowId)
}

/**
 * The resource manifest as `generateWorkspaceTypes` reads it. A server older than the skills,
 * custom tools and MCP servers sections omits them, which leaves those keys plain strings.
 */
function workspaceManifestFrom({
  tables,
  knowledgeBases,
  credentials,
  workflows,
  skills = [],
  customTools = [],
  mcpServers = [],
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
    skills: skills.map((entry) => entry.key),
    customTools: customTools.map((entry) => entry.key),
    mcpServers: Object.fromEntries(
      mcpServers.map((server) => [server.key, server.tools ? { tools: server.tools } : {}])
    ),
    env,
  }
}

/** What a workspace directory declares itself, typed beside the stored resources. */
export type LocalDeclarations = Pick<
  WorkspaceManifest,
  | 'declarationModules'
  | 'secretDeclarations'
  | 'credentialDeclarations'
  | 'tableDeclarations'
  | 'knowledgeBases'
  | 'skills'
  | 'customTools'
  | 'mcpServerDeclarations'
  | 'workflows'
>

/** `workspace.d.ts`, and the stored manifest it was generated from (`null` when none was read). */
export interface WorkspaceTypes {
  text: string
  stored: WorkspaceManifest | null
}

/**
 * `workspace.d.ts` for the `stored` resources with what a workspace directory declares typed too:
 * its tables, secrets and credentials from their declarations, and its knowledge base, skill,
 * custom tool and workflow keys beside the stored ones. A workflow the directory declares only by
 * its key (no `inputs`) keeps its stored inputs, so a parent's `inputMapping` stays checked; a
 * declared `inputs` wins. `null` without either.
 */
function workspaceTypesFrom(
  stored: WorkspaceManifest | null,
  local: LocalDeclarations
): WorkspaceTypes | null {
  if (!stored) {
    const declared = Object.entries(local).some(
      ([list, keys]) =>
        list !== 'declarationModules' && keys !== undefined && Object.keys(keys).length > 0
    )
    return declared ? { text: generateWorkspaceTypes(local).text, stored: null } : null
  }
  const both = (key: 'knowledgeBases' | 'skills' | 'customTools') => [
    ...(stored[key] ?? []),
    ...(local[key] ?? []),
  ]
  const text = generateWorkspaceTypes({
    ...stored,
    ...(local.declarationModules ? { declarationModules: local.declarationModules } : {}),
    ...(local.tableDeclarations ? { tableDeclarations: local.tableDeclarations } : {}),
    ...(local.mcpServerDeclarations ? { mcpServerDeclarations: local.mcpServerDeclarations } : {}),
    ...(local.secretDeclarations ? { secretDeclarations: local.secretDeclarations } : {}),
    ...(local.credentialDeclarations
      ? { credentialDeclarations: local.credentialDeclarations }
      : {}),
    knowledgeBases: both('knowledgeBases'),
    skills: both('skills'),
    customTools: both('customTools'),
    workflows: Object.fromEntries([
      ...Object.entries(stored.workflows ?? {}),
      ...Object.entries(local.workflows ?? {}).filter(
        ([key, entry]) => entry.inputs !== undefined || !Object.hasOwn(stored.workflows ?? {}, key)
      ),
    ]),
  }).text
  return { text, stored }
}

/**
 * The workspace's resources as `workspace.d.ts` ({@link workspaceTypesFrom}), read from the
 * server. When the resources cannot be listed (a `403` for a caller the manifest does not admit, a
 * `404` from a server that predates the route) only the declared resources are typed, or `null`
 * without any: the source still writes and type-checks, with every other key a plain string.
 */
export async function loadWorkspaceTypes(
  client: OperationClient<'getSourceResources'>,
  workspaceId: string,
  local: LocalDeclarations = {},
  options: { optional?: boolean } = {}
): Promise<WorkspaceTypes | null> {
  try {
    const { data } = await client.request<GetSourceResourcesResponse>('getSourceResources', {
      params: { workspaceId },
      ...(options.optional ? { retryRateLimited: false } : {}),
    })
    return workspaceTypesFrom(workspaceManifestFrom(data), local)
  } catch (error) {
    if (!(error instanceof SimApiError) || (error.status !== 403 && error.status !== 404)) {
      throw error
    }
    return workspaceTypesFrom(null, local)
  }
}

/**
 * Regenerates `workspace.d.ts` from the stored manifest the last get kept beside it and what the
 * directory declares now (`local`), so `tsc` types a key added since without a request. A
 * directory with no kept manifest (written by an older CLI) is left as it is.
 */
export async function refreshWorkspaceTypes(dir: string, local: LocalDeclarations): Promise<void> {
  const [manifest, current] = await Promise.all([
    readSourceText(dir, WORKSPACE_MANIFEST_FILE),
    readSourceText(dir, WORKSPACE_TYPES_FILE),
  ])
  if (manifest === null) return
  let stored: unknown
  try {
    stored = JSON.parse(manifest)
  } catch {
    return
  }
  if (!isRecordLike(stored)) return
  const types = workspaceTypesFrom(stored, local)
  if (types && types.text !== current) {
    await updateSourceDir(dir, { write: [[WORKSPACE_TYPES_FILE, types.text]] })
  }
}

/**
 * Re-reads the workspace's resources into a workflow directory's `workspace.d.ts` and the manifest
 * kept beside it, so `tsc` types a resource created since the last get (a child workflow, a table,
 * a credential) instead of refusing its key, and stops accepting one deleted since. The commands
 * that already talk to the server (apply, create, status) call it; an offline
 * check cannot. Only a directory holding types the CLI wrote is touched (a workflow folder of a
 * workspace directory types its workflows at the root, which the workspace commands refresh), only
 * a file whose text changes is rewritten, and a failure to list the resources (a rate limit, a
 * dropped connection) leaves the files as they are: the types are a convenience, never the write,
 * so a rate-limited listing is not resent. A dry run, which writes no files, does not call it.
 */
export async function refreshWorkflowWorkspaceTypes(
  client: OperationClient<'getSourceResources'>,
  dir: string,
  workspaceId: string
): Promise<void> {
  const [types, manifest] = await Promise.all([
    readSourceText(dir, WORKSPACE_TYPES_FILE),
    readSourceText(dir, WORKSPACE_MANIFEST_FILE),
  ])
  if (types === null || manifest === null) return
  const fresh = await loadWorkspaceTypes(client, workspaceId, {}, { optional: true }).catch(
    () => null
  )
  if (!fresh?.stored) return
  const stored = `${JSON.stringify(fresh.stored, null, 2)}\n`
  const write = [
    ...(fresh.text !== types ? [[WORKSPACE_TYPES_FILE, fresh.text] as const] : []),
    ...(stored !== manifest ? [[WORKSPACE_MANIFEST_FILE, stored] as const] : []),
  ]
  if (write.length > 0) await updateSourceDir(dir, { write })
}

/**
 * Refuses a catalog for another SDK major than the bundled `core.d.ts`: its builders would be
 * written beside declarations that cannot type them.
 */
export function assertSdkMajor(catalog: BlockCatalog): void {
  if (catalog.sdkMajor === SDK_MAJOR) return
  throw new SourceDirError(
    catalog.sdkMajor > SDK_MAJOR
      ? `This workspace uses workflow SDK ${catalog.sdkMajor}, but this CLI writes SDK ${SDK_MAJOR} declarations. Upgrade the CLI (npm install -g sim@latest) and run the command again.`
      : `This workspace uses workflow SDK ${catalog.sdkMajor}, but this CLI writes SDK ${SDK_MAJOR} declarations. Install a CLI release for SDK ${catalog.sdkMajor} to work with this server.`,
    { code: 'SDK_MAJOR_MISMATCH' }
  )
}

/**
 * The first line of every `tsconfig.json` the CLI writes. A `tsconfig.json` without it is the
 * person's own (an existing TypeScript project), and a get never replaces it.
 */
export const TSCONFIG_MARKER = `// Written by \`sim workflows source get\`; remove this line to keep your own edits.`

/**
 * The second line of the generated `index.d.ts`: the CLI release and the `core.d.ts` it bundles.
 * The catalog header alone cannot tell declarations a new CLI generates differently (a codegen or
 * `core.d.ts` change within the same SDK major) from the old ones, so both lines key the cache.
 */
function sdkGeneratorLine(): string {
  const core = createHash('sha256').update(CORE_DTS, 'utf8').digest('hex').slice(0, 16)
  return `// generated by sim ${cliVersion()} · core.d.ts ${core}`
}

/** Under the index's catalog header, the generator line; `blockTypes` as `generateSdkTypes` takes it. */
function sdkTypeFiles(
  catalog: BlockCatalog,
  blockTypes?: ReadonlySet<string>
): Array<readonly [string, string]> {
  const generator = sdkGeneratorLine()
  return generateSdkTypes(catalog, blockTypes ? { blockTypes } : {}).map((file) => {
    if (file.path !== SDK_INDEX_FILE) return [file.path, file.text] as const
    const [header, ...rest] = file.text.split('\n')
    return [file.path, [header, generator, ...rest].join('\n')] as const
  })
}

/** The head a current `index.d.ts` starts with: the catalog header and the generator line. */
function sdkIndexHead(catalog: BlockCatalog): string {
  return `${sdkIndexHeader(catalog)}\n${sdkGeneratorLine()}`
}

/**
 * Where the declarations of every block of `catalog` are cached, once per catalog and generator
 * (the generator line's digest), beside the catalog itself. `tsconfig.full.json` includes the
 * `index.d.ts` there, so a directory holds only the blocks it uses. Callers gate the hash with
 * `CACHE_KEY` first.
 */
function sdkCacheDir(catalog: BlockCatalog): string {
  const generator = createHash('sha256').update(sdkGeneratorLine(), 'utf8').digest('hex')
  return join(catalogCacheDir(), catalog.hash, `sdk-${generator.slice(0, 16)}`)
}

/**
 * The cached full declarations' `index.d.ts` for `catalog` (an absolute path), generating them
 * into a staging folder moved into place on the first call; later calls only check the index.
 * `null` in an embedded run, which has no disk of its own, or when the cache cannot be written:
 * the directory then holds every block itself, as before the cache.
 */
async function sdkCacheIndex(catalog: BlockCatalog): Promise<string | null> {
  if (embedStore.getStore() || !CACHE_KEY.test(catalog.hash)) return null
  const dir = sdkCacheDir(catalog)
  const index = join(dir, SDK_INDEX_FILE)
  const head = sdkIndexHead(catalog)
  const current = await readFile(index, 'utf8').catch(() => null)
  if (current?.startsWith(`${head}\n`)) return index
  try {
    await mkdir(dirname(dir), { recursive: true })
    const staging = await mkdtemp(`${dir}.staging-`)
    try {
      const files = sdkTypeFiles(catalog)
      const parents = new Set(files.map(([path]) => dirname(join(staging, path))))
      for (const parent of parents) await mkdir(parent, { recursive: true })
      await mapWithConcurrency(files, FILE_CONCURRENCY, ([path, text]) =>
        writeFile(join(staging, path), text)
      )
      await rm(dir, { recursive: true, force: true })
      // Another command that generated the same files first already moved them into place.
      await rename(staging, dir).catch(async (error: unknown) => {
        if (!(await readFile(index, 'utf8').catch(() => null))?.startsWith(`${head}\n`)) throw error
      })
    } finally {
      await rm(staging, { recursive: true, force: true })
    }
    return index
  } catch {
    return null
  }
}

/** What a tree write reports: the same fields after a get and a create scaffold. */
export interface SourceTree {
  /** How many files were written. */
  files: number
  /** Whether `workspace.d.ts` was written. */
  workspaceTypes: boolean
  /** The agent guide to read before editing. */
  guide: typeof SOURCE_AGENTS_FILE
  /** The primer atop the guide (`source-primer.ts`), printed so an agent needs no other read. */
  primer: string
}

/** Reports a `tsconfig.json` the CLI left alone and summarizes a tree write. */
export function finishTree(
  dir: string,
  written: number,
  workspaceTypes: WorkspaceTypes | null,
  tree: { ownsTsconfig: boolean; primer: string }
): SourceTree {
  if (!tree.ownsTsconfig) {
    printError(
      `note: ${TSCONFIG_FILE} in ${dir} is not the CLI's, so it was left as it is. To type-check the source, map "@sim/workflow-sdk" to ["./${SDK_DIR}/core.d.ts"] in its compilerOptions.paths.`
    )
  }
  return {
    files: written,
    workspaceTypes: workspaceTypes !== null,
    guide: SOURCE_AGENTS_FILE,
    primer: tree.primer,
  }
}

/**
 * Prints a tree write's result: in JSON or YAML one document with the primer as its `primer`
 * field, otherwise the fields and then the primer as text, so it reads as written.
 */
export function printTreeResult(
  format: OutputFormat,
  result: Record<string, unknown> & { primer: string }
): void {
  if (format === 'json' || format === 'yaml') {
    printProtocolResult(format, result)
    return
  }
  const { primer, ...fields } = result
  printProtocolResult(format, fields)
  printLine(`\n${primer}`)
}

/** What a directory's editable tree holds beside the printed source. */
export interface SourceTreeProfile {
  /** Which primer opens `.sim/AGENTS.md`. */
  kind: PrimerKind
  /** The reference in `.sim/AGENTS.md`, below the primer. */
  agents: string
  /** More guides beside `.sim/AGENTS.md` (path → text), rewritten every time like it. */
  guides?: ReadonlyArray<readonly [string, string]>
  /**
   * A `tsconfig.json` the CLI writes, starting with {@link TSCONFIG_MARKER}, that type-checks the
   * source with the SDK declarations `sdkFiles` (directory-relative paths).
   */
  tsconfig: (sdkFiles: readonly string[]) => string
  /** The `.gitattributes` lines that keep the source LF. */
  gitattributes?: readonly string[]
  /** The `.gitignore` lines for the files a command leaves only while it runs or between runs. */
  gitignore?: readonly string[]
  /** More declarations under the SDK directory, rewritten every time like `core.d.ts`. */
  sdk?: ReadonlyArray<readonly [string, string]>
  /** More examples beside the cookbook, rewritten every time like it. */
  examples?: ReadonlyArray<readonly [string, string]>
}

/**
 * The SDK files each written tsconfig includes for source that uses the `used` block types:
 * `tsconfig.json` the models, `workspace.d.ts` and only those blocks (plus the core builders'),
 * which the directory holds, so `tsc` reads a few dozen files instead of every block;
 * `tsconfig.full.json` every current block for adding one the source does not use yet, through
 * `fullIndex` (the cached index, else the directory's own).
 */
function sdkIncludes(
  catalog: BlockCatalog,
  used: readonly string[],
  hasWorkspaceTypes: boolean,
  fullIndex: string
): { tsconfig: string[]; full: string[] } {
  const workspace = hasWorkspaceTypes ? [WORKSPACE_TYPES_FILE] : []
  const inSdk = (files: readonly string[]) => files.map((file) => `${SDK_DIR}/${file}`)
  return {
    tsconfig: [
      ...inSdk([SDK_MODELS_FILE]),
      ...workspace,
      ...inSdk(defaultBlockFiles(catalog, used)),
    ],
    full: [
      ...fullBlockFiles(catalog, used).map((file) =>
        file === SDK_INDEX_FILE ? fullIndex : `${SDK_DIR}/${file}`
      ),
      ...workspace,
    ],
  }
}

/** The block types source that uses `use` names: the server's, and the builders it calls. */
function usedBlockTypes(catalog: BlockCatalog, use: SourceTreeUse): string[] {
  return [...new Set([...(use.blockTypes ?? []), ...referencedBlockTypes(catalog, use.sources)])]
}

/**
 * The CLI's tsconfig files for the `used` block types: each written when it is absent or still
 * starts with {@link TSCONFIG_MARKER}, so a person's own file is never replaced.
 */
function tsconfigWrites(
  catalog: BlockCatalog,
  hasWorkspaceTypes: boolean,
  profile: Pick<SourceTreeProfile, 'tsconfig'>,
  used: readonly string[],
  fullIndex: string,
  current: { tsconfig: string | null; full: string | null }
): { write: Array<readonly [string, string]>; ownsTsconfig: boolean } {
  const includes = sdkIncludes(catalog, used, hasWorkspaceTypes, fullIndex)
  const owned = (text: string | null) => text === null || text.startsWith(TSCONFIG_MARKER)
  const write: Array<readonly [string, string]> = []
  const ownsTsconfig = owned(current.tsconfig)
  if (ownsTsconfig) write.push([TSCONFIG_FILE, profile.tsconfig(includes.tsconfig)])
  if (owned(current.full)) write.push([TSCONFIG_FULL_FILE, profile.tsconfig(includes.full)])
  return { write, ownsTsconfig }
}

/**
 * The generated declarations a directory holds for the `used` block types, under the SDK
 * directory: the models, an index and `INDEX.md` of its blocks, and the file of each block
 * `tsconfig.json` includes. Without a cache (`cached` false) every block, as the full config then
 * reads the directory's own index.
 */
function localSdkFiles(
  catalog: BlockCatalog,
  used: readonly string[],
  cached: boolean
): Array<readonly [string, string]> {
  const blockTypes = cached ? new Set(checkedBlockTypes(catalog, used)) : undefined
  return sdkTypeFiles(catalog, blockTypes).map(
    ([path, text]) => [`${SDK_DIR}/${path}`, text] as const
  )
}

/** `tsconfig.full.json`'s index: the cached one, else the directory's own. */
function fullIndexPath(cacheIndex: string | null): string {
  return cacheIndex ?? SDK_INDEX_PATH
}

/**
 * Brings the CLI's tsconfig files and the block declarations the directory holds up to date with
 * the source `use` names: after an apply, which may have added a block, and on a check, so a block
 * the edit added type-checks before anything is applied. `incremental` (a check) keeps the blocks
 * `tsconfig.json` includes now, since a check scans only the source text and not the server's
 * block types, and rewrites `tsconfig.json` only when it exists (`tsconfig.full.json`, which names
 * this machine's cache, is written again when missing, as a fresh clone lacks it). It reads the
 * cached catalog, so it costs no request; without one nothing changes until the next get. A file
 * whose text would not change is not rewritten.
 */
export async function refreshTsconfigs(
  dir: string,
  workspaceId: string,
  profile: Pick<SourceTreeProfile, 'tsconfig'>,
  use: SourceTreeUse,
  options: { incremental?: boolean } = {}
): Promise<void> {
  const catalog = (await cachedSourceCatalog(dir)) ?? cachedCatalog(workspaceId)
  if (!catalog) return
  const [tsconfig, full, workspaceTypes, index, cacheIndex] = await Promise.all([
    readSourceText(dir, TSCONFIG_FILE),
    readSourceText(dir, TSCONFIG_FULL_FILE),
    readSourceText(dir, WORKSPACE_TYPES_FILE),
    readSourceText(dir, SDK_INDEX_PATH),
    sdkCacheIndex(catalog),
  ])
  const kept = options.incremental ? includedBlockTypes(tsconfig) : []
  const used = usedBlockTypes(catalog, {
    ...use,
    blockTypes: [...(use.blockTypes ?? []), ...kept],
  })
  const { write } = tsconfigWrites(
    catalog,
    workspaceTypes !== null,
    profile,
    used,
    fullIndexPath(cacheIndex),
    { tsconfig, full }
  )
  const current = new Map<string, string | null>([
    [TSCONFIG_FILE, tsconfig],
    [TSCONFIG_FULL_FILE, full],
  ])
  // Declarations of another catalog or generator are left for the next get, which replaces them.
  const declarations =
    cacheIndex !== null && index?.startsWith(`${sdkIndexHead(catalog)}\n`)
      ? localSdkFiles(catalog, used, true).filter(([path]) => path.startsWith(`${SDK_DIR}/blocks/`))
      : []
  const texts = await mapWithConcurrency(declarations, FILE_CONCURRENCY, ([path]) =>
    readSourceText(dir, path)
  )
  declarations.forEach(([path], position) => current.set(path, texts[position]))
  const changed = [...write, ...declarations].filter(
    ([path, text]) =>
      current.get(path) !== text &&
      (!options.incremental || path !== TSCONFIG_FILE || current.get(path) !== null)
  )
  if (changed.length > 0) await updateSourceDir(dir, { write: changed })
}

const INCLUDED_BLOCK = new RegExp(`^${escapeRegExp(SDK_DIR)}/blocks/(.+)\\.d\\.ts$`)

/** The block types a CLI-written `tsconfig.json` includes; none for any other text. */
function includedBlockTypes(tsconfig: string | null): string[] {
  if (tsconfig === null || !tsconfig.startsWith(TSCONFIG_MARKER)) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(tsconfig.slice(TSCONFIG_MARKER.length))
  } catch {
    return []
  }
  const include = isRecordLike(parsed) && Array.isArray(parsed.include) ? parsed.include : []
  return include.flatMap((entry) => {
    const type = typeof entry === 'string' ? INCLUDED_BLOCK.exec(entry)?.[1] : undefined
    return type === undefined ? [] : [type]
  })
}

/** What a tree write type-checks: the source texts it scans for builders, and known block types. */
export interface SourceTreeUse {
  /** Workflow source texts (`workflow.ts` files); the builders they call pick the blocks. */
  sources: Iterable<string>
  /** Block types the server reported the source using, as blocks or agent tools. */
  blockTypes?: readonly string[]
}

/**
 * Everything beside the printed source that makes a directory editable: the agent guide (the
 * primer for the builders `use` calls, then the profile's reference) and the example workflows
 * (both rewritten every time and never in `.sim/written.json`), the declarations of the blocks
 * the source uses (every block's are cached once per catalog, for `tsconfig.full.json`),
 * `workspace.d.ts`, the CLI's `tsconfig.json` and `tsconfig.full.json`, and the LF lines.
 * Declarations of another catalog or generator are removed whole; otherwise only the block files,
 * so a block the source no longer uses loses its file. `incremental` (a write that leaves
 * workflows on disk unread, such as a get of only some kinds) keeps the blocks `tsconfig.json`
 * includes now, as {@link refreshTsconfigs} does, adding the ones `use` needs.
 */
export async function sourceTreeChange(
  dir: string,
  catalog: BlockCatalog,
  workspaceTypes: WorkspaceTypes | null,
  profile: SourceTreeProfile,
  use: SourceTreeUse,
  options: { incremental?: boolean } = {}
): Promise<{ change: SourceDirChange; ownsTsconfig: boolean; primer: string }> {
  const sources = [...use.sources]
  const primer = primerFor(profile.kind, catalog, sources)
  const write: Array<readonly [string, string]> = [
    [SOURCE_AGENTS_FILE, `${primer}\n${profile.agents}`],
    ...(profile.guides ?? []),
    ...Object.entries(COOKBOOK_EXAMPLES).map(
      ([file, text]) => [`${SOURCE_EXAMPLES_DIR}/${file}`, text] as const
    ),
    ...(profile.examples ?? []),
    [`${SDK_DIR}/core.d.ts`, CORE_DTS],
    ...(profile.sdk ?? []),
  ]
  const remove: string[] = []
  const [gitattributes, gitignore, index, tsconfig, tsconfigFull, cacheIndex] = await Promise.all([
    readSourceText(dir, SOURCE_GITATTRIBUTES_FILE),
    profile.gitignore ? readSourceText(dir, SOURCE_GITIGNORE_FILE) : null,
    readSourceText(dir, SDK_INDEX_PATH),
    readSourceText(dir, TSCONFIG_FILE),
    readSourceText(dir, TSCONFIG_FULL_FILE),
    sdkCacheIndex(catalog),
  ])
  const kept = options.incremental ? includedBlockTypes(tsconfig) : []
  const used = usedBlockTypes(catalog, {
    sources,
    blockTypes: [...(use.blockTypes ?? []), ...kept],
  })
  const tsconfigs = tsconfigWrites(
    catalog,
    workspaceTypes !== null,
    profile,
    used,
    fullIndexPath(cacheIndex),
    { tsconfig, full: tsconfigFull }
  )
  write.push(...tsconfigs.write)
  const ownsTsconfig = tsconfigs.ownsTsconfig
  const mergedAttributes = withMissingLines(gitattributes, profile.gitattributes)
  if (mergedAttributes !== null) write.push([SOURCE_GITATTRIBUTES_FILE, mergedAttributes])
  const mergedIgnore = profile.gitignore ? withMissingLines(gitignore, profile.gitignore) : null
  if (mergedIgnore !== null) write.push([SOURCE_GITIGNORE_FILE, mergedIgnore])
  const current = index?.startsWith(`${sdkIndexHead(catalog)}\n`) === true
  if (!current) remove.push(SDK_DIR)
  if (cacheIndex !== null) {
    if (current) remove.push(`${SDK_DIR}/blocks`)
    write.push(...localSdkFiles(catalog, used, true))
  } else if (!current) {
    write.push(...localSdkFiles(catalog, used, false))
  }
  if (workspaceTypes === null) remove.push(WORKSPACE_TYPES_FILE)
  else write.push([WORKSPACE_TYPES_FILE, workspaceTypes.text])
  if (workspaceTypes?.stored) {
    write.push([WORKSPACE_MANIFEST_FILE, `${JSON.stringify(workspaceTypes.stored, null, 2)}\n`])
  } else {
    remove.push(WORKSPACE_MANIFEST_FILE)
  }
  return { change: { write, remove }, ownsTsconfig, primer }
}

/** A read the server refused as over the source size limits exits 7, as a refused apply does. */
export function withSourceExitCode(error: unknown): unknown {
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
