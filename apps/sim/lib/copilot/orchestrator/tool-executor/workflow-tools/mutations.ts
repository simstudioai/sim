import crypto from 'crypto'
import { createLogger } from '@sim/logger'
import { db } from '@sim/db'
import { workflow, workflowFolder } from '@sim/db/schema'
import { and, eq, isNull, max } from 'drizzle-orm'
import type { ExecutionContext, ToolCallResult } from '@/lib/copilot/orchestrator/types'
import { generateRequestId } from '@/lib/core/utils/request'
import { buildDefaultWorkflowArtifacts } from '@/lib/workflows/defaults'
import { executeWorkflow } from '@/lib/workflows/executor/execute-workflow'
import { saveWorkflowToNormalizedTables } from '@/lib/workflows/persistence/utils'
import { ensureWorkflowAccess, ensureWorkspaceAccess, getDefaultWorkspaceId } from '../access'
import type {
  CreateFolderParams,
  CreateWorkflowParams,
  RunWorkflowParams,
  SetGlobalWorkflowVariablesParams,
  VariableOperation,
} from '../param-types'

const logger = createLogger('WorkflowMutations')

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

    const workspaceId = params?.workspaceId || (await getDefaultWorkspaceId(context.userId))
    const folderId = params?.folderId || null

    await ensureWorkspaceAccess(workspaceId, context.userId, true)

    const workflowId = crypto.randomUUID()
    const now = new Date()

    const folderCondition = folderId ? eq(workflow.folderId, folderId) : isNull(workflow.folderId)
    const [maxResult] = await db
      .select({ maxOrder: max(workflow.sortOrder) })
      .from(workflow)
      .where(and(eq(workflow.workspaceId, workspaceId), folderCondition))
    const sortOrder = (maxResult?.maxOrder ?? 0) + 1

    await db.insert(workflow).values({
      id: workflowId,
      userId: context.userId,
      workspaceId,
      folderId,
      sortOrder,
      name,
      description,
      color: '#3972F6',
      lastSynced: now,
      createdAt: now,
      updatedAt: now,
      isDeployed: false,
      runCount: 0,
      variables: {},
    })

    const { workflowState } = buildDefaultWorkflowArtifacts()
    const saveResult = await saveWorkflowToNormalizedTables(workflowId, workflowState)
    if (!saveResult.success) {
      throw new Error(saveResult.error || 'Failed to save workflow state')
    }

    return {
      success: true,
      output: {
        workflowId,
        workflowName: name,
        workspaceId,
        folderId,
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

    const workspaceId = params?.workspaceId || (await getDefaultWorkspaceId(context.userId))
    const parentId = params?.parentId || null

    await ensureWorkspaceAccess(workspaceId, context.userId, true)

    const [maxResult] = await db
      .select({ maxOrder: max(workflowFolder.sortOrder) })
      .from(workflowFolder)
      .where(
        and(
          eq(workflowFolder.workspaceId, workspaceId),
          parentId ? eq(workflowFolder.parentId, parentId) : isNull(workflowFolder.parentId)
        )
      )
    const sortOrder = (maxResult?.maxOrder ?? 0) + 1

    const folderId = crypto.randomUUID()
    await db.insert(workflowFolder).values({
      id: folderId,
      userId: context.userId,
      workspaceId,
      parentId,
      name,
      sortOrder,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    return { success: true, output: { folderId, name, workspaceId, parentId } }
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

    const { workflow: workflowRecord } = await ensureWorkflowAccess(workflowId, context.userId)

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
      { enabled: true, useDraftState: true }
    )

    return {
      success: result.success,
      output: {
        executionId: result.metadata?.executionId,
        success: result.success,
        output: result.output,
        logs: result.logs,
      },
      error: result.success ? undefined : result.error || 'Workflow execution failed',
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
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
    const { workflow: workflowRecord } = await ensureWorkflowAccess(workflowId, context.userId)

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
            logger.warn('Failed to parse JSON value for variable coercion', { error: error instanceof Error ? error.message : String(error) })
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

    const nextVarsRecord = Object.fromEntries(
      Object.values(byName).map((v) => [String(v.id), v])
    )

    await db
      .update(workflow)
      .set({ variables: nextVarsRecord, updatedAt: new Date() })
      .where(eq(workflow.id, workflowId))

    return { success: true, output: { updated: Object.values(byName).length } }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}
