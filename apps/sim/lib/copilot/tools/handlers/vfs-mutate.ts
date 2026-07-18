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
import { isWorkflowAliasBackingPath } from '@/lib/copilot/vfs/workflow-aliases'
import { generateRequestId } from '@/lib/core/utils/request'
import { getKnowledgeBases, updateKnowledgeBase } from '@/lib/knowledge/service'
import { listTables, renameTable } from '@/lib/table/service'
import {
  ensureWorkspaceFileFolderPath,
  findWorkspaceFileFolderIdByPath,
  normalizeWorkspaceFileItemName,
} from '@/lib/uploads/contexts/workspace/workspace-file-folder-manager'
import {
  getWorkspaceFileByName,
  type WorkspaceFileRecord,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import {
  performCreateFolder,
  performUpdateFolder,
  performUpdateWorkflow,
} from '@/lib/workflows/orchestration'
import { duplicateWorkflow } from '@/lib/workflows/persistence/duplicate'
import { listFolders, verifyFolderWorkspace } from '@/lib/workflows/utils'
import {
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

interface VfsMutateOutcome {
  from: string
  to?: string
  kind: 'file' | 'file_folder' | 'workflow' | 'workflow_folder' | 'table' | 'knowledge_base'
  id?: string
  error?: string
}

function topLevelSegment(path: string): string {
  return path.trim().replace(/^\/+/, '').split('/')[0] ?? ''
}

function classifyCategory(path: string): { category: MutateCategory } | { error: string } {
  const top = topLevelSegment(path)
  if (MUTATE_CATEGORIES.has(top)) return { category: top as MutateCategory }
  const rejection = CATEGORY_REJECTIONS[top]
  if (rejection) return { error: rejection }
  return {
    error: `"${path}" is not a movable resource. Only files/, workflows/, tables/, and knowledgebases/ paths are supported.`,
  }
}

function normalizeSources(raw: unknown): string[] {
  if (typeof raw === 'string') return raw.trim() ? [raw.trim()] : []
  if (!Array.isArray(raw)) return []
  return raw.filter(
    (source): source is string => typeof source === 'string' && source.trim().length > 0
  )
}

function hasTrailingSlash(path: string): boolean {
  return /\/\s*$/.test(path)
}

function assertMutationNotAborted(context: ExecutionContext): void {
  if (context.abortSignal?.aborted) {
    throw new Error('Request aborted before the mutation could be applied.')
  }
}

function buildResult(verb: MutateVerb | 'mkdir', outcomes: VfsMutateOutcome[]): ToolCallResult {
  const failed = outcomes.filter((outcome) => outcome.error)
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
      if (top === 'files' && isWorkflowAliasBackingPath(path)) {
        outcomes.push({ from: path, kind, error: `Reserved system path: ${path}` })
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

    if (topLevelSegment(destination) !== category) {
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
  dirMode: boolean
  folderSegments: string[]
  leafName?: string
  ensureFolderId: () => Promise<string | null>
}

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
  for (const path of [...sources, destination]) {
    if (isWorkflowAliasBackingPath(path)) {
      return {
        success: false,
        error: `Reserved system paths cannot be moved or renamed: ${path}`,
      }
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
      const result = await performMoveRenameWorkspaceFile({
        workspaceId,
        userId: context.userId,
        fileId: ref.file.id,
        targetFolderId: await dest.ensureFolderId(),
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

async function mutateWorkflows(
  verb: MutateVerb,
  sources: string[],
  destination: string,
  context: ExecutionContext,
  workspaceId: string
): Promise<ToolCallResult> {
  const index = await loadWorkflowFolderIndex(workspaceId)
  const { folderPathById, folderIdByPath } = index

  const workflowRows = await db
    .select({
      id: workflowTable.id,
      name: workflowTable.name,
      folderId: workflowTable.folderId,
    })
    .from(workflowTable)
    .where(eq(workflowTable.workspaceId, workspaceId))
  const workflowByPath = new Map<string, (typeof workflowRows)[number]>()
  for (const row of workflowRows) {
    const dir = canonicalWorkflowVfsDir({
      name: row.name,
      folderPath: row.folderId ? folderPathById.get(row.folderId) : null,
    })
    if (!workflowByPath.has(dir)) workflowByPath.set(dir, row)
  }

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

  type SourceRef =
    | { source: string; workflow: (typeof workflowRows)[number] }
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
    const workflow = workflowByPath.get(`workflows/${encoded}`)
    if (workflow) {
      refs.push({ source, workflow })
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
      const workflow = ref.workflow
      const targetName = dest.dirMode ? workflow.name : (dest.leafName as string)
      try {
        assertMutationNotAborted(context)
        if (verb === 'cp') {
          const duplicated = await duplicateWorkflow({
            sourceWorkflowId: workflow.id,
            userId: context.userId,
            workspaceId,
            folderId: await dest.ensureFolderId(),
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
          await ensureWorkflowAccess(workflow.id, context.userId, 'write')
          await assertWorkflowMutable(workflow.id)
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
            workflowId: workflow.id,
            userId: context.userId,
            workspaceId,
            currentName: workflow.name,
            currentFolderId: workflow.folderId,
            name: dest.dirMode ? undefined : targetName,
            folderId: targetFolderId,
          })
          outcomes.push(
            result.success
              ? {
                  from: ref.source,
                  to: `workflows/${encodeVfsPathSegments([...dest.folderSegments, targetName])}`,
                  kind: 'workflow',
                  id: workflow.id,
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
    const match = tables.find((table) => normalizeVfsSegment(table.name) === canonicalSource)
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
  const knowledgeBases = await getKnowledgeBases(context.userId, workspaceId)
  const match = knowledgeBases.find(
    (knowledgeBase) => normalizeVfsSegment(knowledgeBase.name) === canonicalSource
  )
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
