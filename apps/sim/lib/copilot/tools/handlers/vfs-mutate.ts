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
import { requireCopilotWorkspace } from '@/lib/copilot/tools/server/files/file-folder-application'
import { normalizeVfsSegment } from '@/lib/copilot/vfs/normalize-segment'
import { decodeVfsPathSegments, encodeVfsPathSegments } from '@/lib/copilot/vfs/path-utils'
import { asOrchestrationError } from '@/lib/core/orchestration/types'
import { PlatformEvents } from '@/lib/core/telemetry'
import {
  deleteKnowledgeBaseByVfsPath,
  renameKnowledgeBaseByVfsPath,
} from '@/lib/knowledge/application/knowledge-vfs'
import { captureServerEvent } from '@/lib/posthog/server'
import { deleteTableByVfsPath, renameTableByVfsPath } from '@/lib/table/application/table-vfs'
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
          outcomes.push(
            fileOutcomes.get(path) ?? {
              from: path,
              kind: 'file_folder',
              error: 'File folder creation failed',
            }
          )
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
        return await renameFlatResource(verb, category, sources, destination, context, workspaceId)
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

  if (category === 'tables') {
    try {
      const renamed = await executeCopilotTableUseCase(
        context,
        renameTableByVfsPath,
        { workspaceId, sourceName, newName },
        {}
      )
      return buildResult(verb, [
        {
          from: sources[0],
          to: `tables/${normalizeVfsSegment(renamed.name)}`,
          kind,
          id: renamed.id,
        },
      ])
    } catch (error) {
      return { success: false, error: messageForExpectedTableVfsError(error) }
    }
  }

  if (newName.toLowerCase() === 'connectors') {
    return { success: false, error: '"knowledgebases/connectors" is a reserved path.' }
  }
  try {
    const renamed = await executeCopilotKnowledgeUseCase(context, renameKnowledgeBaseByVfsPath, {
      workspaceId,
      sourceName,
      newName,
    })
    logger.info('Renamed knowledge base via mv', {
      knowledgeBaseId: renamed.id,
      workspaceId,
    })
    return buildResult(verb, [
      {
        from: sources[0],
        to: `knowledgebases/${normalizeVfsSegment(renamed.name)}`,
        kind,
        id: renamed.id,
      },
    ])
  } catch (error) {
    return {
      success: false,
      error: messageForKnowledgeVfsError(
        error,
        `Write access required to rename knowledge base "${sourceName}"`
      ),
    }
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
              error: 'Workflow deletion failed',
            }
          )
        } else if (classified.category === 'files') {
          outcomes.push(
            fileOutcomes.get(path) ?? { from: path, kind: 'file', error: 'File deletion failed' }
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

/** Resolves a flat tables/{name} or knowledgebases/{name} path to its single segment. */
function flatResourceName(path: string): string | null {
  const segments = decodeVfsPathSegments(path).slice(1)
  if (segments.length !== 1) return null
  return segments[0]
}

async function removeTablePath(
  path: string,
  context: ExecutionContext,
  workspaceId: string
): Promise<VfsMutateOutcome> {
  const sourceName = flatResourceName(path)
  if (!sourceName) {
    return {
      from: path,
      kind: 'table',
      error: 'tables/ is a flat namespace — rm takes a single name, e.g. rm(["tables/Leads"]).',
    }
  }
  try {
    const deleted = await executeCopilotTableUseCase(
      context,
      deleteTableByVfsPath,
      { workspaceId, sourceName },
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
    return { from: path, kind: 'table', error: messageForExpectedTableVfsError(error) }
  }
}

async function removeKnowledgeBasePath(
  path: string,
  context: ExecutionContext,
  workspaceId: string
): Promise<VfsMutateOutcome> {
  const sourceName = flatResourceName(path)
  if (!sourceName) {
    return {
      from: path,
      kind: 'knowledge_base',
      error:
        'knowledgebases/ is a flat namespace — rm takes a single name, e.g. rm(["knowledgebases/support-docs"]).',
    }
  }
  if (sourceName.toLowerCase() === 'connectors') {
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
    })
    PlatformEvents.knowledgeBaseDeleted({ knowledgeBaseId: deleted.id })
    logger.info('Deleted knowledge base via rm', {
      knowledgeBaseId: deleted.id,
      workspaceId,
    })
    return { from: path, kind: 'knowledge_base', id: deleted.id }
  } catch (error) {
    return {
      from: path,
      kind: 'knowledge_base',
      error: messageForKnowledgeVfsError(
        error,
        `Write access required to delete knowledge base "${sourceName}"`
      ),
    }
  }
}
