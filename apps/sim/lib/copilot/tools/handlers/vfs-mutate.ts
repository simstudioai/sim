import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import {
  executeCopilotFileUseCase,
  resolveCopilotWorkspaceFileReference,
} from '@/lib/copilot/application/execute-file-use-case'
import {
  executeCopilotKnowledgeUseCase,
  messageForCopilotKnowledgeError,
  resolveCopilotKnowledgePrincipal,
} from '@/lib/copilot/application/execute-knowledge-use-case'
import {
  executeCopilotWorkflowUseCase,
  messageForCopilotWorkflowError,
} from '@/lib/copilot/application/execute-workflow-use-case'
import { messageForCopilotFileError } from '@/lib/copilot/auth/file-delegation'
import type { ExecutionContext, ToolCallResult } from '@/lib/copilot/request/types'
import { ensureWorkspaceAccess } from '@/lib/copilot/tools/handlers/access'
import {
  ensureCopilotFileFolderPath,
  requireCopilotWorkspace,
} from '@/lib/copilot/tools/server/files/file-folder-application'
import { normalizeVfsSegment } from '@/lib/copilot/vfs/normalize-segment'
import { decodeVfsPathSegments, encodeVfsPathSegments } from '@/lib/copilot/vfs/path-utils'
import { asOrchestrationError } from '@/lib/core/orchestration/types'
import { PlatformEvents } from '@/lib/core/telemetry'
import { generateRequestId } from '@/lib/core/utils/request'
import {
  deleteKnowledgeBaseOperation,
  listKnowledgeBases,
  updateKnowledgeBaseOperation,
} from '@/lib/knowledge/application/knowledge-bases'
import { performDeleteTable, performRenameTable } from '@/lib/table/orchestration'
import { listTables } from '@/lib/table/service'
import { findWorkspaceFileFolderIdByPath } from '@/lib/uploads/contexts/workspace/workspace-file-folder-manager'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import {
  copyWorkflowVfsItems,
  createWorkflowVfsFolders,
  deleteWorkflowVfsItems,
  moveWorkflowVfsItems,
  type WorkflowVfsOutcome,
} from '@/lib/workflows/application/workflow-vfs'
import { archiveWorkspaceFileItemsOperation } from '@/lib/workspace-files/application/archive-workspace-file-items'
import { deleteWorkspaceFileOperation } from '@/lib/workspace-files/application/delete-workspace-file'
import { moveWorkspaceFileItemsOperation } from '@/lib/workspace-files/application/move-workspace-file-items'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { renameWorkspaceFile } from '@/lib/workspace-files/application/rename-workspace-file'
import { updateWorkspaceFileFolderOperation } from '@/lib/workspace-files/application/workspace-file-folders'

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

class KnowledgeVfsInfrastructureError extends Error {
  constructor(readonly infrastructureCause: unknown) {
    super('Knowledge VFS infrastructure failure')
    this.name = 'KnowledgeVfsInfrastructureError'
  }
}

function messageForKnowledgeVfsError(error: unknown, forbiddenMessage: string): string {
  const classified = asOrchestrationError(error)
  if (!classified || classified.code === 'internal') {
    throw new KnowledgeVfsInfrastructureError(error)
  }
  return classified.code === 'forbidden' ? forbiddenMessage : messageForCopilotKnowledgeError(error)
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

    const workspaceId = requireCopilotWorkspace(context)
    if (paths.some((path) => topLevelSegment(path) === 'files')) {
      await ensureWorkspaceAccess(workspaceId, context.userId, 'write')
    }
    assertMutationNotAborted(context)

    const workflowPaths = paths.filter((path) => topLevelSegment(path) === 'workflows')
    const workflowOutcomes = new Map<string, VfsMutateOutcome>()
    if (workflowPaths.length > 0) {
      try {
        const result = await executeCopilotWorkflowUseCase(context, createWorkflowVfsFolders, {
          workspaceId,
          paths: workflowPaths.map((path) => ({
            source: path,
            segments: decodeVfsPathSegments(path).slice(1),
          })),
        })
        for (const outcome of result.outcomes) {
          workflowOutcomes.set(outcome.source, presentWorkflowVfsOutcome(outcome))
        }
      } catch (error) {
        const message = messageForCopilotWorkflowError(error, 'Workflow folder creation failed')
        for (const path of workflowPaths) {
          workflowOutcomes.set(path, { from: path, kind: 'workflow_folder', error: message })
        }
      }
    }

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
        if (top === 'files') {
          const folderId = await ensureCopilotFileFolderPath(context, workspaceId, segments)
          outcomes.push({
            from: path,
            to: `${top}/${encodeVfsPathSegments(segments)}`,
            kind,
            id: folderId ?? undefined,
          })
        } else {
          outcomes.push(
            workflowOutcomes.get(path) ?? {
              from: path,
              kind: 'workflow_folder',
              error: 'Workflow folder creation failed',
            }
          )
        }
      } catch (error) {
        outcomes.push({
          from: path,
          kind,
          error:
            top === 'files'
              ? messageForCopilotFileError(error, 'File folder creation failed')
              : messageForCopilotWorkflowError(error, 'Workflow folder creation failed'),
        })
      }
    }

    return buildResult('mkdir', outcomes)
  } catch (error) {
    return {
      success: false,
      error: context.abortSignal?.aborted
        ? 'Request aborted before the mutation could be applied.'
        : 'Mutation failed',
    }
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

    const workspaceId = requireCopilotWorkspace(context)
    if (topLevelSegment(sources[0]) === 'knowledgebases') {
      resolveCopilotKnowledgePrincipal(context)
    }
    assertMutationNotAborted(context)

    const classified = classifyCategory(sources[0])
    if ('error' in classified) return { success: false, error: classified.error }
    const { category } = classified
    if (category !== 'workflows') {
      await ensureWorkspaceAccess(workspaceId, context.userId, 'write')
    }

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
    if (error instanceof KnowledgeVfsInfrastructureError) {
      throw error.infrastructureCause
    }
    return {
      success: false,
      error: context.abortSignal?.aborted
        ? 'Request aborted before the mutation could be applied.'
        : 'Mutation failed',
    }
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
  segments: string[],
  context: ExecutionContext
): Promise<WorkspaceFileRecord | null> {
  try {
    return await resolveCopilotWorkspaceFileReference(context, fileOperations.move, {
      workspaceId,
      reference: `files/${encodeVfsPathSegments(segments)}`,
    })
  } catch (error) {
    const classified = asOrchestrationError(error)
    if (classified?.code !== 'not_found') throw error
    return null
  }
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
    ensureFolderPath: (segments) => ensureCopilotFileFolderPath(context, workspaceId, segments),
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
    const file = await resolveFileAtExactPath(workspaceId, segments, context)
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
      if (targetFolderId === ref.file.folderId) {
        try {
          const result = await executeCopilotFileUseCase(
            context,
            renameWorkspaceFile,
            {
              fileId: ref.file.id,
              assertedWorkspaceId: workspaceId,
              name: targetName,
            },
            { fileId: ref.file.id }
          )
          outcomes.push({
            from: ref.source,
            to: `files/${encodeVfsPathSegments([...dest.folderSegments, result.file.name])}`,
            kind: 'file',
            id: ref.file.id,
          })
        } catch (error) {
          outcomes.push({
            from: ref.source,
            kind: 'file',
            error: messageForCopilotFileError(error),
          })
        }
        continue
      }
      try {
        await executeCopilotFileUseCase(
          context,
          moveWorkspaceFileItemsOperation,
          { workspaceId, fileIds: [ref.file.id], targetFolderId },
          { fileId: ref.file.id }
        )
        let finalName = ref.file.name
        if (targetName !== ref.file.name) {
          const renamed = await executeCopilotFileUseCase(
            context,
            renameWorkspaceFile,
            {
              fileId: ref.file.id,
              assertedWorkspaceId: workspaceId,
              name: targetName,
            },
            { fileId: ref.file.id }
          )
          finalName = renamed.file.name
        }
        outcomes.push({
          from: ref.source,
          to: `files/${encodeVfsPathSegments([...dest.folderSegments, finalName])}`,
          kind: 'file',
          id: ref.file.id,
        })
      } catch (error) {
        outcomes.push({
          from: ref.source,
          kind: 'file',
          error: messageForCopilotFileError(error, 'Failed to move file'),
        })
      }
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
    try {
      const result = await executeCopilotFileUseCase(context, updateWorkspaceFileFolderOperation, {
        workspaceId,
        folderId: ref.folderId,
        name: dest.dirMode ? undefined : dest.leafName,
        parentId: targetFolderId,
      })
      outcomes.push({
        from: ref.source,
        to: `files/${encodeVfsPathSegments([...dest.folderSegments, result.folder.name])}`,
        kind: 'file_folder',
        id: ref.folderId,
      })
    } catch (error) {
      outcomes.push({
        from: ref.source,
        kind: 'file_folder',
        error: messageForCopilotFileError(error, 'Failed to move folder'),
      })
    }
  }

  return buildResult(verb, outcomes)
}

function presentWorkflowVfsOutcome(outcome: WorkflowVfsOutcome): VfsMutateOutcome {
  return {
    from: outcome.source,
    ...(outcome.targetSegments
      ? { to: `workflows/${encodeVfsPathSegments(outcome.targetSegments)}` }
      : {}),
    kind: outcome.resourceType === 'workflow' ? 'workflow' : 'workflow_folder',
    id: outcome.resourceId,
    error: outcome.error,
  }
}

async function mutateWorkflows(
  verb: MutateVerb,
  sources: string[],
  destination: string,
  context: ExecutionContext,
  workspaceId: string
): Promise<ToolCallResult> {
  assertMutationNotAborted(context)
  const input = {
    workspaceId,
    sources: sources.map((source) => ({
      source,
      segments: decodeVfsPathSegments(source).slice(1),
    })),
    destination: {
      segments: decodeVfsPathSegments(destination).slice(1),
      trailingSlash: hasTrailingSlash(destination),
    },
  }
  const result =
    verb === 'cp'
      ? await executeCopilotWorkflowUseCase(context, copyWorkflowVfsItems, input)
      : await executeCopilotWorkflowUseCase(context, moveWorkflowVfsItems, input)
  return buildResult(verb, result.outcomes.map(presentWorkflowVfsOutcome))
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
    const renameOutcome = await performRenameTable({
      table: match,
      newName,
      userId: context.userId,
      requestId: generateRequestId(),
    })
    if (!renameOutcome.success) {
      return { success: false, error: renameOutcome.error ?? 'Failed to rename table' }
    }
    return buildResult(verb, [
      {
        from: sources[0],
        to: `tables/${normalizeVfsSegment(newName)}`,
        kind,
        id: match.id,
      },
    ])
  }

  if (newName.toLowerCase() === 'connectors') {
    return { success: false, error: '"knowledgebases/connectors" is a reserved path.' }
  }
  let knowledgeBases: Awaited<ReturnType<typeof listKnowledgeBases.execute>>['knowledgeBases']
  try {
    const result = await executeCopilotKnowledgeUseCase(context, listKnowledgeBases, {
      workspaceId,
    })
    knowledgeBases = result.knowledgeBases
  } catch (error) {
    return {
      success: false,
      error: messageForKnowledgeVfsError(error, 'Write access required to rename knowledge bases'),
    }
  }
  const match = knowledgeBases
    .map(({ knowledgeBase }) => knowledgeBase)
    .find((kb) => normalizeVfsSegment(kb.name) === canonicalSource)
  if (!match) {
    return { success: false, error: `Knowledge base not found at ${sources[0]}` }
  }
  assertMutationNotAborted(context)
  try {
    await executeCopilotKnowledgeUseCase(context, updateKnowledgeBaseOperation, {
      knowledgeBaseId: match.id,
      assertedWorkspaceId: workspaceId,
      name: newName,
      source: 'agent',
    })
  } catch (error) {
    return {
      success: false,
      error: messageForKnowledgeVfsError(
        error,
        `Write access required to rename knowledge base "${match.name}"`
      ),
    }
  }
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

    const workspaceId = requireCopilotWorkspace(context)
    if (paths.some((path) => topLevelSegment(path) === 'knowledgebases')) {
      resolveCopilotKnowledgePrincipal(context)
    }
    if (paths.some((path) => topLevelSegment(path) !== 'workflows')) {
      await ensureWorkspaceAccess(workspaceId, context.userId, 'write')
    }
    assertMutationNotAborted(context)

    const workflowPaths = paths.filter((path) => topLevelSegment(path) === 'workflows')
    const workflowOutcomes = new Map<string, VfsMutateOutcome>()
    if (workflowPaths.length > 0) {
      try {
        const result = await executeCopilotWorkflowUseCase(context, deleteWorkflowVfsItems, {
          workspaceId,
          paths: workflowPaths.map((path) => ({
            source: path,
            segments: decodeVfsPathSegments(path).slice(1),
          })),
        })
        for (const outcome of result.outcomes) {
          workflowOutcomes.set(outcome.source, presentWorkflowVfsOutcome(outcome))
        }
      } catch (error) {
        const message = messageForCopilotWorkflowError(error, 'Workflow deletion failed')
        for (const path of workflowPaths) {
          workflowOutcomes.set(path, { from: path, kind: 'workflow', error: message })
        }
      }
    }

    const outcomes: VfsMutateOutcome[] = []
    for (const path of paths) {
      const classified = classifyCategory(path, RM_CATEGORY_REJECTIONS, 'deletable')
      if ('error' in classified) {
        outcomes.push({ from: path, kind: defaultKindFor(path), error: classified.error })
        continue
      }
      try {
        assertMutationNotAborted(context)
        if (classified.category === 'workflows') {
          outcomes.push(
            workflowOutcomes.get(path) ?? {
              from: path,
              kind: 'workflow',
              error: 'Workflow deletion failed',
            }
          )
        } else {
          outcomes.push(await removeOne(classified.category, path, context, workspaceId))
        }
      } catch (error) {
        if (error instanceof KnowledgeVfsInfrastructureError) throw error
        outcomes.push({
          from: path,
          kind: defaultKindFor(path),
          error:
            classified.category === 'files'
              ? messageForCopilotFileError(error, 'File deletion failed')
              : classified.category === 'workflows'
                ? messageForCopilotWorkflowError(error, 'Workflow deletion failed')
                : toError(error).message,
        })
      }
    }

    return buildResult('rm', outcomes)
  } catch (error) {
    if (error instanceof KnowledgeVfsInfrastructureError) {
      throw error.infrastructureCause
    }
    return {
      success: false,
      error: context.abortSignal?.aborted
        ? 'Request aborted before the mutation could be applied.'
        : 'Delete failed',
    }
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
  category: Exclude<MutateCategory, 'workflows'>,
  path: string,
  context: ExecutionContext,
  workspaceId: string
): Promise<VfsMutateOutcome> {
  switch (category) {
    case 'files':
      return removeWorkspaceFilePath(path, context, workspaceId)
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
  let file: WorkspaceFileRecord | undefined
  try {
    file = await resolveCopilotWorkspaceFileReference(context, fileOperations.delete, {
      workspaceId,
      reference: path,
    })
  } catch (error) {
    const classified = asOrchestrationError(error)
    if (classified?.code !== 'not_found') throw error
  }
  if (file) {
    await executeCopilotFileUseCase(
      context,
      deleteWorkspaceFileOperation,
      { fileId: file.id, assertedWorkspaceId: workspaceId },
      { fileId: file.id }
    )
    logger.info('Deleted workspace file via rm', { fileId: file.id, workspaceId })
    return { from: path, kind: 'file', id: file.id }
  }

  const segments = decodeVfsPathSegments(path).slice(1)
  if (segments.length === 0) {
    return { from: path, kind: 'file', error: 'Path must name a file or folder under files/' }
  }
  const folderId = await findWorkspaceFileFolderIdByPath(workspaceId, segments)
  if (!folderId) return { from: path, kind: 'file', error: `Not found: ${path}` }

  try {
    const result = await executeCopilotFileUseCase(context, archiveWorkspaceFileItemsOperation, {
      workspaceId,
      folderIds: [folderId],
    })
    logger.info('Deleted file folder via rm', { folderId, workspaceId })
    return { from: path, kind: 'file_folder', id: folderId }
  } catch (error) {
    return {
      from: path,
      kind: 'file_folder',
      id: folderId,
      error: messageForCopilotFileError(error, 'Failed to delete'),
    }
  }
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

  const outcome = await performDeleteTable({
    table: match,
    userId: context.userId,
    requestId: generateRequestId(),
  })
  if (!outcome.success) {
    return { from: path, kind: 'table', error: outcome.error ?? 'Failed to archive table' }
  }
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
  let knowledgeBases: Awaited<ReturnType<typeof listKnowledgeBases.execute>>['knowledgeBases']
  try {
    const result = await executeCopilotKnowledgeUseCase(context, listKnowledgeBases, {
      workspaceId,
    })
    knowledgeBases = result.knowledgeBases
  } catch (error) {
    return {
      from: path,
      kind: 'knowledge_base',
      error: messageForKnowledgeVfsError(error, 'Write access required to delete knowledge bases'),
    }
  }
  const match = knowledgeBases
    .map(({ knowledgeBase }) => knowledgeBase)
    .find((kb) => normalizeVfsSegment(kb.name) === canonical)
  if (!match)
    return { from: path, kind: 'knowledge_base', error: `Knowledge base not found at ${path}` }

  try {
    await executeCopilotKnowledgeUseCase(context, deleteKnowledgeBaseOperation, {
      knowledgeBaseId: match.id,
      assertedWorkspaceId: workspaceId,
      source: 'agent',
    })
  } catch (error) {
    return {
      from: path,
      kind: 'knowledge_base',
      id: match.id,
      error: messageForKnowledgeVfsError(
        error,
        `Write access required to delete knowledge base "${match.name}"`
      ),
    }
  }
  PlatformEvents.knowledgeBaseDeleted({ knowledgeBaseId: match.id })
  logger.info('Deleted knowledge base via rm', { knowledgeBaseId: match.id, workspaceId })
  return { from: path, kind: 'knowledge_base', id: match.id }
}
