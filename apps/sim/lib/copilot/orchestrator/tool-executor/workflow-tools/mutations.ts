import crypto from 'crypto'
import { createLogger } from '@sim/logger'
import { createWorkspaceApiKey } from '@/lib/api-key/auth'
import { AuditAction, AuditResourceType, recordAudit } from '@/lib/audit/log'
import type { ExecutionContext, ToolCallResult } from '@/lib/copilot/orchestrator/types'
import { generateRequestId } from '@/lib/core/utils/request'
import { executeWorkflow } from '@/lib/workflows/executor/execute-workflow'
import {
  getExecutionState,
  getLatestExecutionState,
} from '@/lib/workflows/executor/execution-state'
import { performDeleteFolder, performDeleteWorkflow } from '@/lib/workflows/orchestration'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/persistence/utils'
import { sanitizeForCopilot } from '@/lib/workflows/sanitization/json-sanitizer'
import {
  checkForCircularReference,
  createFolderRecord,
  createWorkflowRecord,
  listFolders,
  setWorkflowVariables,
  updateFolderRecord,
  updateWorkflowRecord,
} from '@/lib/workflows/utils'
import { hasExecutionResult } from '@/executor/utils/errors'
import { ensureWorkflowAccess, ensureWorkspaceAccess, getDefaultWorkspaceId } from '../access'

function stripBinaryFields(value: unknown): unknown {
  if (value === null || value === undefined) return value
  if (typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(stripBinaryFields)
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (k === 'base64') continue
    out[k] = stripBinaryFields(v)
  }
  return out
}

function buildExecutionOutput(
  result: {
    success: boolean
    metadata?: { executionId?: string }
    output?: unknown
    logs?: unknown[]
    error?: string
  },
  extra?: Record<string, unknown>
): ToolCallResult {
  return {
    success: result.success,
    output: {
      executionId: result.metadata?.executionId,
      success: result.success,
      ...extra,
      output: stripBinaryFields(result.output),
      logs: stripBinaryFields(result.logs),
    },
    error: result.success ? undefined : result.error || 'Workflow execution failed',
  }
}

function buildExecutionError(error: unknown): ToolCallResult {
  const message = error instanceof Error ? error.message : String(error)
  if (hasExecutionResult(error)) {
    return buildExecutionOutput({
      ...error.executionResult,
      success: false,
      error: error.executionResult.error || message,
    })
  }
  return { success: false, error: message }
}

import type {
  CreateFolderParams,
  CreateWorkflowParams,
  DeleteFolderParams,
  DeleteWorkflowParams,
  GenerateApiKeyParams,
  MoveFolderParams,
  MoveWorkflowParams,
  RenameFolderParams,
  RenameWorkflowParams,
  RunBlockParams,
  RunFromBlockParams,
  RunWorkflowParams,
  RunWorkflowUntilBlockParams,
  SetGlobalWorkflowVariablesParams,
  UpdateWorkflowParams,
  VariableOperation,
} from '../param-types'

const logger = createLogger('WorkflowMutations')

function assertWorkflowMutationNotAborted(
  context: ExecutionContext,
  message = 'Request aborted before workflow mutation could be applied.'
): void {
  if (context.abortSignal?.aborted) {
    throw new Error(message)
  }
}

export async function executeCreateWorkflow(
  params: CreateWorkflowParams,
  context: ExecutionContext
): Promise<ToolCallResult> {
  try {
    const name = typeof params?.name === 'string' ? params.name.trim() : ''
    if (!name) {
      return { success: false, error: 'name is required' }
    }
    if (name.length > 200) {
      return { success: false, error: 'Workflow name must be 200 characters or less' }
    }
    const description = typeof params?.description === 'string' ? params.description : null
    if (description && description.length > 2000) {
      return { success: false, error: 'Description must be 2000 characters or less' }
    }

    const workspaceId =
      params?.workspaceId || context.workspaceId || (await getDefaultWorkspaceId(context.userId))
    const folderId = params?.folderId || null

    await ensureWorkspaceAccess(workspaceId, context.userId, 'write')
    assertWorkflowMutationNotAborted(context)

    const result = await createWorkflowRecord({
      userId: context.userId,
      workspaceId,
      name,
      description,
      folderId,
    })

    recordAudit({
      workspaceId,
      actorId: context.userId,
      action: AuditAction.WORKFLOW_CREATED,
      resourceType: AuditResourceType.WORKFLOW,
      resourceId: result.workflowId,
      resourceName: name,
      description: `Created workflow "${name}"`,
    })

    try {
      const { PlatformEvents } = await import('@/lib/core/telemetry')
      PlatformEvents.workflowCreated({
        workflowId: result.workflowId,
        name,
        workspaceId,
        folderId: folderId ?? undefined,
      })
    } catch (_e) {
      // Telemetry is best-effort
    }

    const normalized = await loadWorkflowFromNormalizedTables(result.workflowId)
    let copilotSanitizedWorkflowState: unknown
    if (normalized) {
      copilotSanitizedWorkflowState = sanitizeForCopilot({
        blocks: normalized.blocks || {},
        edges: normalized.edges || [],
        loops: normalized.loops || {},
        parallels: normalized.parallels || {},
      } as any)
    }

    return {
      success: true,
      output: {
        workflowId: result.workflowId,
        workflowName: result.name,
        workspaceId: result.workspaceId,
        folderId: result.folderId,
        ...(copilotSanitizedWorkflowState ? { copilotSanitizedWorkflowState } : {}),
      },
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function executeCreateFolder(
  params: CreateFolderParams,
  context: ExecutionContext
): Promise<ToolCallResult> {
  try {
    const name = typeof params?.name === 'string' ? params.name.trim() : ''
    if (!name) {
      return { success: false, error: 'name is required' }
    }
    if (name.length > 200) {
      return { success: false, error: 'Folder name must be 200 characters or less' }
    }

    const workspaceId =
      params?.workspaceId || context.workspaceId || (await getDefaultWorkspaceId(context.userId))
    const parentId = params?.parentId || null

    await ensureWorkspaceAccess(workspaceId, context.userId, 'write')
    assertWorkflowMutationNotAborted(context)

    const result = await createFolderRecord({
      userId: context.userId,
      workspaceId,
      name,
      parentId,
    })

    recordAudit({
      workspaceId,
      actorId: context.userId,
      action: AuditAction.FOLDER_CREATED,
      resourceType: AuditResourceType.FOLDER,
      resourceId: result.folderId,
      resourceName: name,
      description: `Created folder "${name}"`,
    })

    return { success: true, output: result }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function executeRunWorkflow(
  params: RunWorkflowParams,
  context: ExecutionContext
): Promise<ToolCallResult> {
  try {
    const workflowId = params.workflowId || context.workflowId
    if (!workflowId) {
      return { success: false, error: 'workflowId is required' }
    }

    const { workflow: workflowRecord } = await ensureWorkflowAccess(
      workflowId,
      context.userId,
      'write'
    )

    const useDraftState = !params.useDeployedState

    const result = await executeWorkflow(
      {
        id: workflowRecord.id,
        userId: workflowRecord.userId,
        workspaceId: workflowRecord.workspaceId,
        variables: workflowRecord.variables || {},
      },
      generateRequestId(),
      params.workflow_input || params.input || undefined,
      context.userId,
      { enabled: true, useDraftState, workflowTriggerType: 'copilot' }
    )

    return buildExecutionOutput(result)
  } catch (error) {
    return buildExecutionError(error)
  }
}

export async function executeSetGlobalWorkflowVariables(
  params: SetGlobalWorkflowVariablesParams,
  context: ExecutionContext
): Promise<ToolCallResult> {
  try {
    const workflowId = params.workflowId || context.workflowId
    if (!workflowId) {
      return { success: false, error: 'workflowId is required' }
    }
    const operations: VariableOperation[] = Array.isArray(params.operations)
      ? params.operations
      : []
    const { workflow: workflowRecord } = await ensureWorkflowAccess(
      workflowId,
      context.userId,
      'write'
    )

    interface WorkflowVariable {
      id: string
      workflowId?: string
      name: string
      type: string
      value?: unknown
    }
    const currentVarsRecord = (workflowRecord.variables as Record<string, unknown>) || {}
    const byName: Record<string, WorkflowVariable> = {}
    Object.values(currentVarsRecord).forEach((v) => {
      if (v && typeof v === 'object' && 'id' in v && 'name' in v) {
        const variable = v as WorkflowVariable
        byName[String(variable.name)] = variable
      }
    })

    for (const op of operations) {
      const key = String(op?.name || '')
      if (!key) continue
      const nextType = op?.type || byName[key]?.type || 'plain'
      const coerceValue = (value: unknown, type: string): unknown => {
        if (value === undefined) return value
        if (type === 'number') {
          const n = Number(value)
          return Number.isNaN(n) ? value : n
        }
        if (type === 'boolean') {
          const v = String(value).trim().toLowerCase()
          if (v === 'true') return true
          if (v === 'false') return false
          return value
        }
        if (type === 'array' || type === 'object') {
          try {
            const parsed = JSON.parse(String(value))
            if (type === 'array' && Array.isArray(parsed)) return parsed
            if (type === 'object' && parsed && typeof parsed === 'object' && !Array.isArray(parsed))
              return parsed
          } catch (error) {
            logger.warn('Failed to parse JSON value for variable coercion', {
              error: error instanceof Error ? error.message : String(error),
            })
          }
          return value
        }
        return value
      }

      if (op.operation === 'delete') {
        delete byName[key]
        continue
      }
      const typedValue = coerceValue(op.value, nextType)
      if (op.operation === 'add') {
        byName[key] = {
          id: crypto.randomUUID(),
          workflowId,
          name: key,
          type: nextType,
          value: typedValue,
        }
        continue
      }
      if (op.operation === 'edit') {
        if (!byName[key]) {
          byName[key] = {
            id: crypto.randomUUID(),
            workflowId,
            name: key,
            type: nextType,
            value: typedValue,
          }
        } else {
          byName[key] = {
            ...byName[key],
            type: nextType,
            value: typedValue,
          }
        }
      }
    }

    const nextVarsRecord = Object.fromEntries(Object.values(byName).map((v) => [String(v.id), v]))

    assertWorkflowMutationNotAborted(context)
    await setWorkflowVariables(workflowId, nextVarsRecord)

    recordAudit({
      actorId: context.userId,
      action: AuditAction.WORKFLOW_VARIABLES_UPDATED,
      resourceType: AuditResourceType.WORKFLOW,
      resourceId: workflowId,
      description: `Updated workflow variables`,
    })

    return { success: true, output: { updated: Object.values(byName).length } }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function executeRenameWorkflow(
  params: RenameWorkflowParams,
  context: ExecutionContext
): Promise<ToolCallResult> {
  try {
    const workflowId = params.workflowId
    if (!workflowId) {
      return { success: false, error: 'workflowId is required' }
    }
    const name = typeof params.name === 'string' ? params.name.trim() : ''
    if (!name) {
      return { success: false, error: 'name is required' }
    }
    if (name.length > 200) {
      return { success: false, error: 'Workflow name must be 200 characters or less' }
    }

    await ensureWorkflowAccess(workflowId, context.userId, 'write')
    assertWorkflowMutationNotAborted(context)
    await updateWorkflowRecord(workflowId, { name })

    return { success: true, output: { workflowId, name } }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function executeMoveWorkflow(
  params: MoveWorkflowParams,
  context: ExecutionContext
): Promise<ToolCallResult> {
  try {
    const workflowId = params.workflowId
    if (!workflowId) {
      return { success: false, error: 'workflowId is required' }
    }

    await ensureWorkflowAccess(workflowId, context.userId, 'write')
    const folderId = params.folderId || null
    assertWorkflowMutationNotAborted(context)
    await updateWorkflowRecord(workflowId, { folderId })

    return { success: true, output: { workflowId, folderId } }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function executeMoveFolder(
  params: MoveFolderParams,
  context: ExecutionContext
): Promise<ToolCallResult> {
  try {
    const folderId = params.folderId
    if (!folderId) {
      return { success: false, error: 'folderId is required' }
    }

    const parentId = params.parentId || null

    if (parentId === folderId) {
      return { success: false, error: 'A folder cannot be moved into itself' }
    }

    if (parentId) {
      const wouldCreateCycle = await checkForCircularReference(folderId, parentId)
      if (wouldCreateCycle) {
        return { success: false, error: 'Cannot create circular folder reference' }
      }
    }

    const workspaceId = context.workspaceId || (await getDefaultWorkspaceId(context.userId))
    await ensureWorkspaceAccess(workspaceId, context.userId, 'write')
    assertWorkflowMutationNotAborted(context)
    await updateFolderRecord(folderId, { parentId })

    return { success: true, output: { folderId, parentId } }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function executeRunWorkflowUntilBlock(
  params: RunWorkflowUntilBlockParams,
  context: ExecutionContext
): Promise<ToolCallResult> {
  try {
    const workflowId = params.workflowId || context.workflowId
    if (!workflowId) {
      return { success: false, error: 'workflowId is required' }
    }
    if (!params.stopAfterBlockId) {
      return { success: false, error: 'stopAfterBlockId is required' }
    }

    const { workflow: workflowRecord } = await ensureWorkflowAccess(
      workflowId,
      context.userId,
      'write'
    )

    const useDraftState = !params.useDeployedState

    const result = await executeWorkflow(
      {
        id: workflowRecord.id,
        userId: workflowRecord.userId,
        workspaceId: workflowRecord.workspaceId,
        variables: workflowRecord.variables || {},
      },
      generateRequestId(),
      params.workflow_input || params.input || undefined,
      context.userId,
      {
        enabled: true,
        useDraftState,
        stopAfterBlockId: params.stopAfterBlockId,
        workflowTriggerType: 'copilot',
      }
    )

    return buildExecutionOutput(result, { stoppedAfterBlockId: params.stopAfterBlockId })
  } catch (error) {
    return buildExecutionError(error)
  }
}

export async function executeGenerateApiKey(
  params: GenerateApiKeyParams,
  context: ExecutionContext
): Promise<ToolCallResult> {
  try {
    const name = typeof params.name === 'string' ? params.name.trim() : ''
    if (!name) {
      return { success: false, error: 'name is required' }
    }
    if (name.length > 200) {
      return { success: false, error: 'API key name must be 200 characters or less' }
    }

    const workspaceId =
      params.workspaceId || context.workspaceId || (await getDefaultWorkspaceId(context.userId))
    await ensureWorkspaceAccess(workspaceId, context.userId, 'admin')
    assertWorkflowMutationNotAborted(context)

    const newKey = await createWorkspaceApiKey({
      workspaceId,
      userId: context.userId,
      name,
    })

    recordAudit({
      workspaceId,
      actorId: context.userId,
      action: AuditAction.API_KEY_CREATED,
      resourceType: AuditResourceType.API_KEY,
      description: `Generated API key for workspace`,
    })

    return {
      success: true,
      output: {
        id: newKey.id,
        name: newKey.name,
        key: newKey.key,
        workspaceId,
        message:
          'API key created successfully. Copy this key now — it will not be shown again. Use this key in the x-api-key header when calling workflow API endpoints.',
      },
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function executeRunFromBlock(
  params: RunFromBlockParams,
  context: ExecutionContext
): Promise<ToolCallResult> {
  try {
    const workflowId = params.workflowId || context.workflowId
    if (!workflowId) {
      return { success: false, error: 'workflowId is required' }
    }
    if (!params.startBlockId) {
      return { success: false, error: 'startBlockId is required' }
    }

    const snapshot = params.executionId
      ? await getExecutionState(params.executionId)
      : await getLatestExecutionState(workflowId)

    if (!snapshot) {
      return {
        success: false,
        error: params.executionId
          ? `No execution state found for execution ${params.executionId}. Run the full workflow first.`
          : `No execution state found for workflow ${workflowId}. Run the full workflow first to create a snapshot.`,
      }
    }

    const { workflow: workflowRecord } = await ensureWorkflowAccess(
      workflowId,
      context.userId,
      'write'
    )
    const useDraftState = !params.useDeployedState

    const result = await executeWorkflow(
      {
        id: workflowRecord.id,
        userId: workflowRecord.userId,
        workspaceId: workflowRecord.workspaceId,
        variables: workflowRecord.variables || {},
      },
      generateRequestId(),
      params.workflow_input || params.input || undefined,
      context.userId,
      {
        enabled: true,
        useDraftState,
        workflowTriggerType: 'copilot',
        runFromBlock: { startBlockId: params.startBlockId, sourceSnapshot: snapshot },
      }
    )

    return buildExecutionOutput(result, { startBlockId: params.startBlockId })
  } catch (error) {
    return buildExecutionError(error)
  }
}

export async function executeUpdateWorkflow(
  params: UpdateWorkflowParams,
  context: ExecutionContext
): Promise<ToolCallResult> {
  try {
    const workflowId = params.workflowId
    if (!workflowId) {
      return { success: false, error: 'workflowId is required' }
    }

    const updates: { name?: string; description?: string } = {}

    if (typeof params.name === 'string') {
      const name = params.name.trim()
      if (!name) return { success: false, error: 'name cannot be empty' }
      if (name.length > 200)
        return { success: false, error: 'Workflow name must be 200 characters or less' }
      updates.name = name
    }

    if (typeof params.description === 'string') {
      if (params.description.length > 2000) {
        return { success: false, error: 'Description must be 2000 characters or less' }
      }
      updates.description = params.description
    }

    if (Object.keys(updates).length === 0) {
      return { success: false, error: 'At least one of name or description is required' }
    }

    await ensureWorkflowAccess(workflowId, context.userId, 'write')
    assertWorkflowMutationNotAborted(context)
    await updateWorkflowRecord(workflowId, updates)

    return {
      success: true,
      output: { workflowId, ...updates },
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function executeDeleteWorkflow(
  params: DeleteWorkflowParams,
  context: ExecutionContext
): Promise<ToolCallResult> {
  try {
    const workflowId = params.workflowId
    if (!workflowId) {
      return { success: false, error: 'workflowId is required' }
    }

    const { workflow: workflowRecord } = await ensureWorkflowAccess(
      workflowId,
      context.userId,
      'admin'
    )
    assertWorkflowMutationNotAborted(context)

    const result = await performDeleteWorkflow({ workflowId, userId: context.userId })
    if (!result.success) {
      return { success: false, error: result.error || 'Failed to delete workflow' }
    }

    return {
      success: true,
      output: { workflowId, name: workflowRecord.name, deleted: true },
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function executeDeleteFolder(
  params: DeleteFolderParams,
  context: ExecutionContext
): Promise<ToolCallResult> {
  try {
    const folderId = params.folderId
    if (!folderId) {
      return { success: false, error: 'folderId is required' }
    }

    const workspaceId = context.workspaceId || (await getDefaultWorkspaceId(context.userId))
    await ensureWorkspaceAccess(workspaceId, context.userId, 'admin')

    const folders = await listFolders(workspaceId)
    const folder = folders.find((f) => f.folderId === folderId)
    if (!folder) {
      return { success: false, error: 'Folder not found' }
    }

    assertWorkflowMutationNotAborted(context)

    const result = await performDeleteFolder({
      folderId,
      workspaceId,
      userId: context.userId,
      folderName: folder.folderName,
    })

    if (!result.success) {
      return { success: false, error: result.error || 'Failed to delete folder' }
    }

    return { success: true, output: { folderId, deleted: true, ...result.deletedItems } }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function executeRenameFolder(
  params: RenameFolderParams,
  context: ExecutionContext
): Promise<ToolCallResult> {
  try {
    const folderId = params.folderId
    if (!folderId) {
      return { success: false, error: 'folderId is required' }
    }
    const name = typeof params.name === 'string' ? params.name.trim() : ''
    if (!name) {
      return { success: false, error: 'name is required' }
    }
    if (name.length > 200) {
      return { success: false, error: 'Folder name must be 200 characters or less' }
    }

    const workspaceId = context.workspaceId || (await getDefaultWorkspaceId(context.userId))
    await ensureWorkspaceAccess(workspaceId, context.userId, 'write')
    assertWorkflowMutationNotAborted(context)
    await updateFolderRecord(folderId, { name })

    return { success: true, output: { folderId, name } }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function executeRunBlock(
  params: RunBlockParams,
  context: ExecutionContext
): Promise<ToolCallResult> {
  try {
    const workflowId = params.workflowId || context.workflowId
    if (!workflowId) {
      return { success: false, error: 'workflowId is required' }
    }
    if (!params.blockId) {
      return { success: false, error: 'blockId is required' }
    }

    const snapshot = params.executionId
      ? await getExecutionState(params.executionId)
      : await getLatestExecutionState(workflowId)

    if (!snapshot) {
      return {
        success: false,
        error: params.executionId
          ? `No execution state found for execution ${params.executionId}. Run the full workflow first.`
          : `No execution state found for workflow ${workflowId}. Run the full workflow first to create a snapshot.`,
      }
    }

    const { workflow: workflowRecord } = await ensureWorkflowAccess(
      workflowId,
      context.userId,
      'write'
    )
    const useDraftState = !params.useDeployedState

    const result = await executeWorkflow(
      {
        id: workflowRecord.id,
        userId: workflowRecord.userId,
        workspaceId: workflowRecord.workspaceId,
        variables: workflowRecord.variables || {},
      },
      generateRequestId(),
      params.workflow_input || params.input || undefined,
      context.userId,
      {
        enabled: true,
        useDraftState,
        workflowTriggerType: 'copilot',
        runFromBlock: { startBlockId: params.blockId, sourceSnapshot: snapshot },
        stopAfterBlockId: params.blockId,
      }
    )

    return buildExecutionOutput(result, { blockId: params.blockId })
  } catch (error) {
    return buildExecutionError(error)
  }
}
