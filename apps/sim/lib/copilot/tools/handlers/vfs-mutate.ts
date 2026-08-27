import { createLogger } from '@sim/logger'
import { executeCopilotFileUseCase } from '@/lib/copilot/application/execute-file-use-case'
import {
  executeCopilotKnowledgeUseCase,
  messageForCopilotKnowledgeError,
} from '@/lib/copilot/application/execute-knowledge-use-case'
import { executeCopilotTableUseCase } from '@/lib/copilot/application/execute-table-use-case'
import {
  executeCopilotWorkflowUseCase,
  messageForCopilotWorkflowError,
} from '@/lib/copilot/application/execute-workflow-use-case'
import { messageForCopilotTableError } from '@/lib/copilot/auth/table-delegation'
import type { ExecutionContext, ToolCallResult } from '@/lib/copilot/request/types'
import { requireCopilotWorkspace } from '@/lib/copilot/tools/server/workspace-scope'
import { decodeVfsPathSegments, encodeVfsPathSegments } from '@/lib/copilot/vfs/path-utils'
import { asOrchestrationError } from '@/lib/core/orchestration/types'
import { PlatformEvents } from '@/lib/core/telemetry'
import type { ResourceVfsOutcome } from '@/lib/folders/application/resource-vfs'
import {
  createKnowledgeVfsFolders,
  deleteKnowledgeBaseByVfsPath,
  deleteKnowledgeVfsFolders,
  transferKnowledgeVfsItems,
} from '@/lib/knowledge/application/knowledge-vfs'
import { captureServerEvent } from '@/lib/posthog/server'
import {
  createTableVfsFolders,
  deleteTableByVfsPath,
  deleteTableVfsFolders,
  transferTableVfsItems,
} from '@/lib/table/application/table-vfs'
import { VfsPathLimitError, validateVfsPathBatch } from '@/lib/vfs/limits'
import {
  copyWorkflowVfsItems,
  createWorkflowVfsFolders,
  deleteWorkflowVfsItems,
  moveWorkflowVfsItems,
  type WorkflowVfsOutcome,
} from '@/lib/workflows/application/workflow-vfs'
import {
  createWorkspaceFileVfsFolders,
  deleteWorkspaceFileVfsItems,
  relocateWorkspaceFileVfsItems,
  type WorkspaceFileVfsOutcome,
} from '@/lib/workspace-files/application/workspace-file-vfs'

const logger = createLogger('VfsMutateTools')

type MutateVerb = 'mv' | 'cp'

type MutateCategory = 'files' | 'workflows' | 'tables' | 'knowledgebases'

const MUTATE_CATEGORIES = new Set<string>(['files', 'workflows', 'tables', 'knowledgebases'])

const CATEGORY_REJECTIONS: Record<string, string> = {
  uploads:
    'uploads/ files are chat-scoped and immutable. Use save_upload to promote one into files/ first.',
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
  kind:
    | 'file'
    | 'file_folder'
    | 'workflow'
    | 'workflow_folder'
    | 'table'
    | 'table_folder'
    | 'knowledge_base'
    | 'knowledge_base_folder'
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

function messageForExpectedWorkflowVfsError(error: unknown, fallback: string): string {
  const classified = asOrchestrationError(error)
  if (!classified || classified.code === 'internal') throw error
  return messageForCopilotWorkflowError(error, fallback)
}

function messageForExpectedTableVfsError(error: unknown): string {
  const classified = asOrchestrationError(error)
  if (!classified || classified.code === 'internal') throw error
  return messageForCopilotTableError(error)
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
    validateVfsPathBatch(paths)

    const workspaceId = requireCopilotWorkspace(context)
    assertMutationNotAborted(context)

    const filePaths = paths.filter((path) => topLevelSegment(path) === 'files')
    const fileOutcomes = new Map<string, VfsMutateOutcome>()
    if (filePaths.length > 0) {
      const result = await executeCopilotFileUseCase(context, createWorkspaceFileVfsFolders, {
        workspaceId,
        paths: filePaths.map((path) => ({
          source: path,
          segments: decodeVfsPathSegments(path).slice(1),
        })),
      })
      for (const outcome of result.outcomes) {
        fileOutcomes.set(outcome.source, presentFileVfsOutcome(outcome))
      }
    }

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
        const message = messageForExpectedWorkflowVfsError(error, 'Workflow folder creation failed')
        for (const path of workflowPaths) {
          workflowOutcomes.set(path, { from: path, kind: 'workflow_folder', error: message })
        }
      }
    }

    const folderedOutcomes = new Map<string, VfsMutateOutcome>()
    for (const category of ['tables', 'knowledgebases'] as const) {
      const categoryPaths = paths.filter((path) => topLevelSegment(path) === category)
      if (categoryPaths.length === 0) continue
      const folderKind = category === 'tables' ? 'table_folder' : 'knowledge_base_folder'
      const reserved = categoryPaths.filter((path) =>
        isReservedKnowledgePath(category, decodeVfsPathSegments(path).slice(1))
      )
      for (const path of reserved) {
        folderedOutcomes.set(path, {
          from: path,
          kind: folderKind,
          error: '"knowledgebases/connectors" is a reserved path.',
        })
      }
      const eligible = categoryPaths.filter((path) => !folderedOutcomes.has(path))
      if (eligible.length === 0) continue
      const input = {
        workspaceId,
        paths: eligible.map((path) => ({
          source: path,
          segments: decodeVfsPathSegments(path).slice(1),
        })),
      }
      try {
        const result =
          category === 'tables'
            ? await executeCopilotTableUseCase(context, createTableVfsFolders, input, {})
            : await executeCopilotKnowledgeUseCase(context, createKnowledgeVfsFolders, input)
        for (const outcome of result.outcomes) {
          folderedOutcomes.set(outcome.source, presentResourceVfsOutcome(category, outcome))
        }
      } catch (error) {
        const message =
          category === 'tables'
            ? messageForExpectedTableVfsError(error)
            : messageForKnowledgeVfsError(error, 'Write access required to create folders')
        for (const path of eligible) {
          folderedOutcomes.set(path, { from: path, kind: folderKind, error: message })
        }
      }
    }

    const outcomes: VfsMutateOutcome[] = []
    for (const path of paths) {
      const top = topLevelSegment(path)
      const segments = decodeVfsPathSegments(path).slice(1)
      const kind =
        top === 'workflows'
          ? 'workflow_folder'
          : top === 'tables'
            ? 'table_folder'
            : top === 'knowledgebases'
              ? 'knowledge_base_folder'
              : 'file_folder'

      if (top === 'tables' || top === 'knowledgebases') {
        outcomes.push(
          folderedOutcomes.get(path) ?? {
            from: path,
            kind,
            error: `No result came back for "${path}" — the parent path may not exist or the name may collide. Run glob on the parent to confirm, and do not repeat the identical call.`,
          }
        )
        continue
      }
      if (top !== 'files' && top !== 'workflows') {
        const rejection =
          CATEGORY_REJECTIONS[top] ??
          `"${path}" is not a folder target. mkdir supports files/, workflows/, tables/, and knowledgebases/ paths.`
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
          outcomes.push(
            fileOutcomes.get(path) ?? {
              from: path,
              kind: 'file_folder',
              error: `No result came back for "${path}" — the parent path may not exist or the name may collide. Run glob on the parent to confirm, and do not repeat the identical call.`,
            }
          )
        } else {
          outcomes.push(
            workflowOutcomes.get(path) ?? {
              from: path,
              kind: 'workflow_folder',
              error: `No result came back for "${path}" — the parent path may not exist or the name may collide. Run glob on the parent to confirm, and do not repeat the identical call.`,
            }
          )
        }
      } catch (error) {
        const classified = asOrchestrationError(error)
        if (!classified || classified.code === 'internal') throw error
        outcomes.push({ from: path, kind, error: classified.message })
      }
    }

    return buildResult('mkdir', outcomes)
  } catch (error) {
    if (context.abortSignal?.aborted) {
      return { success: false, error: 'Request aborted before the mutation could be applied.' }
    }
    if (error instanceof VfsPathLimitError) return { success: false, error: error.message }
    throw error
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
    validateVfsPathBatch([...sources, destination])

    const workspaceId = requireCopilotWorkspace(context)
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
        return await transferFolderedResource(
          verb,
          category,
          sources,
          destination,
          context,
          workspaceId
        )
    }
  } catch (error) {
    if (error instanceof KnowledgeVfsInfrastructureError) {
      throw error.infrastructureCause
    }
    if (context.abortSignal?.aborted) {
      return { success: false, error: 'Request aborted before the mutation could be applied.' }
    }
    if (error instanceof VfsPathLimitError) return { success: false, error: error.message }
    throw error
  }
}

function presentResourceVfsOutcome(
  category: 'tables' | 'knowledgebases',
  outcome: ResourceVfsOutcome
): VfsMutateOutcome {
  const resourceKind = category === 'tables' ? 'table' : 'knowledge_base'
  const folderKind = category === 'tables' ? 'table_folder' : 'knowledge_base_folder'
  return {
    from: outcome.source,
    ...(outcome.targetSegments
      ? { to: `${category}/${encodeVfsPathSegments(outcome.targetSegments)}` }
      : {}),
    kind: outcome.kind === 'folder' ? folderKind : resourceKind,
    id: outcome.resourceId,
    error: outcome.error,
  }
}

/** knowledgebases/connectors is a virtual tree, not a knowledge base or folder. */
function isReservedKnowledgePath(category: string, segments: readonly string[]): boolean {
  return category === 'knowledgebases' && segments[0]?.toLowerCase() === 'connectors'
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
  assertMutationNotAborted(context)
  const result = await executeCopilotFileUseCase(context, relocateWorkspaceFileVfsItems, {
    workspaceId,
    sources: sources.map((source) => ({
      source,
      segments: decodeVfsPathSegments(source).slice(1),
    })),
    destination: {
      segments: decodeVfsPathSegments(destination).slice(1),
      trailingSlash: hasTrailingSlash(destination),
    },
  })
  return buildResult(verb, result.outcomes.map(presentFileVfsOutcome))
}

function presentFileVfsOutcome(outcome: WorkspaceFileVfsOutcome): VfsMutateOutcome {
  return {
    from: outcome.source,
    ...(outcome.targetSegments
      ? { to: `files/${encodeVfsPathSegments(outcome.targetSegments)}` }
      : {}),
    kind: outcome.resourceType === 'file' ? 'file' : 'file_folder',
    id: outcome.resourceId,
    error: outcome.error,
  }
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
  try {
    const result =
      verb === 'cp'
        ? await executeCopilotWorkflowUseCase(context, copyWorkflowVfsItems, input)
        : await executeCopilotWorkflowUseCase(context, moveWorkflowVfsItems, input)
    return buildResult(verb, result.outcomes.map(presentWorkflowVfsOutcome))
  } catch (error) {
    if (context.abortSignal?.aborted) throw error
    return {
      success: false,
      error: messageForExpectedWorkflowVfsError(error, 'Workflow mutation failed'),
    }
  }
}

async function transferFolderedResource(
  verb: MutateVerb,
  category: 'tables' | 'knowledgebases',
  sources: string[],
  destination: string,
  context: ExecutionContext,
  workspaceId: string
): Promise<ToolCallResult> {
  const label = category === 'tables' ? 'Tables' : 'Knowledge bases'
  if (verb === 'cp') {
    return { success: false, error: `${label} cannot be copied — duplication is not supported.` }
  }

  const sourceRefs = sources.map((source) => ({
    source,
    segments: decodeVfsPathSegments(source).slice(1),
  }))
  const destinationSegments = decodeVfsPathSegments(destination).slice(1)
  for (const ref of sourceRefs) {
    if (isReservedKnowledgePath(category, ref.segments)) {
      return { success: false, error: '"knowledgebases/connectors" is a reserved path.' }
    }
  }
  if (isReservedKnowledgePath(category, destinationSegments)) {
    return { success: false, error: '"knowledgebases/connectors" is a reserved path.' }
  }

  const input = {
    workspaceId,
    sources: sourceRefs,
    destination: {
      segments: destinationSegments,
      trailingSlash: hasTrailingSlash(destination),
    },
  }
  assertMutationNotAborted(context)
  try {
    const result =
      category === 'tables'
        ? await executeCopilotTableUseCase(context, transferTableVfsItems, input, {})
        : await executeCopilotKnowledgeUseCase(context, transferKnowledgeVfsItems, input)
    return buildResult(
      verb,
      result.outcomes.map((outcome) => presentResourceVfsOutcome(category, outcome))
    )
  } catch (error) {
    if (context.abortSignal?.aborted) throw error
    const message =
      category === 'tables'
        ? messageForExpectedTableVfsError(error)
        : messageForKnowledgeVfsError(error, `Write access required to move ${label.toLowerCase()}`)
    return { success: false, error: message }
  }
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
    validateVfsPathBatch(paths)

    const workspaceId = requireCopilotWorkspace(context)
    assertMutationNotAborted(context)

    const filePaths = paths.filter((path) => topLevelSegment(path) === 'files')
    const fileOutcomes = new Map<string, VfsMutateOutcome>()
    if (filePaths.length > 0) {
      const result = await executeCopilotFileUseCase(context, deleteWorkspaceFileVfsItems, {
        workspaceId,
        paths: filePaths.map((path) => ({
          source: path,
          segments: decodeVfsPathSegments(path).slice(1),
        })),
      })
      for (const outcome of result.outcomes) {
        fileOutcomes.set(outcome.source, presentFileVfsOutcome(outcome))
      }
    }

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
        const message = messageForExpectedWorkflowVfsError(error, 'Workflow deletion failed')
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
              error: `No result came back for deleting "${path}" — it may not exist or may already be deleted. Run glob("workflows/*") to confirm before retrying.`,
            }
          )
        } else if (classified.category === 'files') {
          outcomes.push(
            fileOutcomes.get(path) ?? {
              from: path,
              kind: 'file',
              error: `No result came back for deleting "${path}" — it may not exist or may already be deleted. Run glob("files/**") to confirm before retrying.`,
            }
          )
        } else {
          outcomes.push(await removeOne(classified.category, path, context, workspaceId))
        }
      } catch (error) {
        if (error instanceof KnowledgeVfsInfrastructureError) throw error
        if (classified.category === 'workflows') {
          outcomes.push({
            from: path,
            kind: defaultKindFor(path),
            error: messageForExpectedWorkflowVfsError(error, 'Workflow deletion failed'),
          })
          continue
        }
        throw error
      }
    }

    return buildResult('rm', outcomes)
  } catch (error) {
    if (error instanceof KnowledgeVfsInfrastructureError) {
      throw error.infrastructureCause
    }
    if (context.abortSignal?.aborted) {
      return { success: false, error: 'Request aborted before the mutation could be applied.' }
    }
    if (error instanceof VfsPathLimitError) return { success: false, error: error.message }
    throw error
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
  category: Exclude<MutateCategory, 'workflows' | 'files'>,
  path: string,
  context: ExecutionContext,
  workspaceId: string
): Promise<VfsMutateOutcome> {
  switch (category) {
    case 'tables':
      return removeTablePath(path, context, workspaceId)
    case 'knowledgebases':
      return removeKnowledgeBasePath(path, context, workspaceId)
  }
}

async function removeTablePath(
  path: string,
  context: ExecutionContext,
  workspaceId: string
): Promise<VfsMutateOutcome> {
  const segments = decodeVfsPathSegments(path).slice(1)
  if (segments.length === 0) {
    return {
      from: path,
      kind: 'table',
      error: 'rm takes a table or folder path, e.g. rm(["tables/Leads"]) or rm(["tables/CRM"]).',
    }
  }
  const sourceName = segments[segments.length - 1]
  try {
    const deleted = await executeCopilotTableUseCase(
      context,
      deleteTableByVfsPath,
      { workspaceId, sourceName, sourceSegments: segments },
      {}
    )
    captureServerEvent(
      context.userId,
      'table_deleted',
      { table_id: deleted.id, workspace_id: deleted.workspaceId },
      { groups: { workspace: deleted.workspaceId } }
    )
    logger.info('Archived table via rm', { tableId: deleted.id, workspaceId })
    return { from: path, kind: 'table', id: deleted.id }
  } catch (error) {
    const message = messageForExpectedTableVfsError(error)
    const folderOutcome = await removeResourceFolderFallback(
      'tables',
      path,
      segments,
      message,
      context,
      workspaceId
    )
    if (folderOutcome) return folderOutcome
    return { from: path, kind: 'table', error: message }
  }
}

/**
 * rm resolution is resource-first (matching mv); when the resource resolver
 * reports the path IS a folder, the delete retargets to the folder cascade.
 */
async function removeResourceFolderFallback(
  category: 'tables' | 'knowledgebases',
  path: string,
  segments: string[],
  resourceError: string,
  context: ExecutionContext,
  workspaceId: string
): Promise<VfsMutateOutcome | null> {
  if (!resourceError.includes('is a folder')) return null
  const input = { workspaceId, paths: [{ source: path, segments }] }
  try {
    const result =
      category === 'tables'
        ? await executeCopilotTableUseCase(context, deleteTableVfsFolders, input, {})
        : await executeCopilotKnowledgeUseCase(context, deleteKnowledgeVfsFolders, input)
    const outcome = result.outcomes[0]
    return outcome ? presentResourceVfsOutcome(category, outcome) : null
  } catch (error) {
    const message =
      category === 'tables'
        ? messageForExpectedTableVfsError(error)
        : messageForKnowledgeVfsError(error, 'Write access required to delete folders')
    return {
      from: path,
      kind: category === 'tables' ? 'table_folder' : 'knowledge_base_folder',
      error: message,
    }
  }
}

async function removeKnowledgeBasePath(
  path: string,
  context: ExecutionContext,
  workspaceId: string
): Promise<VfsMutateOutcome> {
  const segments = decodeVfsPathSegments(path).slice(1)
  if (segments.length === 0) {
    return {
      from: path,
      kind: 'knowledge_base',
      error: 'rm takes a knowledge base or folder path, e.g. rm(["knowledgebases/support-docs"]).',
    }
  }
  const sourceName = segments[segments.length - 1]
  if (isReservedKnowledgePath('knowledgebases', segments)) {
    return {
      from: path,
      kind: 'knowledge_base',
      error: '"knowledgebases/connectors" is a reserved path, not a knowledge base.',
    }
  }
  try {
    const deleted = await executeCopilotKnowledgeUseCase(context, deleteKnowledgeBaseByVfsPath, {
      workspaceId,
      sourceName,
      sourceSegments: segments,
    })
    PlatformEvents.knowledgeBaseDeleted({ knowledgeBaseId: deleted.id })
    logger.info('Deleted knowledge base via rm', {
      knowledgeBaseId: deleted.id,
      workspaceId,
    })
    return { from: path, kind: 'knowledge_base', id: deleted.id }
  } catch (error) {
    const message = messageForKnowledgeVfsError(
      error,
      `Write access required to delete knowledge base "${sourceName}"`
    )
    const folderOutcome = await removeResourceFolderFallback(
      'knowledgebases',
      path,
      segments,
      message,
      context,
      workspaceId
    )
    if (folderOutcome) return folderOutcome
    return { from: path, kind: 'knowledge_base', error: message }
  }
}
