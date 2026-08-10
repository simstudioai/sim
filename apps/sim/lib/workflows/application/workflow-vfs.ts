import { AuditAction, AuditResourceType } from '@sim/audit'
import { resolvePrincipalAttribution } from '@sim/auth/principal'
import { db } from '@sim/db'
import { workflow } from '@sim/db/schema'
import {
  assertFolderMutable,
  assertWorkflowMutable,
  FolderLockedError,
  WorkflowLockedError,
} from '@sim/platform-authz/workflow'
import { and, eq, isNull } from 'drizzle-orm'
import {
  asOrchestrationError,
  OrchestrationError,
  type OrchestrationErrorCode,
} from '@/lib/core/orchestration/types'
import { generateRequestId } from '@/lib/core/utils/request'
import {
  createFolderAtPath,
  deleteFolderByPath,
  relocateFolderByPath,
} from '@/lib/folders/orchestration'
import {
  buildFolderPath,
  FolderPathError,
  type FolderPathIndex,
  parseFolderPath,
} from '@/lib/folders/paths'
import { loadActiveFolderPathIndex } from '@/lib/folders/queries'
import {
  notifyFolderResourceChanged,
  notifyWorkflowDeleted,
  notifyWorkflowUpdated,
} from '@/lib/realtime/notify'
import { VfsPathLimitError, validateVfsPathSegments } from '@/lib/vfs/limits'
import { encodeVfsPathSegments } from '@/lib/vfs/path'
import { defineAuthorizedWorkflowUseCase } from '@/lib/workflows/application/authorized-workflow-use-case'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workflows/application/context'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { requireWorkflowTransition } from '@/lib/workflows/application/transition-result'
import { deleteWorkflowRecord, updateWorkflowRecord } from '@/lib/workflows/orchestration'
import { duplicateWorkflow as duplicateWorkflowRecord } from '@/lib/workflows/persistence/duplicate'
import type { ActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'

const MAX_WORKFLOW_VFS_ITEMS = 100
const MAX_WORKFLOW_VFS_INDEX_ROWS = 10_000
const MAX_WORKFLOW_NAME_LENGTH = 200

export interface WorkflowVfsPathReference {
  source: string
  segments: string[]
}

export interface WorkflowVfsDestination {
  segments: string[]
  trailingSlash: boolean
}

export interface WorkflowVfsOutcome {
  source: string
  targetSegments?: string[]
  resourceType: 'workflow' | 'folder'
  resourceId?: string
  error?: string
}

export interface CreateWorkflowVfsFoldersInput {
  workspaceId: string
  paths: WorkflowVfsPathReference[]
}

export interface TransferWorkflowVfsItemsInput {
  workspaceId: string
  sources: WorkflowVfsPathReference[]
  destination: WorkflowVfsDestination
}

export interface DeleteWorkflowVfsItemsInput {
  workspaceId: string
  paths: WorkflowVfsPathReference[]
}

interface WorkflowVfsRow {
  id: string
  name: string
  folderId: string | null
}

interface CreatedFolderChange {
  id: string
  name: string
  path: string
}

interface MovedWorkflowChange {
  id: string
  name: string
  previousFolderId: string | null
  folderId: string | null
}

interface MovedFolderChange {
  id: string
  name: string
  sourcePath: string
  destinationPath: string
}

interface DuplicatedWorkflowChange {
  id: string
  name: string
  sourceWorkflowId: string
}

interface DeletedWorkflowChange {
  id: string
  name: string
}

interface DeletedFolderChange {
  id: string
  name: string
  path: string
  workflows: number
  folders: number
}

interface WorkflowVfsIndexState {
  folderIndex: FolderPathIndex
  workflows: WorkflowVfsRow[]
  createdFolders: CreatedFolderChange[]
}

interface ResolvedWorkflowSource {
  source: string
  workflow?: WorkflowVfsRow
  folderId?: string
  error?: string
}

interface DestinationPlan {
  dirMode: boolean
  folderSegments: string[]
  leafName?: string
  ensureFolderId(): Promise<string | null>
}

function canonicalSegmentsKey(segments: readonly string[]): string {
  return encodeVfsPathSegments([...segments])
}

function normalizeReferences(
  references: readonly WorkflowVfsPathReference[]
): WorkflowVfsPathReference[] {
  if (references.length > MAX_WORKFLOW_VFS_ITEMS) {
    throw new OrchestrationError(
      'validation',
      `Workflow VFS commands cannot exceed ${MAX_WORKFLOW_VFS_ITEMS} items`
    )
  }
  const byPath = new Map<string, WorkflowVfsPathReference>()
  for (const reference of references) {
    try {
      validateVfsPathSegments(reference.segments)
    } catch (error) {
      if (error instanceof VfsPathLimitError) {
        throw new OrchestrationError('validation', error.message)
      }
      throw error
    }
    const key = canonicalSegmentsKey(reference.segments)
    if (!byPath.has(key)) byPath.set(key, reference)
  }
  if (byPath.size === 0) throw new OrchestrationError('validation', 'At least one path is required')
  return [...byPath.values()]
}

function validateDestination(destination: WorkflowVfsDestination): void {
  try {
    validateVfsPathSegments(destination.segments)
  } catch (error) {
    if (error instanceof VfsPathLimitError) {
      throw new OrchestrationError('validation', error.message)
    }
    throw error
  }
}

async function loadWorkflowVfsIndex(
  context: ActiveWorkspaceApplicationContext
): Promise<WorkflowVfsIndexState> {
  const [folderIndex, workflows] = await Promise.all([
    loadActiveFolderPathIndex(context.workspaceId, 'workflow', db, {
      maxRows: MAX_WORKFLOW_VFS_INDEX_ROWS,
    }),
    db
      .select({ id: workflow.id, name: workflow.name, folderId: workflow.folderId })
      .from(workflow)
      .where(and(eq(workflow.workspaceId, context.workspaceId), isNull(workflow.archivedAt)))
      .limit(MAX_WORKFLOW_VFS_INDEX_ROWS + 1),
  ])
  if (workflows.length > MAX_WORKFLOW_VFS_INDEX_ROWS) {
    throw new Error(`Workflow VFS index exceeds the ${MAX_WORKFLOW_VFS_INDEX_ROWS} row limit`)
  }
  return { folderIndex, workflows, createdFolders: [] }
}

function folderSegmentsForId(index: FolderPathIndex, folderId: string | null): string[] {
  if (!folderId) return []
  const path = index.pathById.get(folderId)
  if (!path) throw new Error('Workflow references an inactive or missing folder')
  return parseFolderPath(path)
}

function resolveWorkflowSources(
  state: WorkflowVfsIndexState,
  references: readonly WorkflowVfsPathReference[]
): ResolvedWorkflowSource[] {
  const workflowsByPath = new Map<string, WorkflowVfsRow>()
  for (const row of state.workflows) {
    const path = canonicalSegmentsKey([
      ...folderSegmentsForId(state.folderIndex, row.folderId),
      row.name,
    ])
    if (!workflowsByPath.has(path)) workflowsByPath.set(path, row)
  }
  const foldersByPath = new Map<string, string>()
  for (const [folderId, path] of state.folderIndex.pathById) {
    foldersByPath.set(canonicalSegmentsKey(parseFolderPath(path)), folderId)
  }

  return references.map((reference) => {
    if (reference.segments.length === 0) {
      return {
        source: reference.source,
        error: 'Source must name a workflow or folder under workflows/',
      }
    }
    const key = canonicalSegmentsKey(reference.segments)
    const workflowRow = workflowsByPath.get(key)
    if (workflowRow) return { source: reference.source, workflow: workflowRow }
    const folderId = foldersByPath.get(key)
    if (folderId) return { source: reference.source, folderId }
    return { source: reference.source, error: `Not found: ${reference.source}` }
  })
}

function throwFolderFailure(result: { error?: string; errorCode?: OrchestrationErrorCode }): never {
  throw new OrchestrationError(
    result.errorCode ?? 'internal',
    result.errorCode === 'internal'
      ? 'Workflow folder mutation failed'
      : (result.error ?? 'Folder mutation failed')
  )
}

async function reloadFolderIndex(state: WorkflowVfsIndexState, workspaceId: string): Promise<void> {
  state.folderIndex = await loadActiveFolderPathIndex(workspaceId, 'workflow', db, {
    maxRows: MAX_WORKFLOW_VFS_INDEX_ROWS,
  })
}

async function ensureWorkflowFolderPath(
  state: WorkflowVfsIndexState,
  context: ActiveWorkspaceApplicationContext,
  userId: string,
  segments: readonly string[]
): Promise<string | null> {
  let folderId: string | null = null
  for (let position = 0; position < segments.length; position += 1) {
    const path = buildFolderPath(segments.slice(0, position + 1))
    const existing = state.folderIndex.idByPath.get(path)
    if (existing) {
      folderId = existing
      continue
    }

    const result = await createFolderAtPath({
      resourceType: 'workflow',
      workspaceId: context.workspaceId,
      userId,
      path,
      effects: false,
      throwInfrastructure: true,
      maxFolderRows: MAX_WORKFLOW_VFS_INDEX_ROWS,
    })
    if (!result.success || !result.folder) {
      if (result.errorCode === 'conflict') {
        await reloadFolderIndex(state, context.workspaceId)
        const concurrentlyCreated = state.folderIndex.idByPath.get(path)
        if (concurrentlyCreated) {
          folderId = concurrentlyCreated
          continue
        }
      }
      throwFolderFailure(result)
    }

    state.createdFolders.push({ id: result.folder.id, name: result.folder.name, path })
    await reloadFolderIndex(state, context.workspaceId)
    folderId = result.folder.id
  }
  return folderId
}

function planDestination(
  input: TransferWorkflowVfsItemsInput,
  state: WorkflowVfsIndexState,
  context: ActiveWorkspaceApplicationContext,
  userId: string,
  sourceCount: number
): DestinationPlan {
  const segments = input.destination.segments
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
            : folderSegments.length === 0
              ? Promise.resolve(null)
              : ensureWorkflowFolderPath(state, context, userId, folderSegments)),
    }
  }

  if (segments.length === 0) return plan(true, [], undefined, null)
  if (input.destination.trailingSlash) return plan(true, segments)
  const existingFolderId = state.folderIndex.idByPath.get(buildFolderPath(segments))
  if (existingFolderId) return plan(true, segments, undefined, existingFolderId)
  if (sourceCount > 1) {
    throw new OrchestrationError(
      'validation',
      `With multiple sources the destination must be a folder. "workflows/${canonicalSegmentsKey(segments)}" does not exist — end it with "/" to create it.`
    )
  }
  return plan(false, segments.slice(0, -1), segments.at(-1))
}

function expectedOutcomeMessage(error: unknown): string {
  const classified = asOrchestrationError(error)
  if (classified && classified.code !== 'internal') return classified.message
  if (
    error instanceof WorkflowLockedError ||
    error instanceof FolderLockedError ||
    error instanceof FolderPathError
  ) {
    return error.message
  }
  throw error
}

async function moveWorkflowRow(params: {
  row: WorkflowVfsRow
  targetName?: string
  targetFolderId: string | null
  context: ActiveWorkspaceApplicationContext
  userId: string
}): Promise<MovedWorkflowChange> {
  try {
    await Promise.all([
      assertWorkflowMutable(params.row.id),
      assertFolderMutable(params.targetFolderId),
    ])
  } catch (error) {
    if (error instanceof WorkflowLockedError || error instanceof FolderLockedError) {
      throw new OrchestrationError('locked', error.message)
    }
    throw error
  }

  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ id: workflow.id, name: workflow.name, folderId: workflow.folderId })
      .from(workflow)
      .where(
        and(
          eq(workflow.id, params.row.id),
          eq(workflow.workspaceId, params.context.workspaceId),
          isNull(workflow.archivedAt)
        )
      )
      .limit(1)
      .for('update')
    if (!current) throw new OrchestrationError('not_found', 'Workflow not found')

    const transition = await updateWorkflowRecord({
      workflowId: current.id,
      userId: params.userId,
      workspaceId: params.context.workspaceId,
      currentName: current.name,
      currentFolderId: current.folderId,
      name: params.targetName,
      folderId: params.targetFolderId,
      tx,
    })
    requireWorkflowTransition(transition, 'Workflow mutation failed')
    if (!transition.workflow) throw new Error('Successful workflow move returned no workflow')
    return {
      id: transition.workflow.id,
      name: transition.workflow.name,
      previousFolderId: current.folderId,
      folderId: transition.workflow.folderId,
    }
  })
}

function createdFolderAuditEntries(createdFolders: readonly CreatedFolderChange[]) {
  return createdFolders.map((folder) => ({
    action: AuditAction.FOLDER_CREATED,
    resourceType: AuditResourceType.FOLDER,
    resourceId: folder.id,
    resourceName: folder.name,
    description: `Created workflow folder "${folder.path}"`,
    metadata: { path: folder.path, folderResourceType: 'workflow' },
  }))
}

export const createWorkflowVfsFolders = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.createVfsFolders,
  resolveContext: ({ input }: { input: CreateWorkflowVfsFoldersInput }) =>
    resolveActiveWorkspaceApplicationContext(input.workspaceId),
  async execute({ principal, input, context }) {
    const paths = normalizeReferences(input.paths)
    const state = await loadWorkflowVfsIndex(context)
    const userId = resolvePrincipalAttribution(principal, {
      workspaceBillingOwnerUserId: context.billedAccountUserId,
    }).attributedUserId
    const outcomes: WorkflowVfsOutcome[] = []

    for (const path of paths) {
      if (path.segments.length === 0) {
        outcomes.push({
          source: path.source,
          resourceType: 'folder',
          error: 'Path must include at least one folder segment',
        })
        continue
      }
      try {
        const folderId = await ensureWorkflowFolderPath(state, context, userId, path.segments)
        outcomes.push({
          source: path.source,
          targetSegments: path.segments,
          resourceType: 'folder',
          resourceId: folderId ?? undefined,
        })
      } catch (error) {
        outcomes.push({
          source: path.source,
          resourceType: 'folder',
          error: expectedOutcomeMessage(error),
        })
      }
    }
    return { outcomes, createdFolders: state.createdFolders }
  },
  projectAudit: ({ result }) => createdFolderAuditEntries(result.createdFolders),
  afterSuccess: ({ context, result }) =>
    result.createdFolders.length > 0
      ? notifyFolderResourceChanged('workflow', context.workspaceId)
      : undefined,
})

export const moveWorkflowVfsItems = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.moveVfsItems,
  resolveContext: ({ input }: { input: TransferWorkflowVfsItemsInput }) =>
    resolveActiveWorkspaceApplicationContext(input.workspaceId),
  async execute({ principal, input, context }) {
    const sources = normalizeReferences(input.sources)
    validateDestination(input.destination)
    const state = await loadWorkflowVfsIndex(context)
    const refs = resolveWorkflowSources(state, sources)
    const userId = resolvePrincipalAttribution(principal, {
      workspaceBillingOwnerUserId: context.billedAccountUserId,
    }).attributedUserId
    const destination = planDestination(input, state, context, userId, sources.length)
    if (!destination.dirMode && (destination.leafName?.length ?? 0) > MAX_WORKFLOW_NAME_LENGTH) {
      throw new OrchestrationError(
        'validation',
        `Workflow name must be ${MAX_WORKFLOW_NAME_LENGTH} characters or less`
      )
    }
    const outcomes: WorkflowVfsOutcome[] = []
    const movedWorkflows: MovedWorkflowChange[] = []
    const movedFolders: MovedFolderChange[] = []

    for (const ref of refs) {
      if (ref.error) {
        outcomes.push({ source: ref.source, resourceType: 'workflow', error: ref.error })
        continue
      }
      if (ref.workflow) {
        const targetName = destination.dirMode
          ? ref.workflow.name
          : (destination.leafName as string)
        try {
          const targetFolderId = await destination.ensureFolderId()
          const change = await moveWorkflowRow({
            row: ref.workflow,
            targetName: destination.dirMode ? undefined : targetName,
            targetFolderId,
            context,
            userId,
          })
          movedWorkflows.push(change)
          outcomes.push({
            source: ref.source,
            targetSegments: [...destination.folderSegments, change.name],
            resourceType: 'workflow',
            resourceId: change.id,
          })
        } catch (error) {
          outcomes.push({
            source: ref.source,
            resourceType: 'workflow',
            error: expectedOutcomeMessage(error),
          })
        }
        continue
      }

      const folderId = ref.folderId as string
      try {
        const targetFolderId = await destination.ensureFolderId()
        if (targetFolderId === folderId) {
          outcomes.push({
            source: ref.source,
            resourceType: 'folder',
            error: 'Cannot move a folder into itself',
          })
          continue
        }
        const sourcePath = state.folderIndex.pathById.get(folderId)
        const sourceRow = state.folderIndex.rowById.get(folderId)
        if (!sourcePath || !sourceRow) throw new Error('Workflow folder path index is incomplete')
        const finalLeaf = destination.dirMode
          ? (sources.find((source) => source.source === ref.source)?.segments.at(-1) ?? '')
          : (destination.leafName as string)
        const destinationPath = buildFolderPath([...destination.folderSegments, finalLeaf])
        const result = await relocateFolderByPath({
          resourceType: 'workflow',
          workspaceId: context.workspaceId,
          userId,
          path: sourcePath,
          destinationPath,
          effects: false,
          throwInfrastructure: true,
          maxFolderRows: MAX_WORKFLOW_VFS_INDEX_ROWS,
        })
        if (!result.success || !result.folder) throwFolderFailure(result)
        movedFolders.push({
          id: result.folder.id,
          name: result.folder.name,
          sourcePath,
          destinationPath,
        })
        outcomes.push({
          source: ref.source,
          targetSegments: [...destination.folderSegments, finalLeaf],
          resourceType: 'folder',
          resourceId: result.folder.id,
        })
      } catch (error) {
        outcomes.push({
          source: ref.source,
          resourceType: 'folder',
          error: expectedOutcomeMessage(error),
        })
      }
    }

    return { outcomes, createdFolders: state.createdFolders, movedWorkflows, movedFolders }
  },
  projectAudit: ({ result }) => [
    ...createdFolderAuditEntries(result.createdFolders),
    ...result.movedWorkflows.map((change) => ({
      action: AuditAction.WORKFLOW_UPDATED,
      resourceType: AuditResourceType.WORKFLOW,
      resourceId: change.id,
      resourceName: change.name,
      description: `Moved workflow "${change.name}"`,
      metadata: {
        previousFolderId: change.previousFolderId,
        folderId: change.folderId,
      },
    })),
    ...result.movedFolders.map((change) => ({
      action: AuditAction.FOLDER_MOVED,
      resourceType: AuditResourceType.FOLDER,
      resourceId: change.id,
      resourceName: change.name,
      description: `Moved workflow folder to "${change.destinationPath}"`,
      metadata: {
        sourcePath: change.sourcePath,
        destinationPath: change.destinationPath,
        folderResourceType: 'workflow',
      },
    })),
  ],
  afterSuccess: async ({ context, result }) => {
    for (const change of result.movedWorkflows) {
      await notifyWorkflowUpdated(change.id)
    }
    if (result.createdFolders.length > 0 || result.movedFolders.length > 0) {
      await notifyFolderResourceChanged('workflow', context.workspaceId)
    }
  },
})

export const copyWorkflowVfsItems = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.copyVfsItems,
  resolveContext: ({ input }: { input: TransferWorkflowVfsItemsInput }) =>
    resolveActiveWorkspaceApplicationContext(input.workspaceId),
  async execute({ principal, input, context }) {
    const sources = normalizeReferences(input.sources)
    validateDestination(input.destination)
    const state = await loadWorkflowVfsIndex(context)
    const refs = resolveWorkflowSources(state, sources)
    const userId = resolvePrincipalAttribution(principal, {
      workspaceBillingOwnerUserId: context.billedAccountUserId,
    }).attributedUserId
    const destination = planDestination(input, state, context, userId, sources.length)
    if (!destination.dirMode && (destination.leafName?.length ?? 0) > MAX_WORKFLOW_NAME_LENGTH) {
      throw new OrchestrationError(
        'validation',
        `Workflow name must be ${MAX_WORKFLOW_NAME_LENGTH} characters or less`
      )
    }
    const outcomes: WorkflowVfsOutcome[] = []
    const duplicatedWorkflows: DuplicatedWorkflowChange[] = []

    for (const ref of refs) {
      if (ref.error) {
        outcomes.push({ source: ref.source, resourceType: 'workflow', error: ref.error })
        continue
      }
      if (!ref.workflow) {
        outcomes.push({
          source: ref.source,
          resourceType: 'folder',
          error: 'Workflow folders cannot be copied.',
        })
        continue
      }

      try {
        const targetFolderId = await destination.ensureFolderId()
        const targetName = destination.dirMode
          ? ref.workflow.name
          : (destination.leafName as string)
        const duplicated = await db.transaction(async (tx) => {
          const [source] = await tx
            .select({ id: workflow.id })
            .from(workflow)
            .where(
              and(
                eq(workflow.id, ref.workflow?.id as string),
                eq(workflow.workspaceId, context.workspaceId),
                isNull(workflow.archivedAt)
              )
            )
            .limit(1)
            .for('update')
          if (!source) throw new OrchestrationError('not_found', 'Workflow not found')
          return duplicateWorkflowRecord({
            sourceWorkflowId: source.id,
            userId,
            workspaceId: context.workspaceId,
            folderId: targetFolderId,
            name: targetName,
            requestId: generateRequestId(),
            tx,
          })
        })
        duplicatedWorkflows.push({
          id: duplicated.id,
          name: duplicated.name,
          sourceWorkflowId: ref.workflow.id,
        })
        outcomes.push({
          source: ref.source,
          targetSegments: [...destination.folderSegments, duplicated.name],
          resourceType: 'workflow',
          resourceId: duplicated.id,
        })
      } catch (error) {
        outcomes.push({
          source: ref.source,
          resourceType: 'workflow',
          error: expectedOutcomeMessage(error),
        })
      }
    }

    return { outcomes, createdFolders: state.createdFolders, duplicatedWorkflows }
  },
  projectAudit: ({ context, result }) => [
    ...createdFolderAuditEntries(result.createdFolders),
    ...result.duplicatedWorkflows.map((change) => ({
      action: AuditAction.WORKFLOW_DUPLICATED,
      resourceType: AuditResourceType.WORKFLOW,
      resourceId: change.id,
      resourceName: change.name,
      description: `Duplicated workflow as "${change.name}"`,
      metadata: {
        sourceWorkflowId: change.sourceWorkflowId,
        workspaceId: context.workspaceId,
      },
    })),
  ],
  afterSuccess: async ({ context, result }) => {
    for (const change of result.duplicatedWorkflows) {
      await notifyWorkflowUpdated(change.id)
    }
    if (result.createdFolders.length > 0) {
      await notifyFolderResourceChanged('workflow', context.workspaceId)
    }
  },
})

export const deleteWorkflowVfsItems = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.deleteVfsItems,
  resolveContext: ({ input }: { input: DeleteWorkflowVfsItemsInput }) =>
    resolveActiveWorkspaceApplicationContext(input.workspaceId),
  async execute({ principal, input, context }) {
    const paths = normalizeReferences(input.paths)
    const state = await loadWorkflowVfsIndex(context)
    const refs = resolveWorkflowSources(state, paths)
    const userId = resolvePrincipalAttribution(principal, {
      workspaceBillingOwnerUserId: context.billedAccountUserId,
    }).attributedUserId
    const outcomes: WorkflowVfsOutcome[] = []
    const deletedWorkflows: DeletedWorkflowChange[] = []
    const deletedFolders: DeletedFolderChange[] = []

    for (const ref of refs) {
      if (ref.error) {
        outcomes.push({ source: ref.source, resourceType: 'workflow', error: ref.error })
        continue
      }
      if (ref.workflow) {
        try {
          await assertWorkflowMutable(ref.workflow.id)
          const result = await deleteWorkflowRecord({
            workflowId: ref.workflow.id,
            userId,
            notifySocket: false,
          })
          requireWorkflowTransition(result, 'Workflow deletion failed')
          if (!result.workflow || !result.archived) {
            throw new OrchestrationError('validation', 'Workflow is already deleted')
          }
          deletedWorkflows.push({ id: result.workflow.id, name: result.workflow.name })
          outcomes.push({
            source: ref.source,
            resourceType: 'workflow',
            resourceId: result.workflow.id,
          })
        } catch (error) {
          outcomes.push({
            source: ref.source,
            resourceType: 'workflow',
            error: expectedOutcomeMessage(error),
          })
        }
        continue
      }

      const folderId = ref.folderId as string
      const path = state.folderIndex.pathById.get(folderId)
      if (!path) throw new Error('Workflow folder path index is incomplete')
      try {
        const result = await deleteFolderByPath({
          resourceType: 'workflow',
          workspaceId: context.workspaceId,
          userId,
          path,
          recursive: true,
          effects: false,
          throwInfrastructure: true,
          maxFolderRows: MAX_WORKFLOW_VFS_INDEX_ROWS,
        })
        if (!result.success || !result.folderId || !result.folderName || !result.deletedItems) {
          throwFolderFailure(result)
        }
        deletedFolders.push({
          id: result.folderId,
          name: result.folderName,
          path,
          workflows: result.deletedItems.workflows ?? 0,
          folders: result.deletedItems.folders,
        })
        outcomes.push({
          source: ref.source,
          resourceType: 'folder',
          resourceId: result.folderId,
        })
      } catch (error) {
        outcomes.push({
          source: ref.source,
          resourceType: 'folder',
          error: expectedOutcomeMessage(error),
        })
      }
    }

    return { outcomes, deletedWorkflows, deletedFolders }
  },
  projectAudit: ({ result }) => [
    ...result.deletedWorkflows.map((change) => ({
      action: AuditAction.WORKFLOW_DELETED,
      resourceType: AuditResourceType.WORKFLOW,
      resourceId: change.id,
      resourceName: change.name,
      description: `Archived workflow "${change.name}"`,
      metadata: { archived: true },
    })),
    ...result.deletedFolders.map((change) => ({
      action: AuditAction.FOLDER_DELETED,
      resourceType: AuditResourceType.FOLDER,
      resourceId: change.id,
      resourceName: change.name,
      description: `Deleted workflow folder "${change.path}"`,
      metadata: {
        folderResourceType: 'workflow',
        path: change.path,
        affected: {
          workflows: change.workflows,
          subfolders: Math.max(change.folders - 1, 0),
        },
      },
    })),
  ],
  afterSuccess: async ({ context, result }) => {
    for (const workflow of result.deletedWorkflows) {
      await notifyWorkflowDeleted(workflow.id)
    }
    if (result.deletedFolders.length > 0) {
      await notifyFolderResourceChanged('workflow', context.workspaceId)
    }
  },
})
