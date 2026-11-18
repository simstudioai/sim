/**
 * What makes a source directory editable beside its printed files, shared by `workflows source`
 * and `workspaces source`: the block catalog (ETag-cached per workspace), the SDK declarations
 * generated from it, `workspace.d.ts` from the workspace's resources, the CLI's `tsconfig.json`,
 * the agent guide and the LF lines.
 */
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { isRecordLike } from '@sim/utils/object'
import type { BlockCatalog } from '@sim/workflow-code'
import { catalogBlock } from '@sim/workflow-code/catalog/view'
import {
  COOKBOOK_TS,
  CORE_DTS,
  generateSdkTypes,
  generateWorkspaceTypes,
  SDK_MAJOR,
  sdkIndexHeader,
  type WorkspaceManifest,
} from '@sim/workflow-sdk/codegen'
import { printError } from '#sim-cli/output/io'
import { readJsonFile, writeJsonFile } from '../../config/json-file'
import { configDir } from '../../config/paths'
import { embedStore } from '../../embed-context'
import { SOURCE_TOO_LARGE_EXIT_CODE } from '../../exit-codes'
import type { GetSourceResourcesResponse, GetWorkflowSourceResponse } from '../../generated/v2-api'
import { SimApiError } from '../../http/client'
import type { OperationClient } from '../../runtime/called-operations'
import { cliVersion } from '../../version'
import {
  mergedGitattributes,
  readSourceText,
  SOURCE_SDK_DIR as SDK_DIR,
  SOURCE_AGENTS_FILE,
  SOURCE_COOKBOOK_FILE,
  SOURCE_GITATTRIBUTES_FILE,
  type SourceDirChange,
} from './source-dir'

const TSCONFIG_FILE = 'tsconfig.json'
/** The SDK file whose first line names the catalog the declarations were generated from. */
const SDK_INDEX_FILE = `${SDK_DIR}/index.d.ts`
/** The workspace's resources as types (`generateWorkspaceTypes`), beside the SDK. */
export const WORKSPACE_TYPES_FILE = `${SDK_DIR}/workspace.d.ts`
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
export async function loadCatalog(
  client: OperationClient<'getSourceCatalog'>,
  source: Pick<GetWorkflowSourceResponse['data'], 'workspaceId' | 'blockTypes'> & {
    workflowId?: string
  }
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

/**
 * The resource manifest as `generateWorkspaceTypes` reads it. A server older than the skills and
 * custom tools sections omits them, which leaves those keys plain strings.
 */
function workspaceManifestFrom({
  tables,
  knowledgeBases,
  credentials,
  workflows,
  skills = [],
  customTools = [],
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
    env,
  }
}

/** What a workspace directory declares itself, typed beside the stored resources. */
export type LocalDeclarations = Pick<
  WorkspaceManifest,
  | 'secretDeclarations'
  | 'credentialDeclarations'
  | 'tableDeclarations'
  | 'knowledgeBases'
  | 'skills'
  | 'customTools'
  | 'workflows'
>

/**
 * The workspace's resources as `workspace.d.ts`, with what a workspace directory declares typed
 * too: its tables, secrets and credentials from their declarations, and its knowledge base, skill,
 * custom tool and workflow keys beside the stored ones (a stored workflow keeps its typed inputs). When the resources
 * cannot be listed (a `403` for a caller the manifest does not admit, a `404` from a server that
 * predates the route) only the declared resources are typed, or `null` without any: the source
 * still writes and type-checks, with every other key a plain string.
 */
export async function loadWorkspaceTypes(
  client: OperationClient<'getSourceResources'>,
  workspaceId: string,
  local: LocalDeclarations = {}
): Promise<string | null> {
  try {
    const { data } = await client.request<GetSourceResourcesResponse>('getSourceResources', {
      params: { workspaceId },
    })
    const stored = workspaceManifestFrom(data)
    const both = (key: 'knowledgeBases' | 'skills' | 'customTools') => [
      ...(stored[key] ?? []),
      ...(local[key] ?? []),
    ]
    return generateWorkspaceTypes({
      ...stored,
      ...(local.tableDeclarations ? { tableDeclarations: local.tableDeclarations } : {}),
      ...(local.secretDeclarations ? { secretDeclarations: local.secretDeclarations } : {}),
      ...(local.credentialDeclarations
        ? { credentialDeclarations: local.credentialDeclarations }
        : {}),
      knowledgeBases: both('knowledgeBases'),
      skills: both('skills'),
      customTools: both('customTools'),
      workflows: { ...local.workflows, ...stored.workflows },
    }).text
  } catch (error) {
    if (!(error instanceof SimApiError) || (error.status !== 403 && error.status !== 404)) {
      throw error
    }
    const declared = Object.values(local).some(
      (keys) => keys !== undefined && Object.keys(keys).length > 0
    )
    return declared ? generateWorkspaceTypes(local).text : null
  }
}

/**
 * Refuses a catalog for another SDK major than the bundled `core.d.ts`: its builders would be
 * written beside declarations that cannot type them.
 */
export function assertSdkMajor(catalog: BlockCatalog): void {
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

/** The generated declarations, with the generator line under the index's catalog header. */
function sdkTypeFiles(catalog: BlockCatalog): Array<readonly [string, string]> {
  const generator = sdkGeneratorLine()
  return generateSdkTypes(catalog).map((file) => {
    if (file.path !== 'index.d.ts') return [`${SDK_DIR}/${file.path}`, file.text] as const
    const [header, ...rest] = file.text.split('\n')
    return [`${SDK_DIR}/${file.path}`, [header, generator, ...rest].join('\n')] as const
  })
}

/** What a tree write reports: the same fields after a get and a create scaffold. */
export interface SourceTree {
  /** How many files were written. */
  files: number
  /** Whether `workspace.d.ts` was written. */
  workspaceTypes: boolean
  /** The agent guide to read before editing. */
  guide: typeof SOURCE_AGENTS_FILE
}

/** Reports a `tsconfig.json` the CLI left alone and summarizes a tree write. */
export function finishTree(
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
  return { files: written, workspaceTypes: workspaceTypes !== null, guide: SOURCE_AGENTS_FILE }
}

/** What a directory's editable tree holds beside the printed source. */
export interface SourceTreeProfile {
  /** `.sim/AGENTS.md`. */
  agents: string
  /** The CLI's `tsconfig.json`, starting with {@link TSCONFIG_MARKER}. */
  tsconfig: string
  /** The `.gitattributes` lines that keep the source LF. */
  gitattributes?: readonly string[]
  /** More declarations under the SDK directory, rewritten every time like `core.d.ts`. */
  sdk?: ReadonlyArray<readonly [string, string]>
  /** More examples beside the cookbook, rewritten every time like it. */
  examples?: ReadonlyArray<readonly [string, string]>
}

/**
 * Everything beside the printed source that makes a directory editable: the agent guide and the
 * cookbook example (both rewritten every time and never in `.sim/written.json`), the declarations
 * (regenerated only when the catalog or generator changed), `workspace.d.ts`, the CLI's
 * `tsconfig.json` and the LF lines.
 */
export async function sourceTreeChange(
  dir: string,
  catalog: BlockCatalog,
  workspaceTypes: string | null,
  profile: SourceTreeProfile
): Promise<{ change: SourceDirChange; ownsTsconfig: boolean }> {
  const write: Array<readonly [string, string]> = [
    [SOURCE_AGENTS_FILE, profile.agents],
    [SOURCE_COOKBOOK_FILE, COOKBOOK_TS],
    ...(profile.examples ?? []),
    [`${SDK_DIR}/core.d.ts`, CORE_DTS],
    ...(profile.sdk ?? []),
  ]
  const remove: string[] = []
  const [gitattributes, index, tsconfig] = await Promise.all([
    readSourceText(dir, SOURCE_GITATTRIBUTES_FILE),
    readSourceText(dir, SDK_INDEX_FILE),
    readSourceText(dir, TSCONFIG_FILE),
  ])
  const ownsTsconfig = tsconfig === null || tsconfig.startsWith(TSCONFIG_MARKER)
  if (ownsTsconfig) write.push([TSCONFIG_FILE, profile.tsconfig])
  const mergedAttributes = mergedGitattributes(gitattributes, profile.gitattributes)
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
