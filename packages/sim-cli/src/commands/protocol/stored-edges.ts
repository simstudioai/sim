import { isRecordLike, toRecord } from '@sim/utils/object'
import {
  type BlockCatalog,
  type CanonicalBlock,
  compileWorkflow,
  parseWorkflowLock,
  type StoredEdgeRef,
  setOwn,
  stableStringify,
} from '@sim/workflow-code'
import { SOURCE_BASE_FILE, SOURCE_ENTRY_FILE, SOURCE_LOCK_FILE } from '@sim/workflow-code/limits'
import { KIND_DIRS } from '@sim/workspace-code'
import type { OperationClient } from '../../runtime/called-operations'
import { digest, readSourceJson, SOURCE_STORED_EDGES_FILE } from './source-dir'
import { cachedCatalogByHash, loadWorkflowCatalog } from './source-tree'

/** A printed source as a get, apply or create answers it. */
interface PrintedAnswer {
  files: Record<string, string>
  lock: unknown
  base: unknown
}

/** A digest of one compiled block, to tell a block an edit changed from one it left alone. */
export function blockDigest(block: CanonicalBlock): string {
  return digest(stableStringify(block))
}

/**
 * The `.sim/stored-edges.json` write for a printed source: its edges and a digest of each block
 * ({@link blockDigest}, by key), compiled against `catalog` (the one it was printed with), tagged
 * with its base fingerprint. `null` when the answer has no fingerprint or entry, or nothing to
 * compile it with; the record left on disk then names an older fingerprint, which a check ignores.
 */
export function storedEdgesWrite(
  answer: PrintedAnswer,
  catalog: BlockCatalog | null,
  folder = ''
): readonly [string, string] | null {
  const { fingerprint } = toRecord(answer.base)
  const entry = answer.files[SOURCE_ENTRY_FILE]
  const { lock } = parseWorkflowLock(answer.lock)
  if (!catalog || typeof fingerprint !== 'string' || entry === undefined || !lock) return null
  const { edges, workflow } = compileWorkflow({
    entry: { path: SOURCE_ENTRY_FILE, text: entry },
    files: new Map(Object.entries(answer.files).filter(([path]) => path !== SOURCE_ENTRY_FILE)),
    catalog,
    sdkMajor: catalog.sdkMajor,
    knownKeys: new Set(Object.keys(lock.blocks)),
    storedUnread: lock,
  })
  return [
    `${folder}${SOURCE_STORED_EDGES_FILE}`,
    `${JSON.stringify(
      {
        version: 1,
        fingerprint,
        edges,
        ...(workflow
          ? {
              blocks: Object.fromEntries(
                Object.entries(workflow.blocks).map(([key, block]) => [key, blockDigest(block)])
              ),
            }
          : {}),
      },
      null,
      2
    )}\n`,
  ]
}

/** The workflow folders a workspace answer's files hold, by key, each as a printed source. */
function printedWorkflowFolders(files: Record<string, string>): Map<string, PrintedAnswer> {
  const folders = new Map<string, PrintedAnswer>()
  const prefix = `${KIND_DIRS.workflow}/`
  for (const [path, text] of Object.entries(files)) {
    if (!path.startsWith(prefix)) continue
    const slash = path.indexOf('/', prefix.length)
    if (slash < 0) continue
    const key = path.slice(prefix.length, slash)
    const relative = path.slice(slash + 1)
    const folder = folders.get(key) ?? { files: {}, lock: undefined, base: undefined }
    if (relative === SOURCE_LOCK_FILE) folder.lock = parseJson(text)
    else if (relative === SOURCE_BASE_FILE) folder.base = parseJson(text)
    else setOwn(folder.files, relative, text)
    folders.set(key, folder)
  }
  return folders
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** The stored-edges records of a workspace answer, and the folders left without one. */
export interface WorkflowFolderRecords {
  records: Array<readonly [string, string]>
  /** Folder keys whose catalog could not be fetched: their record is skipped, not failed. */
  unrecorded: string[]
}

/**
 * The `.sim/stored-edges.json` write of each workflow folder a workspace get or apply answered
 * with, each compiled against the catalog its base names. A workflow holding a type the workspace
 * catalog lacks was printed with its own catalog: one not cached yet is fetched, once per distinct
 * hash, and cached, so an offline check compiles that folder against it too. The records are a
 * cache fill, never part of the write: a catalog fetch that fails skips the folders printed with
 * that catalog (named in `unrecorded`) rather than failing a write the server already committed.
 */
export async function workflowFolderRecords(
  client: OperationClient<'getSourceCatalog'>,
  workspaceId: string,
  workspaceCatalog: BlockCatalog,
  files: Record<string, string>
): Promise<WorkflowFolderRecords> {
  const folders = printedWorkflowFolders(files)
  const uncached = new Map<string, string>()
  for (const { base } of folders.values()) {
    const { workflowId, catalogHash } = toRecord(base)
    if (typeof workflowId !== 'string' || typeof catalogHash !== 'string') continue
    if (catalogHash === workspaceCatalog.hash || cachedCatalogByHash(catalogHash)) continue
    if (!uncached.has(catalogHash)) uncached.set(catalogHash, workflowId)
  }
  const fetched = new Map<string, BlockCatalog>()
  for (const [catalogHash, workflowId] of uncached) {
    const catalog = await loadWorkflowCatalog(client, workspaceId, workflowId).catch(() => null)
    if (catalog) fetched.set(catalogHash, catalog)
  }
  const records: Array<readonly [string, string]> = []
  const unrecorded: string[] = []
  for (const [key, folder] of folders) {
    const { catalogHash } = toRecord(folder.base)
    const catalog =
      catalogHash === workspaceCatalog.hash
        ? workspaceCatalog
        : typeof catalogHash === 'string'
          ? (fetched.get(catalogHash) ?? cachedCatalogByHash(catalogHash))
          : null
    if (typeof catalogHash === 'string' && uncached.has(catalogHash) && !catalog) {
      unrecorded.push(key)
      continue
    }
    const write = storedEdgesWrite(folder, catalog, `${KIND_DIRS.workflow}/${key}/`)
    if (write) records.push(write)
  }
  return { records, unrecorded }
}

/**
 * The warning for workflow folders {@link workflowFolderRecords} could not record, or `null`.
 * Their edges are unrecorded, so an offline check of each one compiles without its stored edges
 * until the next get records them.
 */
export function unrecordedFoldersWarning(unrecorded: readonly string[]): string | null {
  if (unrecorded.length === 0) return null
  return `Warning: could not fetch the block catalog of ${unrecorded.map((key) => `${KIND_DIRS.workflow}/${key}`).join(', ')}, so its stored edges are not recorded; everything else was saved. The next \`sim workspaces source get\` records them.`
}

function isStoredEdge(value: unknown): value is StoredEdgeRef {
  return (
    isRecordLike(value) &&
    typeof value.from === 'string' &&
    typeof value.port === 'string' &&
    typeof value.to === 'string'
  )
}

/**
 * The stored edges recorded for the base `dir` holds now, or `undefined` when none are: no
 * record, one an older CLI or another base wrote, or a malformed one.
 */
export async function readStoredEdges(dir: string): Promise<StoredEdgeRef[] | undefined> {
  const [record, base] = await Promise.all([
    readSourceJson(dir, SOURCE_STORED_EDGES_FILE),
    readSourceJson(dir, SOURCE_BASE_FILE),
  ])
  const { version, fingerprint, edges } = toRecord(record)
  if (
    version !== 1 ||
    typeof fingerprint !== 'string' ||
    fingerprint !== toRecord(base).fingerprint ||
    !Array.isArray(edges) ||
    !edges.every(isStoredEdge)
  ) {
    return undefined
  }
  return edges
}

/**
 * The digest of each block of the printed source the record of the base `dir` holds now was
 * written from, by key (see {@link storedEdgesWrite}); `undefined` when there is no such record or
 * it records no blocks (an older CLI wrote it).
 */
export async function readStoredBlockDigests(
  dir: string
): Promise<ReadonlyMap<string, string> | undefined> {
  const [record, base] = await Promise.all([
    readSourceJson(dir, SOURCE_STORED_EDGES_FILE),
    readSourceJson(dir, SOURCE_BASE_FILE),
  ])
  const { version, fingerprint, blocks } = toRecord(record)
  if (
    version !== 1 ||
    typeof fingerprint !== 'string' ||
    fingerprint !== toRecord(base).fingerprint ||
    !isRecordLike(blocks)
  ) {
    return undefined
  }
  const digests = new Map<string, string>()
  for (const [key, value] of Object.entries(blocks)) {
    if (typeof value !== 'string') return undefined
    digests.set(key, value)
  }
  return digests
}

/** The stored-edges records of the workflow folders whose base a write removes (`paths`). */
export function removedWorkflowRecords(paths: Iterable<string>): string[] {
  return [...paths].flatMap((path) =>
    path.startsWith(`${KIND_DIRS.workflow}/`) && path.endsWith(`/${SOURCE_BASE_FILE}`)
      ? [`${path.slice(0, -SOURCE_BASE_FILE.length)}${SOURCE_STORED_EDGES_FILE}`]
      : []
  )
}
