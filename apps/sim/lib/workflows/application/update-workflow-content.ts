import { AuditAction, AuditResourceType } from '@sim/audit'
import type { Principal } from '@sim/auth/principal'
import { db } from '@sim/db'
import { workflow } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { assertWorkflowMutable, WorkflowLockedError } from '@sim/platform-authz/workflow'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { isRecordLike } from '@sim/utils/object'
import type { BlockState, WorkflowState } from '@sim/workflow-types/workflow'
import { and, eq, isNull } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { notifyWorkflowUpdated } from '@/lib/realtime/notify'
import { defineAuthorizedWorkflowUseCase } from '@/lib/workflows/application/authorized-workflow-use-case'
import { resolveActiveWorkflowApplicationContext } from '@/lib/workflows/application/context'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { assertedWorkflowWorkspaceId } from '@/lib/workflows/application/principal-scope'
import {
  loadWorkflowFromNormalizedTables,
  saveWorkflowToNormalizedTables,
} from '@/lib/workflows/persistence/utils'

const logger = createLogger('UpdateWorkflowContent')
const MAX_WORKFLOW_VARIABLE_OPERATIONS = 100

interface WorkflowContentInput {
  workflowId: string
  assertedWorkspaceId?: string
}

async function requireMutableWorkflow(workflowId: string): Promise<void> {
  try {
    await assertWorkflowMutable(workflowId)
  } catch (error) {
    if (error instanceof WorkflowLockedError) {
      throw new OrchestrationError('locked', error.message)
    }
    throw error
  }
}

function resolveWorkflowContentContext<I extends WorkflowContentInput>({
  principal,
  input,
}: {
  principal: Principal
  input: I
}) {
  return resolveActiveWorkflowApplicationContext({
    workflowId: input.workflowId,
    assertedWorkspaceId: assertedWorkflowWorkspaceId(principal, input.assertedWorkspaceId),
  })
}

interface WorkflowVariable {
  id: string
  workflowId?: string
  name: string
  type: string
  value?: unknown
}

export interface WorkflowVariableOperation {
  name: string
  operation: 'add' | 'edit' | 'delete'
  value?: unknown
  type?: string
}

export interface ApplyWorkflowVariableOperationsInput extends WorkflowContentInput {
  operations: WorkflowVariableOperation[]
}

function coerceWorkflowVariableValue(value: unknown, type: string): unknown {
  if (value === undefined) return value
  if (type === 'number') {
    const number = Number(value)
    return Number.isNaN(number) ? value : number
  }
  if (type === 'boolean') {
    const normalized = String(value).trim().toLowerCase()
    if (normalized === 'true') return true
    if (normalized === 'false') return false
    return value
  }
  if (type !== 'array' && type !== 'object') return value

  try {
    const parsed: unknown = JSON.parse(String(value))
    if (type === 'array' && Array.isArray(parsed)) return parsed
    if (type === 'object' && isRecordLike(parsed)) {
      return parsed
    }
  } catch (error) {
    logger.warn('Failed to parse JSON value for workflow variable coercion', {
      error: getErrorMessage(error),
    })
  }
  return value
}

function applyVariableOperations(
  workflowId: string,
  currentVariables: unknown,
  operations: readonly WorkflowVariableOperation[]
): { variables: Record<string, WorkflowVariable>; changed: boolean } {
  const current = isRecordLike(currentVariables)
    ? (currentVariables as Record<string, unknown>)
    : {}
  const byName = new Map<string, WorkflowVariable>()
  for (const value of Object.values(current)) {
    if (
      value &&
      typeof value === 'object' &&
      'id' in value &&
      typeof value.id === 'string' &&
      'name' in value &&
      typeof value.name === 'string'
    ) {
      byName.set(value.name, {
        ...value,
        id: value.id,
        name: value.name,
        type: 'type' in value && typeof value.type === 'string' ? value.type : 'plain',
      })
    }
  }

  let changed = false
  for (const operation of operations) {
    const name = String(operation.name || '')
    if (!name) continue
    const existing = byName.get(name)
    if (operation.operation === 'delete') {
      changed = byName.delete(name) || changed
      continue
    }

    const type = operation.type || existing?.type || 'plain'
    const value = coerceWorkflowVariableValue(operation.value, type)
    if (operation.operation === 'add' || !existing) {
      byName.set(name, { id: generateId(), workflowId, name, type, value })
    } else {
      byName.set(name, { ...existing, type, value })
    }
    changed = true
  }

  return {
    variables: Object.fromEntries([...byName.values()].map((variable) => [variable.id, variable])),
    changed,
  }
}

export const applyWorkflowVariableOperations = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.applyVariableOperations,
  resolveContext: resolveWorkflowContentContext<ApplyWorkflowVariableOperationsInput>,
  async execute({ input, context }) {
    if (input.operations.length > MAX_WORKFLOW_VARIABLE_OPERATIONS) {
      throw new OrchestrationError(
        'validation',
        `Workflow variable updates cannot exceed ${MAX_WORKFLOW_VARIABLE_OPERATIONS} operations`
      )
    }
    await requireMutableWorkflow(context.workflowId)

    return db.transaction(async (tx) => {
      const [current] = await tx
        .select({ variables: workflow.variables })
        .from(workflow)
        .where(
          and(
            eq(workflow.id, context.workflowId),
            eq(workflow.workspaceId, context.workspaceId),
            isNull(workflow.archivedAt)
          )
        )
        .limit(1)
        .for('update')
      if (!current) throw new OrchestrationError('not_found', 'Workflow not found')

      const transformed = applyVariableOperations(
        context.workflowId,
        current.variables,
        input.operations
      )
      if (!transformed.changed) {
        return { updated: Object.keys(transformed.variables).length, changed: false }
      }

      const [updated] = await tx
        .update(workflow)
        .set({ variables: transformed.variables, updatedAt: new Date() })
        .where(
          and(
            eq(workflow.id, context.workflowId),
            eq(workflow.workspaceId, context.workspaceId),
            isNull(workflow.archivedAt)
          )
        )
        .returning({ id: workflow.id })
      if (!updated) throw new OrchestrationError('not_found', 'Workflow not found')
      return { updated: Object.keys(transformed.variables).length, changed: true }
    })
  },
  projectAudit: ({ input, context, result }) =>
    result.changed
      ? {
          action: AuditAction.WORKFLOW_VARIABLES_UPDATED,
          resourceType: AuditResourceType.WORKFLOW,
          resourceId: context.workflowId,
          resourceName: context.workflow.name,
          description: 'Updated workflow variables',
          metadata: { operationCount: input.operations.length, source: 'copilot' },
        }
      : [],
  afterSuccess: ({ context, result }) =>
    result.changed ? notifyWorkflowUpdated(context.workflowId) : undefined,
})

function isBlockProtected(blockId: string, blocksById: Record<string, BlockState>): boolean {
  const block = blocksById[blockId]
  if (!block) return false
  if (block.locked) return true

  const visited = new Set<string>()
  let parentId = block.data?.parentId
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId)
    if (blocksById[parentId]?.locked) return true
    parentId = blocksById[parentId]?.data?.parentId
  }
  return false
}

function hasDisabledAncestor(blockId: string, blocksById: Record<string, BlockState>): boolean {
  const visited = new Set<string>()
  let parentId = blocksById[blockId]?.data?.parentId
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId)
    const parent = blocksById[parentId]
    if (!parent) return false
    if (parent.enabled === false) return true
    parentId = parent.data?.parentId
  }
  return false
}

function findDescendants(containerId: string, blocksById: Record<string, BlockState>): string[] {
  const descendants: string[] = []
  const stack = [containerId]
  const visited = new Set<string>()
  while (stack.length > 0) {
    const current = stack.pop()!
    if (visited.has(current)) continue
    visited.add(current)
    for (const [blockId, block] of Object.entries(blocksById)) {
      if (block.data?.parentId === current) {
        descendants.push(blockId)
        stack.push(blockId)
      }
    }
  }
  return descendants
}

export interface SetWorkflowBlockEnabledInput extends WorkflowContentInput {
  blockId: string
  enabled: boolean
}

export const setWorkflowBlockEnabled = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.setBlockEnabled,
  resolveContext: resolveWorkflowContentContext<SetWorkflowBlockEnabledInput>,
  async execute({ input, context }) {
    await requireMutableWorkflow(context.workflowId)
    return db.transaction(async (tx) => {
      const [active] = await tx
        .select({ id: workflow.id, name: workflow.name })
        .from(workflow)
        .where(
          and(
            eq(workflow.id, context.workflowId),
            eq(workflow.workspaceId, context.workspaceId),
            isNull(workflow.archivedAt)
          )
        )
        .limit(1)
        .for('update')
      if (!active) throw new OrchestrationError('not_found', 'Workflow not found')

      const normalized = await loadWorkflowFromNormalizedTables(context.workflowId, tx)
      if (!normalized) {
        throw new OrchestrationError(
          'validation',
          `Workflow ${context.workflowId} has no normalized state`
        )
      }
      const currentState: WorkflowState = {
        blocks: normalized.blocks as Record<string, BlockState>,
        edges: normalized.edges || [],
        loops: normalized.loops || {},
        parallels: normalized.parallels || {},
        lastSaved: Date.now(),
      }
      const targetBlock = currentState.blocks[input.blockId]
      if (!targetBlock) {
        throw new OrchestrationError(
          'not_found',
          `Block ${input.blockId} not found in workflow ${context.workflowId}`
        )
      }
      if (isBlockProtected(input.blockId, currentState.blocks)) {
        throw new OrchestrationError(
          'locked',
          `Block ${input.blockId} is locked or inside a locked container and cannot be updated`
        )
      }
      if (input.enabled && hasDisabledAncestor(input.blockId, currentState.blocks)) {
        throw new OrchestrationError(
          'validation',
          `Cannot enable block ${input.blockId} while one of its parent containers is disabled. Enable the parent first.`
        )
      }

      const affectedBlockIds = new Set<string>([input.blockId])
      if (targetBlock.type === 'loop' || targetBlock.type === 'parallel') {
        for (const descendantId of findDescendants(input.blockId, currentState.blocks)) {
          if (!isBlockProtected(descendantId, currentState.blocks)) {
            affectedBlockIds.add(descendantId)
          }
        }
      }
      if (targetBlock.enabled === input.enabled) {
        return {
          changed: false,
          workflowName: active.name,
          affectedBlockIds: [input.blockId],
          state: currentState,
        }
      }

      const nextBlocks = { ...currentState.blocks }
      for (const blockId of affectedBlockIds) {
        nextBlocks[blockId] = { ...nextBlocks[blockId], enabled: input.enabled }
      }
      const nextState: WorkflowState = {
        ...currentState,
        blocks: nextBlocks,
        lastSaved: Date.now(),
      }
      const saveResult = await saveWorkflowToNormalizedTables(context.workflowId, nextState, tx)
      if (!saveResult.success) {
        throw new Error(saveResult.error || 'Failed to save workflow state')
      }
      const [updated] = await tx
        .update(workflow)
        .set({ lastSynced: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(workflow.id, context.workflowId),
            eq(workflow.workspaceId, context.workspaceId),
            isNull(workflow.archivedAt)
          )
        )
        .returning({ id: workflow.id })
      if (!updated) throw new OrchestrationError('not_found', 'Workflow not found')
      return {
        changed: true,
        workflowName: active.name,
        affectedBlockIds: [...affectedBlockIds],
        state: nextState,
      }
    })
  },
  projectAudit: ({ input, context, result }) =>
    result.changed
      ? {
          action: AuditAction.WORKFLOW_UPDATED,
          resourceType: AuditResourceType.WORKFLOW,
          resourceId: context.workflowId,
          resourceName: result.workflowName,
          description: `${input.enabled ? 'Enabled' : 'Disabled'} workflow block "${input.blockId}"`,
          metadata: {
            op: 'set_block_enabled',
            blockId: input.blockId,
            enabled: input.enabled,
            affectedBlockIds: result.affectedBlockIds,
            source: 'copilot',
          },
        }
      : [],
  afterSuccess: ({ context, result }) =>
    result.changed ? notifyWorkflowUpdated(context.workflowId) : undefined,
})
