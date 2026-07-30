import { db, workflow as workflowTable } from '@sim/db'
import { createLogger } from '@sim/logger'
import { assertFolderMutable, assertWorkflowMutable } from '@sim/platform-authz/workflow'
import { toError } from '@sim/utils/errors'
import { eq } from 'drizzle-orm'
import type { ExecutionContext, ToolCallResult } from '@/lib/copilot/request/types'
import {
  ensureWorkflowAccess,
  ensureWorkspaceAccess,
  getDefaultWorkspaceId,
} from '@/lib/copilot/tools/handlers/access'
import { normalizeVfsSegment } from '@/lib/copilot/vfs/normalize-segment'
import {
  buildVfsFolderPathMap,
  canonicalWorkflowVfsDir,
  decodeVfsPathSegments,
  encodeVfsPathSegments,
} from '@/lib/copilot/vfs/path-utils'
import { generateRequestId } from '@/lib/core/utils/request'
import {
  deleteKnowledgeBase,
  getKnowledgeBases,
  updateKnowledgeBase,
} from '@/lib/knowledge/service'
import { deleteTable, listTables, renameTable } from '@/lib/table/service'
import {
  ensureWorkspaceFileFolderPath,
  findWorkspaceFileFolderIdByPath,
  normalizeWorkspaceFileItemName,
} from '@/lib/uploads/contexts/workspace/workspace-file-folder-manager'
import {
  getWorkspaceFileByName,
  resolveWorkspaceFileReference,
  type WorkspaceFileRecord,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import {
  performCreateFolder,
  performDeleteFolder,
  performDeleteWorkflow,
  performUpdateFolder,
  performUpdateWorkflow,
} from '@/lib/workflows/orchestration'
import { duplicateWorkflow } from '@/lib/workflows/persistence/duplicate'
import { listFolders, verifyFolderWorkspace } from '@/lib/workflows/utils'
import {
  performDeleteWorkspaceFileItems,
  performMoveRenameWorkspaceFile,
  performUpdateWorkspaceFileFolder,
} from '@/lib/workspace-files/orchestration'
import { checkKnowledgeBaseWriteAccess } from '@/app/api/knowledge/utils'

const logger = createLogger('VfsMutateTools')

type MutateVerb = 'mv' | 'cp'

type MutateCategory = 'files' | 'workflows' | 'tables' | 'knowledgebases'

const MUTATE_CATEGORIES = new Set<string>(['files', 'workflows', 'tables', 'knowledgebases'])

const CATEGORY_REJECTIONS: Record<string, string> = {
  uploads:
    'uploads/ files are chat-scoped and immutable. Use materialize_file to promote one into files/ first.',
  'recently-deleted':
    'recently-deleted/ items cannot be moved or copied. Restore them with restore_resource first.',
}

/**
 * Same categories as CATEGORY_REJECTIONS, but the advice differs for a delete:
 * an upload needs no cleanup and a recently-deleted item is already gone.
 */
const RM_CATEGORY_REJECTIONS: Record<string, string> = {
  uploads:
    'uploads/ files are chat-scoped and disappear with the chat — there is nothing to delete.',
  'recently-deleted':
    'recently-deleted/ items are already deleted. Use restore_resource to bring one back.',
}

interface VfsMutateOutcome {
  from: string
  to?: string
  kind: 'file' | 'file_folder' | 'workflow' | 'workflow_folder' | 'table' | 'knowledge_base'
  id?: string
  error?: string
}

/** Top-level VFS segment of a raw (possibly encoded) path. */
function topLevelSegment(path: string): string {
  return path.trim().replace(/^\/+/, '').split('/')[0] ?? ''
}

function classifyCategory(
  path: string,
  rejections: Record<string, string> = CATEGORY_REJECTIONS,
  verbNoun = 'movable'
): { category: MutateCategory } | { error: string } {
  const top = topLevelSegment(path)
  if (MUTATE_CATEGORIES.has(top)) return { category: top as MutateCategory }
  const rejection = rejections[top]
  if (rejection) return { error: rejection }
  return {
    error: `"${path}" is not a ${verbNoun} resource. Only files/, workflows/, tables/, and knowledgebases/ paths are supported.`,
  }
}

function normalizeSources(raw: unknown): string[] {
  if (typeof raw === 'string') return raw.trim() ? [raw.trim()] : []
  if (!Array.isArray(raw)) return []
  return raw.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
}

function hasTrailingSlash(path: string): boolean {
  return /\/\s*$/.test(path)
}

function assertMutationNotAborted(context: ExecutionContext): void {
  if (context.abortSignal?.aborted) {
    throw new Error('Request aborted before the mutation could be applied.')
  }
}

function buildResult(
  verb: MutateVerb | 'mkdir' | 'rm',
  outcomes: VfsMutateOutcome[]
): ToolCallResult {
  const failed = outcomes.filter((o) => o.error)
  if (failed.length === outcomes.length) {
    return {
      success: false,
      error: failed[0]?.error || `${verb} failed`,
      output: { results: outcomes },
    }
  }
  return { success: true, output: { results: outcomes } }
}

export async function executeVfsMv(
  params: Record<string, unknown>,
  context: ExecutionContext
): Promise<ToolCallResult> {
  return executeVfsMutate('mv', params, context)
}

export async function executeVfsCp(
  params: Record<string, unknown>,
  context: ExecutionContext
): Promise<ToolCallResult> {
  return executeVfsMutate('cp', params, context)
}

/**
 * mkdir -p over the VFS: creates each folder path (missing parents included)
 * under files/ or workflows/. Existing folders are not an error.
 */
export async function executeVfsMkdir(
  params: Record<string, unknown>,
  context: ExecutionContext
): Promise<ToolCallResult> {
  try {
    const paths = normalizeSources(params.paths)
    if (paths.length === 0) {
      return { success: false, error: 'paths is required (an array of folder VFS paths)' }
    }

    const workspaceId = context.workspaceId || (await getDefaultWorkspaceId(context.userId))
    await ensureWorkspaceAccess(workspaceId, context.userId, 'write')
    assertMutationNotAborted(context)

    let ensureWorkflowFolder: ((segments: string[]) => Promise<string | null>) | undefined

    const outcomes: VfsMutateOutcome[] = []
    for (const path of paths) {
      const top = topLevelSegment(path)
      const segments = decodeVfsPathSegments(path).slice(1)
      const kind = top === 'workflows' ? 'workflow_folder' : 'file_folder'

      if (top !== 'files' && top !== 'workflows') {
        const rejection =
          top === 'tables' || top === 'knowledgebases'
            ? `${top}/ is a flat namespace with no folders.`
            : (CATEGORY_REJECTIONS[top] ??
              `"${path}" is not a folder target. mkdir supports files/ and workflows/ paths.`)
        outcomes.push({ from: path, kind, error: rejection })
        continue
      }
      if (segments.length === 0) {
        outcomes.push({ from: path, kind, error: 'Path must include at least one folder segment' })
        continue
      }
      try {
        assertMutationNotAborted(context)
        let folderId: string | null
        if (top === 'files') {
          folderId = await ensureWorkspaceFileFolderPath({
            workspaceId,
            userId: context.userId,
            pathSegments: segments,
          })
        } else {
          ensureWorkflowFolder ??= makeWorkflowFolderEnsurer(
            workspaceId,
            context.userId,
            await loadWorkflowFolderIndex(workspaceId)
          )
          folderId = await ensureWorkflowFolder(segments)
        }
        outcomes.push({
          from: path,
          to: `${top}/${encodeVfsPathSegments(segments)}`,
          kind,
          id: folderId ?? undefined,
        })
      } catch (error) {
        outcomes.push({ from: path, kind, error: toError(error).message })
      }
    }

    return buildResult('mkdir', outcomes)
  } catch (error) {
    return { success: false, error: toError(error).message }
  }
}

async function executeVfsMutate(
  verb: MutateVerb,
  params: Record<string, unknown>,
  context: ExecutionContext
): Promise<ToolCallResult> {
  try {
    const sources = normalizeSources(params.sources)
    const destination = typeof params.destination === 'string' ? params.destination.trim() : ''
    if (sources.length === 0) {
      return { success: false, error: 'sources is required (an array of canonical VFS paths)' }
    }
    if (!destination) {
      return { success: false, error: 'destination is required' }
    }

    const workspaceId = context.workspaceId || (await getDefaultWorkspaceId(context.userId))
    await ensureWorkspaceAccess(workspaceId, context.userId, 'write')
    assertMutationNotAborted(context)

    const classified = classifyCategory(sources[0])
    if ('error' in classified) return { success: false, error: classified.error }
    const { category } = classified

    for (const source of sources.slice(1)) {
      const other = classifyCategory(source)
      if ('error' in other) return { success: false, error: other.error }
      if (other.category !== category) {
        return {
          success: false,
          error: `All sources must share one category; got ${category}/ and ${other.category}/.`,
        }
      }
    }

    const destTop = topLevelSegment(destination)
    if (destTop !== category) {
      return {
        success: false,
        error: `Cannot ${verb} across categories: ${category}/ sources cannot target "${destination}". Resources stay within their category.`,
      }
    }

    switch (category) {
      case 'files':
        return await mutateWorkspaceFiles(verb, sources, destination, context, workspaceId)
      case 'workflows':
        return await mutateWorkflows(verb, sources, destination, context, workspaceId)
      default:
        return await renameFlatResource(verb, category, sources, destination, context, workspaceId)
    }
  } catch (error) {
    return { success: false, error: toError(error).message }
  }
}

interface DestinationPlan {
  /** True when sources move INTO the destination folder keeping their names. */
  dirMode: boolean
  /** Decoded display-name segments of the destination folder. */
  folderSegments: string[]
  /** New leaf name; set only when `dirMode` is false. */
  leafName?: string
  /**
   * Resolve the destination folder id, creating missing folders on first call.
   * Deferred and memoized so nothing is created until a source is confirmed
   * valid — a fully-failed mv/cp must not leave folders behind.
   */
  ensureFolderId: () => Promise<string | null>
}

/**
 * Shared destination interpretation for every category with folders: an
 * existing folder (or a trailing "/") means move/copy INTO it keeping names;
 * otherwise the last segment is the new name and the preceding segments are
 * the target folder. Folder creation is deferred to `ensureFolderId`.
 */
async function planDestination(args: {
  destination: string
  sourceCount: number
  lookupFolder: (segments: string[]) => Promise<string | null>
  ensureFolderPath: (segments: string[]) => Promise<string | null>
}): Promise<DestinationPlan | { error: string }> {
  const rest = decodeVfsPathSegments(args.destination).slice(1)
  const plan = (
    dirMode: boolean,
    folderSegments: string[],
    leafName?: string,
    knownFolderId?: string | null
  ): DestinationPlan => {
    let memo: Promise<string | null> | undefined
    return {
      dirMode,
      folderSegments,
      leafName,
      ensureFolderId: () =>
        (memo ??=
          knownFolderId !== undefined
            ? Promise.resolve(knownFolderId)
            : folderSegments.length > 0
              ? args.ensureFolderPath(folderSegments)
              : Promise.resolve(null)),
    }
  }

  if (rest.length === 0) return plan(true, [], undefined, null)
  if (hasTrailingSlash(args.destination)) return plan(true, rest)
  const existing = await args.lookupFolder(rest)
  if (existing) return plan(true, rest, undefined, existing)
  if (args.sourceCount > 1) {
    return {
      error: `With multiple sources the destination must be a folder. "${args.destination}" does not exist — end it with "/" to create it.`,
    }
  }
  return plan(false, rest.slice(0, -1), rest.at(-1) as string)
}

/**
 * Resolve a `files/...` source to the file at EXACTLY that path (folder-
 * anchored). Deliberately not the lenient read-side resolver — on a
 * destructive path a bare-name fallback could match a file in a different
 * folder than the one named.
 */
async function resolveFileAtExactPath(
  workspaceId: string,
  segments: string[]
): Promise<WorkspaceFileRecord | null> {
  const fileName = normalizeWorkspaceFileItemName(segments.at(-1) ?? '', 'File')
  if (segments.length === 1) {
    return getWorkspaceFileByName(workspaceId, fileName, { folderId: null })
  }
  const folderId = await findWorkspaceFileFolderIdByPath(workspaceId, segments.slice(0, -1))
  if (!folderId) return null
  return getWorkspaceFileByName(workspaceId, fileName, { folderId })
}

async function mutateWorkspaceFiles(
  verb: MutateVerb,
  sources: string[],
  destination: string,
  context: ExecutionContext,
  workspaceId: string
): Promise<ToolCallResult> {
  if (verb === 'cp') {
    return {
      success: false,
      error: 'Workspace files cannot be copied — cp only duplicates workflows.',
    }
  }
  const dest = await planDestination({
    destination,
    sourceCount: sources.length,
    lookupFolder: (segments) => findWorkspaceFileFolderIdByPath(workspaceId, segments),
    ensureFolderPath: (segments) =>
      ensureWorkspaceFileFolderPath({
        workspaceId,
        userId: context.userId,
        pathSegments: segments,
      }),
  })
  if ('error' in dest) return { success: false, error: dest.error }

  // Resolve every source read-only before mutating anything, so a fully
  // invalid call cannot create destination folders as a side effect.
  type SourceRef =
    | { source: string; file: WorkspaceFileRecord }
    | { source: string; folderId: string }
    | { source: string; error: string }
  const refs: SourceRef[] = []
  for (const source of sources) {
    const segments = decodeVfsPathSegments(source).slice(1)
    if (segments.length === 0) {
      refs.push({ source, error: 'Source must name a file or folder under files/' })
      continue
    }
    const file = await resolveFileAtExactPath(workspaceId, segments)
    if (file) {
      refs.push({ source, file })
      continue
    }
    const folderId = await findWorkspaceFileFolderIdByPath(workspaceId, segments)
    if (folderId) refs.push({ source, folderId })
    else refs.push({ source, error: `Not found: ${source}` })
  }

  const outcomes: VfsMutateOutcome[] = []
  for (const ref of refs) {
    if ('error' in ref) {
      outcomes.push({ from: ref.source, kind: 'file', error: ref.error })
      continue
    }

    if ('file' in ref) {
      assertMutationNotAborted(context)
      const targetName = dest.dirMode ? ref.file.name : (dest.leafName as string)
      const targetFolderId = await dest.ensureFolderId()
      const result = await performMoveRenameWorkspaceFile({
        workspaceId,
        userId: context.userId,
        fileId: ref.file.id,
        targetFolderId,
        newName: targetName,
      })
      outcomes.push(
        result.success && result.file
          ? {
              from: ref.source,
              to: `files/${encodeVfsPathSegments([...dest.folderSegments, result.file.name])}`,
              kind: 'file',
              id: ref.file.id,
            }
          : { from: ref.source, kind: 'file', error: result.error || 'Failed to move file' }
      )
      continue
    }

    assertMutationNotAborted(context)
    const targetFolderId = await dest.ensureFolderId()
    if (targetFolderId === ref.folderId) {
      outcomes.push({
        from: ref.source,
        kind: 'file_folder',
        error: 'Cannot move a folder into itself',
      })
      continue
    }
    const result = await performUpdateWorkspaceFileFolder({
      workspaceId,
      folderId: ref.folderId,
      userId: context.userId,
      name: dest.dirMode ? undefined : dest.leafName,
      parentId: targetFolderId,
    })
    outcomes.push(
      result.success && result.folder
        ? {
            from: ref.source,
            to: `files/${encodeVfsPathSegments([...dest.folderSegments, result.folder.name])}`,
            kind: 'file_folder',
            id: ref.folderId,
          }
        : { from: ref.source, kind: 'file_folder', error: result.error || 'Failed to move folder' }
    )
  }

  return buildResult(verb, outcomes)
}

interface WorkflowFolderIndex {
  folderPathById: Map<string, string>
  folderIdByPath: Map<string, string>
}

async function loadWorkflowFolderIndex(workspaceId: string): Promise<WorkflowFolderIndex> {
  const folderPathById = buildVfsFolderPathMap(await listFolders(workspaceId))
  const folderIdByPath = new Map<string, string>()
  for (const [id, path] of folderPathById.entries()) folderIdByPath.set(path, id)
  return { folderPathById, folderIdByPath }
}

/**
 * mkdir -p for workflow folders: resolves each segment against the index,
 * creating missing ones (locked parents rejected) and keeping the index maps
 * current so later paths in the same call see the new folders.
 */
function makeWorkflowFolderEnsurer(
  workspaceId: string,
  userId: string,
  index: WorkflowFolderIndex
): (segments: string[]) => Promise<string | null> {
  return async (segments) => {
    let parentId: string | null = null
    let pathSoFar = ''
    for (const segment of segments) {
      pathSoFar = pathSoFar
        ? `${pathSoFar}/${encodeVfsPathSegments([segment])}`
        : encodeVfsPathSegments([segment])
      const existing = index.folderIdByPath.get(pathSoFar)
      if (existing) {
        parentId = existing
        continue
      }
      await assertFolderMutable(parentId)
      const created = await performCreateFolder({
        workspaceId,
        userId,
        name: segment,
        parentId: parentId ?? undefined,
      })
      if (!created.success || !created.folder) {
        throw new Error(created.error || `Failed to create workflow folder "${segment}"`)
      }
      index.folderIdByPath.set(pathSoFar, created.folder.id)
      index.folderPathById.set(created.folder.id, pathSoFar)
      parentId = created.folder.id
    }
    return parentId
  }
}

interface WorkflowRow {
  id: string
  name: string
  folderId: string | null
}

/**
 * Every workflow in the workspace keyed by its canonical VFS directory, so a
 * path resolves without a query per path. Shared by mv/cp and rm, which ask the
 * same question of a workflows/ path: is this a workflow or a folder?
 */
async function loadWorkflowsByVfsPath(
  workspaceId: string,
  folderPathById: Map<string, string>
): Promise<Map<string, WorkflowRow>> {
  const rows = await db
    .select({ id: workflowTable.id, name: workflowTable.name, folderId: workflowTable.folderId })
    .from(workflowTable)
    .where(eq(workflowTable.workspaceId, workspaceId))
  const byPath = new Map<string, WorkflowRow>()
  for (const row of rows) {
    const dir = canonicalWorkflowVfsDir({
      name: row.name,
      folderPath: row.folderId ? folderPathById.get(row.folderId) : null,
    })
    if (!byPath.has(dir)) byPath.set(dir, row)
  }
  return byPath
}

async function mutateWorkflows(
  verb: MutateVerb,
  sources: string[],
  destination: string,
  context: ExecutionContext,
  workspaceId: string
): Promise<ToolCallResult> {
  const index = await loadWorkflowFolderIndex(workspaceId)
  const { folderPathById, folderIdByPath } = index

  const workflowByPath = await loadWorkflowsByVfsPath(workspaceId, folderPathById)

  const ensureWorkflowFolderPath = makeWorkflowFolderEnsurer(workspaceId, context.userId, index)

  const dest = await planDestination({
    destination,
    sourceCount: sources.length,
    lookupFolder: async (segments) => folderIdByPath.get(encodeVfsPathSegments(segments)) ?? null,
    ensureFolderPath: ensureWorkflowFolderPath,
  })
  if ('error' in dest) return { success: false, error: dest.error }
  if (!dest.dirMode && (dest.leafName as string).length > 200) {
    return { success: false, error: 'Workflow name must be 200 characters or less' }
  }

  // Resolve every source against the in-memory maps before mutating anything.
  type SourceRef =
    | { source: string; workflow: WorkflowRow }
    | { source: string; folderId: string }
    | { source: string; error: string }
  const refs: SourceRef[] = []
  for (const source of sources) {
    const segments = decodeVfsPathSegments(source).slice(1)
    if (segments.length === 0) {
      refs.push({ source, error: 'Source must name a workflow or folder under workflows/' })
      continue
    }
    const encoded = encodeVfsPathSegments(segments)
    const wf = workflowByPath.get(`workflows/${encoded}`)
    if (wf) {
      refs.push({ source, workflow: wf })
      continue
    }
    const folderId = folderIdByPath.get(encoded)
    if (folderId) refs.push({ source, folderId })
    else refs.push({ source, error: `Not found: ${source}` })
  }

  const outcomes: VfsMutateOutcome[] = []
  for (const ref of refs) {
    if ('error' in ref) {
      outcomes.push({ from: ref.source, kind: 'workflow', error: ref.error })
      continue
    }

    if ('workflow' in ref) {
      const wf = ref.workflow
      const targetName = dest.dirMode ? wf.name : (dest.leafName as string)
      try {
        assertMutationNotAborted(context)
        if (verb === 'cp') {
          const targetFolderId = await dest.ensureFolderId()
          const duplicated = await duplicateWorkflow({
            sourceWorkflowId: wf.id,
            userId: context.userId,
            workspaceId,
            folderId: targetFolderId,
            name: targetName,
            requestId: generateRequestId(),
          })
          outcomes.push({
            from: ref.source,
            to: `workflows/${encodeVfsPathSegments([...dest.folderSegments, duplicated.name])}`,
            kind: 'workflow',
            id: duplicated.id,
          })
        } else {
          await ensureWorkflowAccess(wf.id, context.userId, 'write')
          await assertWorkflowMutable(wf.id)
          const targetFolderId = await dest.ensureFolderId()
          await assertFolderMutable(targetFolderId)
          if (targetFolderId && !(await verifyFolderWorkspace(targetFolderId, workspaceId))) {
            outcomes.push({
              from: ref.source,
              kind: 'workflow',
              error: 'Destination folder not found',
            })
            continue
          }
          const result = await performUpdateWorkflow({
            workflowId: wf.id,
            userId: context.userId,
            workspaceId,
            currentName: wf.name,
            currentFolderId: wf.folderId,
            name: dest.dirMode ? undefined : targetName,
            folderId: targetFolderId,
          })
          outcomes.push(
            result.success
              ? {
                  from: ref.source,
                  to: `workflows/${encodeVfsPathSegments([...dest.folderSegments, targetName])}`,
                  kind: 'workflow',
                  id: wf.id,
                }
              : {
                  from: ref.source,
                  kind: 'workflow',
                  error: result.error || 'Failed to move workflow',
                }
          )
        }
      } catch (error) {
        outcomes.push({ from: ref.source, kind: 'workflow', error: toError(error).message })
      }
      continue
    }

    if (verb === 'cp') {
      outcomes.push({
        from: ref.source,
        kind: 'workflow_folder',
        error: 'Workflow folders cannot be copied.',
      })
      continue
    }
    try {
      assertMutationNotAborted(context)
      await assertFolderMutable(ref.folderId)
      const targetFolderId = await dest.ensureFolderId()
      if (targetFolderId === ref.folderId) {
        outcomes.push({
          from: ref.source,
          kind: 'workflow_folder',
          error: 'Cannot move a folder into itself',
        })
        continue
      }
      await assertFolderMutable(targetFolderId)
      const result = await performUpdateFolder({
        folderId: ref.folderId,
        workspaceId,
        userId: context.userId,
        name: dest.dirMode ? undefined : dest.leafName,
        parentId: targetFolderId,
      })
      const finalLeaf = dest.dirMode
        ? (decodeVfsPathSegments(ref.source).slice(1).at(-1) ?? '')
        : (dest.leafName as string)
      outcomes.push(
        result.success
          ? {
              from: ref.source,
              to: `workflows/${encodeVfsPathSegments([...dest.folderSegments, finalLeaf])}`,
              kind: 'workflow_folder',
              id: ref.folderId,
            }
          : {
              from: ref.source,
              kind: 'workflow_folder',
              error: result.error || 'Failed to move folder',
            }
      )
    } catch (error) {
      outcomes.push({ from: ref.source, kind: 'workflow_folder', error: toError(error).message })
    }
  }

  return buildResult(verb, outcomes)
}

async function renameFlatResource(
  verb: MutateVerb,
  category: 'tables' | 'knowledgebases',
  sources: string[],
  destination: string,
  context: ExecutionContext,
  workspaceId: string
): Promise<ToolCallResult> {
  const label = category === 'tables' ? 'Tables' : 'Knowledge bases'
  const kind = category === 'tables' ? 'table' : 'knowledge_base'

  if (verb === 'cp') {
    return { success: false, error: `${label} cannot be copied — duplication is not supported.` }
  }
  if (sources.length > 1) {
    return { success: false, error: `${label} are renamed one at a time.` }
  }

  const sourceSegments = decodeVfsPathSegments(sources[0]).slice(1)
  const destSegments = decodeVfsPathSegments(destination).slice(1)
  if (sourceSegments.length !== 1 || destSegments.length !== 1 || hasTrailingSlash(destination)) {
    return {
      success: false,
      error: `${label} have a flat namespace with no folders — mv only renames them, e.g. mv({sources: ["${category}/Old Name"], destination: "${category}/New Name"}).`,
    }
  }

  const sourceName = sourceSegments[0]
  const newName = destSegments[0]
  const canonicalSource = normalizeVfsSegment(sourceName)

  if (category === 'tables') {
    const tables = await listTables(workspaceId)
    const match = tables.find((t) => normalizeVfsSegment(t.name) === canonicalSource)
    if (!match) {
      return { success: false, error: `Table not found at ${sources[0]}` }
    }
    assertMutationNotAborted(context)
    const renamed = await renameTable(match.id, newName, generateRequestId())
    return buildResult(verb, [
      {
        from: sources[0],
        to: `tables/${normalizeVfsSegment(renamed.name)}`,
        kind,
        id: match.id,
      },
    ])
  }

  if (newName.toLowerCase() === 'connectors') {
    return { success: false, error: '"knowledgebases/connectors" is a reserved path.' }
  }
  const kbs = await getKnowledgeBases(context.userId, workspaceId)
  const match = kbs.find((kb) => normalizeVfsSegment(kb.name) === canonicalSource)
  if (!match) {
    return { success: false, error: `Knowledge base not found at ${sources[0]}` }
  }
  const access = await checkKnowledgeBaseWriteAccess(match.id, context.userId)
  if (!access.hasAccess) {
    return {
      success: false,
      error: `Write access required to rename knowledge base "${match.name}"`,
    }
  }
  assertMutationNotAborted(context)
  await updateKnowledgeBase(match.id, { name: newName }, generateRequestId())
  logger.info('Renamed knowledge base via mv', { knowledgeBaseId: match.id, workspaceId })
  return buildResult(verb, [
    { from: sources[0], to: `knowledgebases/${normalizeVfsSegment(newName)}`, kind, id: match.id },
  ])
}

/**
 * rm over the VFS: deletes the resource each path names. Every delete here is
 * SOFT — the resource lands in recently-deleted/ and restore_resource brings it
 * back — so this is the product's delete, not a purge.
 *
 * Scope is deliberately "things with a path". Removing something INSIDE a
 * resource (a table row, a KB document, a workflow block) is an edit to that
 * resource and stays with its owning tool.
 */
export async function executeVfsRm(
  params: Record<string, unknown>,
  context: ExecutionContext
): Promise<ToolCallResult> {
  try {
    const paths = normalizeSources(params.paths)
    if (paths.length === 0) {
      return { success: false, error: 'paths is required (an array of VFS paths to delete)' }
    }

    const workspaceId = context.workspaceId || (await getDefaultWorkspaceId(context.userId))
    await ensureWorkspaceAccess(workspaceId, context.userId, 'write')
    assertMutationNotAborted(context)

    // Loaded at most once, and only when a workflows/ path in this call needs it.
    let workflowIndex: Promise<WorkflowRemoveIndex> | undefined
    const getWorkflowIndex = () => (workflowIndex ??= loadWorkflowRemoveIndex(workspaceId))

    const outcomes: VfsMutateOutcome[] = []
    for (const path of paths) {
      const classified = classifyCategory(path, RM_CATEGORY_REJECTIONS, 'deletable')
      if ('error' in classified) {
        outcomes.push({ from: path, kind: defaultKindFor(path), error: classified.error })
        continue
      }
      try {
        assertMutationNotAborted(context)
        outcomes.push(
          await removeOne(classified.category, path, context, workspaceId, getWorkflowIndex)
        )
      } catch (error) {
        outcomes.push({ from: path, kind: defaultKindFor(path), error: toError(error).message })
      }
    }

    return buildResult('rm', outcomes)
  } catch (error) {
    return { success: false, error: toError(error).message }
  }
}

/** Best-effort kind for an outcome that failed before the resource was identified. */
function defaultKindFor(path: string): VfsMutateOutcome['kind'] {
  switch (topLevelSegment(path)) {
    case 'workflows':
      return 'workflow'
    case 'tables':
      return 'table'
    case 'knowledgebases':
      return 'knowledge_base'
    default:
      return 'file'
  }
}

function removeOne(
  category: MutateCategory,
  path: string,
  context: ExecutionContext,
  workspaceId: string,
  getWorkflowIndex: () => Promise<WorkflowRemoveIndex>
): Promise<VfsMutateOutcome> {
  switch (category) {
    case 'files':
      return removeWorkspaceFilePath(path, context, workspaceId)
    case 'workflows':
      return removeWorkflowPath(path, context, workspaceId, getWorkflowIndex)
    case 'tables':
      return removeTablePath(path, context, workspaceId)
    case 'knowledgebases':
      return removeKnowledgeBasePath(path, context, workspaceId)
  }
}

/**
 * A files/ path is either a leaf file or a folder, and the two cannot collide,
 * so resolving the file first and falling back to the folder is unambiguous.
 * Both go through performDeleteWorkspaceFileItems — deleting a folder archives
 * the files and subfolders inside it.
 */
async function removeWorkspaceFilePath(
  path: string,
  context: ExecutionContext,
  workspaceId: string
): Promise<VfsMutateOutcome> {
  const file = await resolveWorkspaceFileReference(workspaceId, path)
  if (file) {
    const result = await performDeleteWorkspaceFileItems({
      workspaceId,
      userId: context.userId,
      fileIds: [file.id],
    })
    if (!result.success) {
      return { from: path, kind: 'file', id: file.id, error: result.error || 'Failed to delete' }
    }
    logger.info('Deleted workspace file via rm', { fileId: file.id, workspaceId })
    return { from: path, kind: 'file', id: file.id }
  }

  const segments = decodeVfsPathSegments(path).slice(1)
  if (segments.length === 0) {
    return { from: path, kind: 'file', error: 'Path must name a file or folder under files/' }
  }
  const folderId = await findWorkspaceFileFolderIdByPath(workspaceId, segments)
  if (!folderId) return { from: path, kind: 'file', error: `Not found: ${path}` }

  const result = await performDeleteWorkspaceFileItems({
    workspaceId,
    userId: context.userId,
    folderIds: [folderId],
  })
  if (!result.success) {
    return {
      from: path,
      kind: 'file_folder',
      id: folderId,
      error: result.error || 'Failed to delete',
    }
  }
  logger.info('Deleted file folder via rm', { folderId, workspaceId })
  return { from: path, kind: 'file_folder', id: folderId }
}

interface WorkflowRemoveIndex {
  workflowByPath: Map<string, WorkflowRow>
  folderIdByPath: Map<string, string>
}

async function loadWorkflowRemoveIndex(workspaceId: string): Promise<WorkflowRemoveIndex> {
  const { folderPathById, folderIdByPath } = await loadWorkflowFolderIndex(workspaceId)
  return {
    workflowByPath: await loadWorkflowsByVfsPath(workspaceId, folderPathById),
    folderIdByPath,
  }
}

/**
 * Workflow first, then folder — the same resolution order mv uses. The lock
 * assertions are what make a locked workflow (or one inside a locked folder)
 * fail here rather than silently archiving.
 */
async function removeWorkflowPath(
  path: string,
  context: ExecutionContext,
  workspaceId: string,
  getWorkflowIndex: () => Promise<WorkflowRemoveIndex>
): Promise<VfsMutateOutcome> {
  const segments = decodeVfsPathSegments(path).slice(1)
  if (segments.length === 0) {
    return {
      from: path,
      kind: 'workflow',
      error: 'Path must name a workflow or folder under workflows/',
    }
  }
  const encoded = encodeVfsPathSegments(segments)
  const { workflowByPath, folderIdByPath } = await getWorkflowIndex()

  const workflow = workflowByPath.get(`workflows/${encoded}`)
  if (workflow) {
    await assertWorkflowMutable(workflow.id)
    const result = await performDeleteWorkflow({ workflowId: workflow.id, userId: context.userId })
    if (!result.success) {
      return {
        from: path,
        kind: 'workflow',
        id: workflow.id,
        error: result.error || 'Failed to delete workflow',
      }
    }
    logger.info('Deleted workflow via rm', { workflowId: workflow.id, workspaceId })
    return { from: path, kind: 'workflow', id: workflow.id }
  }

  const folderId = folderIdByPath.get(encoded)
  if (!folderId) return { from: path, kind: 'workflow', error: `Not found: ${path}` }

  await assertFolderMutable(folderId)
  const result = await performDeleteFolder({ folderId, workspaceId, userId: context.userId })
  if (!result.success) {
    return {
      from: path,
      kind: 'workflow_folder',
      id: folderId,
      error: result.error || 'Failed to delete folder',
    }
  }
  logger.info('Deleted workflow folder via rm', { folderId, workspaceId })
  return { from: path, kind: 'workflow_folder', id: folderId }
}

/** Resolves a flat tables/{name} or knowledgebases/{name} path to its single segment. */
function flatResourceName(path: string, category: 'tables' | 'knowledgebases'): string | null {
  const segments = decodeVfsPathSegments(path).slice(1)
  if (segments.length !== 1) return null
  return normalizeVfsSegment(segments[0])
}

async function removeTablePath(
  path: string,
  context: ExecutionContext,
  workspaceId: string
): Promise<VfsMutateOutcome> {
  const canonical = flatResourceName(path, 'tables')
  if (!canonical) {
    return {
      from: path,
      kind: 'table',
      error: 'tables/ is a flat namespace — rm takes a single name, e.g. rm(["tables/Leads"]).',
    }
  }
  const match = (await listTables(workspaceId)).find(
    (table) => normalizeVfsSegment(table.name) === canonical
  )
  if (!match) return { from: path, kind: 'table', error: `Table not found at ${path}` }

  await deleteTable(match.id, generateRequestId(), context.userId)
  logger.info('Archived table via rm', { tableId: match.id, workspaceId })
  return { from: path, kind: 'table', id: match.id }
}

async function removeKnowledgeBasePath(
  path: string,
  context: ExecutionContext,
  workspaceId: string
): Promise<VfsMutateOutcome> {
  const canonical = flatResourceName(path, 'knowledgebases')
  if (!canonical) {
    return {
      from: path,
      kind: 'knowledge_base',
      error:
        'knowledgebases/ is a flat namespace — rm takes a single name, e.g. rm(["knowledgebases/support-docs"]).',
    }
  }
  if (canonical === normalizeVfsSegment('connectors')) {
    return {
      from: path,
      kind: 'knowledge_base',
      error: '"knowledgebases/connectors" is a reserved path, not a knowledge base.',
    }
  }
  const match = (await getKnowledgeBases(context.userId, workspaceId)).find(
    (kb) => normalizeVfsSegment(kb.name) === canonical
  )
  if (!match)
    return { from: path, kind: 'knowledge_base', error: `Knowledge base not found at ${path}` }

  const access = await checkKnowledgeBaseWriteAccess(match.id, context.userId)
  if (!access.hasAccess) {
    return {
      from: path,
      kind: 'knowledge_base',
      id: match.id,
      error: `Write access required to delete knowledge base "${match.name}"`,
    }
  }

  await deleteKnowledgeBase(match.id, generateRequestId())
  logger.info('Deleted knowledge base via rm', { knowledgeBaseId: match.id, workspaceId })
  return { from: path, kind: 'knowledge_base', id: match.id }
}
