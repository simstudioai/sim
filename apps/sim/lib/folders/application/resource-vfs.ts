import type { FolderResourceType } from '@/lib/api/contracts/folders'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  createFolderAtPath,
  deleteFolderByPath,
  relocateFolderByPath,
} from '@/lib/folders/orchestration'
import { buildFolderPath } from '@/lib/folders/paths'
import { listFoldersForWorkspace } from '@/lib/folders/queries'

/**
 * Shared VFS folder semantics for flat-row resources (tables, knowledge
 * bases): both are a single DB row with a `folderId`, so mkdir/mv/rm over
 * their `{root}/{...folders}/{name}` paths is identical logic parameterized
 * by how rows are listed, moved, and renamed. Folder mutations delegate to
 * `lib/folders/orchestration`, which owns naming invariants, tree locks, and
 * delete cascades — this module only resolves paths and moves rows.
 *
 * Authorization is deliberately NOT here: every entry point is called from a
 * per-resource authorized use case (table-vfs / knowledge-vfs), the same
 * layering workflow-vfs uses.
 */
export interface FolderedResourceRow {
  id: string
  name: string
  folderId: string | null
}

export interface FolderedResourceAdapter {
  resourceType: Extract<FolderResourceType, 'table' | 'knowledge_base'>
  rootSegment: 'tables' | 'knowledgebases'
  /** Human label for error messages, e.g. "table" / "knowledge base". */
  label: string
  listRows(workspaceId: string): Promise<FolderedResourceRow[]>
  moveRow(row: FolderedResourceRow, folderId: string | null, workspaceId: string): Promise<void>
  renameRow(
    row: FolderedResourceRow,
    newName: string,
    workspaceId: string
  ): Promise<{ id: string; name: string }>
}

export interface ResourceVfsOutcome {
  source: string
  /** Path segments under the resource root the item landed at (folders + leaf). */
  targetSegments?: string[]
  kind: 'resource' | 'folder'
  resourceId?: string
  error?: string
}

interface FolderNode {
  id: string
  name: string
  parentId: string | null
}

interface FolderIndex {
  byId: Map<string, FolderNode>
  /** parentKey(parentId) + "\u0000" + name → folderId */
  byParentAndName: Map<string, string>
}

const ROOT_PARENT_KEY = ''

function parentKey(parentId: string | null): string {
  return parentId ?? ROOT_PARENT_KEY
}

function childKey(parentId: string | null, name: string): string {
  return `${parentKey(parentId)}\u0000${name}`
}

async function loadFolderIndex(
  workspaceId: string,
  resourceType: FolderResourceType
): Promise<FolderIndex> {
  const folders = await listFoldersForWorkspace(workspaceId, 'active', resourceType)
  const byId = new Map<string, FolderNode>()
  const byParentAndName = new Map<string, string>()
  for (const folder of folders) {
    byId.set(folder.id, { id: folder.id, name: folder.name, parentId: folder.parentId })
    byParentAndName.set(childKey(folder.parentId, folder.name), folder.id)
  }
  return { byId, byParentAndName }
}

function folderSegments(index: FolderIndex, folderId: string | null): string[] {
  const segments: string[] = []
  let current = folderId
  const visited = new Set<string>()
  while (current && !visited.has(current)) {
    visited.add(current)
    const node = index.byId.get(current)
    if (!node) break
    segments.unshift(node.name)
    current = node.parentId
  }
  return segments
}

/** Resolves an existing folder path to its id; null = root; undefined = missing. */
function resolveFolderId(
  index: FolderIndex,
  segments: readonly string[]
): string | null | undefined {
  let current: string | null = null
  for (const segment of segments) {
    const next = index.byParentAndName.get(childKey(current, segment))
    if (!next) return undefined
    current = next
  }
  return current
}

/**
 * mkdir -p: creates every missing folder along each path. Ancestors created by
 * an earlier path in the same batch are found via the reloaded index.
 */
export async function createResourceVfsFolders(
  adapter: FolderedResourceAdapter,
  params: {
    workspaceId: string
    userId: string
    paths: Array<{ source: string; segments: string[] }>
  }
): Promise<ResourceVfsOutcome[]> {
  let index = await loadFolderIndex(params.workspaceId, adapter.resourceType)
  const outcomes: ResourceVfsOutcome[] = []
  for (const { source, segments } of params.paths) {
    if (segments.length === 0) {
      outcomes.push({
        source,
        kind: 'folder',
        error: 'Path must include at least one folder segment',
      })
      continue
    }
    try {
      const folderId = await ensureFolderPath(
        adapter,
        params.workspaceId,
        params.userId,
        index,
        segments
      )
      index = await loadFolderIndex(params.workspaceId, adapter.resourceType)
      outcomes.push({
        source,
        kind: 'folder',
        resourceId: folderId ?? undefined,
        targetSegments: [...segments],
      })
    } catch (error) {
      outcomes.push({
        source,
        kind: 'folder',
        error: messageFor(error, `${adapter.label} folder creation failed`),
      })
    }
  }
  return outcomes
}

async function ensureFolderPath(
  adapter: FolderedResourceAdapter,
  workspaceId: string,
  userId: string,
  index: FolderIndex,
  segments: readonly string[]
): Promise<string | null> {
  let folderId: string | null = null
  for (let position = 0; position < segments.length; position += 1) {
    const existing = resolveFolderId(index, segments.slice(0, position + 1))
    if (existing !== undefined) {
      folderId = existing
      continue
    }
    const result = await createFolderAtPath({
      resourceType: adapter.resourceType,
      workspaceId,
      userId,
      path: buildFolderPath(segments.slice(0, position + 1)),
      effects: false,
      throwInfrastructure: true,
    })
    if (!result.success || !result.folder) {
      if (result.errorCode === 'conflict') {
        index = await loadFolderIndex(workspaceId, adapter.resourceType)
        const concurrent = resolveFolderId(index, segments.slice(0, position + 1))
        if (concurrent !== undefined) {
          folderId = concurrent
          continue
        }
      }
      throw new OrchestrationError(
        result.errorCode === 'forbidden' ? 'forbidden' : 'validation',
        result.error ?? `${adapter.label} folder creation failed`
      )
    }
    folderId = result.folder.id
    index.byId.set(folderId, {
      id: folderId,
      name: result.folder.name,
      parentId: result.folder.parentId,
    })
    index.byParentAndName.set(childKey(result.folder.parentId, result.folder.name), folderId)
  }
  return folderId
}

type ResolvedSource =
  | { kind: 'resource'; row: FolderedResourceRow }
  | { kind: 'folder'; folderId: string }

/**
 * Resolves one source path: the leaf is preferred as a resource row inside the
 * resolved parent folder; a folder of that name is the fallback. A bare leaf
 * (no folder segments) also matches a uniquely-named resource anywhere in the
 * tree, so pre-folders paths keep working after rows move into folders.
 */
function resolveSource(
  adapter: FolderedResourceAdapter,
  index: FolderIndex,
  rows: FolderedResourceRow[],
  segments: readonly string[]
): ResolvedSource {
  const root = adapter.rootSegment
  if (segments.length === 0) {
    throw new OrchestrationError(
      'validation',
      `Path must name a ${adapter.label} or folder under ${root}/`
    )
  }
  const leaf = segments[segments.length - 1]
  const parentSegments = segments.slice(0, -1)
  const parentId = resolveFolderId(index, parentSegments)
  if (parentId !== undefined) {
    const inParent = rows.filter((row) => row.name === leaf && row.folderId === (parentId ?? null))
    if (inParent.length === 1) return { kind: 'resource', row: inParent[0] }
    const asFolder = resolveFolderId(index, segments)
    if (asFolder !== undefined && asFolder !== null) return { kind: 'folder', folderId: asFolder }
  }
  if (parentSegments.length === 0) {
    const anywhere = rows.filter((row) => row.name === leaf)
    if (anywhere.length === 1) return { kind: 'resource', row: anywhere[0] }
    if (anywhere.length > 1) {
      throw new OrchestrationError(
        'conflict',
        `${root}/${leaf} is ambiguous — several ${adapter.label}s share that name. Use the full folder path.`
      )
    }
  }
  throw new OrchestrationError(
    'not_found',
    `No ${adapter.label} or folder found at ${root}/${segments.join('/')}`
  )
}

/**
 * mv: with a trailing-slash destination, moves every source (resource rows and
 * whole folders) into that folder path, creating it as needed. Without one,
 * exactly one source is renamed and/or moved to the destination's parent +
 * leaf name. Mirrors the workflows/ contract.
 */
export async function transferResourceVfsItems(
  adapter: FolderedResourceAdapter,
  params: {
    workspaceId: string
    userId: string
    sources: Array<{ source: string; segments: string[] }>
    destination: { segments: string[]; trailingSlash: boolean }
  }
): Promise<ResourceVfsOutcome[]> {
  const { workspaceId, userId } = params
  let index = await loadFolderIndex(workspaceId, adapter.resourceType)
  let rows = await adapter.listRows(workspaceId)
  const outcomes: ResourceVfsOutcome[] = []

  const moveIntoFolder = params.destination.trailingSlash
  if (!moveIntoFolder && params.sources.length > 1) {
    throw new OrchestrationError(
      'validation',
      `A rename destination takes exactly one source; to move several items, end the destination with "/" (a folder path).`
    )
  }

  const destFolderSegments = moveIntoFolder
    ? params.destination.segments
    : params.destination.segments.slice(0, -1)
  const renameTo = moveIntoFolder
    ? null
    : params.destination.segments[params.destination.segments.length - 1]
  if (!moveIntoFolder && !renameTo) {
    throw new OrchestrationError('validation', 'destination must include a name')
  }

  for (const { source, segments } of params.sources) {
    try {
      const resolved = resolveSource(adapter, index, rows, segments)
      if (resolved.kind === 'resource') {
        const targetFolderId = await ensureFolderPath(
          adapter,
          workspaceId,
          userId,
          index,
          destFolderSegments
        )
        let row = resolved.row
        if (row.folderId !== (targetFolderId ?? null)) {
          await adapter.moveRow(row, targetFolderId ?? null, workspaceId)
          row = { ...row, folderId: targetFolderId ?? null }
        }
        let finalName = row.name
        if (renameTo && renameTo !== row.name) {
          const renamed = await adapter.renameRow(row, renameTo, workspaceId)
          finalName = renamed.name
        }
        rows = rows.map((r) => (r.id === row.id ? { ...row, name: finalName } : r))
        outcomes.push({
          source,
          kind: 'resource',
          resourceId: row.id,
          targetSegments: [...destFolderSegments, finalName],
        })
        continue
      }

      const sourcePath = buildFolderPath(folderSegments(index, resolved.folderId))
      const destinationPath = buildFolderPath(
        moveIntoFolder
          ? [...destFolderSegments, ...folderSegments(index, resolved.folderId).slice(-1)]
          : [...destFolderSegments, renameTo as string]
      )
      const result = await relocateFolderByPath({
        resourceType: adapter.resourceType,
        workspaceId,
        userId,
        path: sourcePath,
        destinationPath,
        effects: false,
        throwInfrastructure: true,
      })
      if (!result.success || !result.folder) {
        throw new OrchestrationError(
          result.errorCode === 'forbidden' ? 'forbidden' : 'validation',
          result.error ?? `${adapter.label} folder move failed`
        )
      }
      index = await loadFolderIndex(workspaceId, adapter.resourceType)
      rows = await adapter.listRows(workspaceId)
      outcomes.push({
        source,
        kind: 'folder',
        resourceId: result.folder.id,
        targetSegments: [...folderSegments(index, result.folder.id)],
      })
    } catch (error) {
      outcomes.push({
        source,
        kind: 'resource',
        error: messageFor(error, `${adapter.label} move failed`),
      })
    }
  }
  return outcomes
}

/** rm of folder paths: recursive delete through the shared cascade. */
export async function deleteResourceVfsFolders(
  adapter: FolderedResourceAdapter,
  params: {
    workspaceId: string
    userId: string
    paths: Array<{ source: string; segments: string[] }>
  }
): Promise<ResourceVfsOutcome[]> {
  const outcomes: ResourceVfsOutcome[] = []
  for (const { source, segments } of params.paths) {
    try {
      const index = await loadFolderIndex(params.workspaceId, adapter.resourceType)
      const folderId = resolveFolderId(index, segments)
      if (folderId === undefined || folderId === null) {
        throw new OrchestrationError(
          'not_found',
          `No ${adapter.label} folder found at ${adapter.rootSegment}/${segments.join('/')}`
        )
      }
      const result = await deleteFolderByPath({
        resourceType: adapter.resourceType,
        workspaceId: params.workspaceId,
        userId: params.userId,
        path: buildFolderPath(segments),
        recursive: true,
        effects: false,
        throwInfrastructure: true,
      })
      if (!result.success) {
        throw new OrchestrationError(
          result.errorCode === 'forbidden' ? 'forbidden' : 'validation',
          result.error ?? `${adapter.label} folder deletion failed`
        )
      }
      outcomes.push({ source, kind: 'folder', resourceId: folderId })
    } catch (error) {
      outcomes.push({
        source,
        kind: 'folder',
        error: messageFor(error, `${adapter.label} folder deletion failed`),
      })
    }
  }
  return outcomes
}

/** Resolves a resource (never a folder) for the segments-aware rename/delete paths. */
export async function resolveResourceRowBySegments(
  adapter: FolderedResourceAdapter,
  workspaceId: string,
  segments: readonly string[]
): Promise<FolderedResourceRow> {
  const index = await loadFolderIndex(workspaceId, adapter.resourceType)
  const rows = await adapter.listRows(workspaceId)
  const resolved = resolveSource(adapter, index, rows, segments)
  if (resolved.kind !== 'resource') {
    throw new OrchestrationError(
      'validation',
      `${adapter.rootSegment}/${segments.join('/')} is a folder; this operation takes a ${adapter.label}.`
    )
  }
  return resolved.row
}

function messageFor(error: unknown, fallback: string): string {
  if (error instanceof OrchestrationError) return error.message
  if (error instanceof Error && error.message) return error.message
  return fallback
}
