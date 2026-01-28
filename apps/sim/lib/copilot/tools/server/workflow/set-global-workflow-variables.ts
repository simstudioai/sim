import { db } from '@sim/db'
import { workflow } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'

const logger = createLogger('SetGlobalWorkflowVariablesServerTool')

const OperationItemSchema = z.object({
  operation: z.enum(['add', 'edit', 'delete']),
  name: z.string(),
  type: z.enum(['plain', 'number', 'boolean', 'array', 'object']).optional(),
  value: z.string().optional(),
})

export const SetGlobalWorkflowVariablesInput = z.object({
  workflowId: z.string(),
  operations: z.array(OperationItemSchema),
})

export const SetGlobalWorkflowVariablesResult = z.object({
  success: z.boolean(),
  message: z.string(),
  variables: z.record(z.unknown()),
})

export type SetGlobalWorkflowVariablesInputType = z.infer<typeof SetGlobalWorkflowVariablesInput>
export type SetGlobalWorkflowVariablesResultType = z.infer<typeof SetGlobalWorkflowVariablesResult>

function coerceValue(
  value: string | undefined,
  type?: 'plain' | 'number' | 'boolean' | 'array' | 'object'
): unknown {
  if (value === undefined) return value
  const t = type || 'plain'
  try {
    if (t === 'number') {
      const n = Number(value)
      if (Number.isNaN(n)) return value
      return n
    }
    if (t === 'boolean') {
      const v = String(value).trim().toLowerCase()
      if (v === 'true') return true
      if (v === 'false') return false
      return value
    }
    if (t === 'array' || t === 'object') {
      const parsed = JSON.parse(value)
      if (t === 'array' && Array.isArray(parsed)) return parsed
      if (t === 'object' && parsed && typeof parsed === 'object' && !Array.isArray(parsed))
        return parsed
      return value
    }
  } catch {
    // Fall through to return value as-is
  }
  return value
}

export const setGlobalWorkflowVariablesServerTool: BaseServerTool<
  SetGlobalWorkflowVariablesInputType,
  SetGlobalWorkflowVariablesResultType
> = {
  name: 'set_global_workflow_variables',
  async execute(args: unknown, _context?: { userId: string }) {
    const parsed = SetGlobalWorkflowVariablesInput.parse(args)
    const { workflowId, operations } = parsed

    logger.debug('Setting workflow variables', { workflowId, operationCount: operations.length })

    // Get current workflow variables
    const [wf] = await db
      .select({ variables: workflow.variables })
      .from(workflow)
      .where(eq(workflow.id, workflowId))
      .limit(1)

    if (!wf) {
      throw new Error(`Workflow not found: ${workflowId}`)
    }

    const currentVarsRecord = (wf.variables as Record<string, unknown>) || {}

    // Build mutable map by variable name
    const byName: Record<string, Record<string, unknown>> = {}
    Object.values(currentVarsRecord).forEach((v: unknown) => {
      if (v && typeof v === 'object' && 'id' in v && 'name' in v) {
        const variable = v as Record<string, unknown>
        byName[String(variable.name)] = variable
      }
    })

    // Apply operations in order
    for (const op of operations) {
      const key = String(op.name)
      const nextType = op.type || (byName[key]?.type as string) || 'plain'

      if (op.operation === 'delete') {
        delete byName[key]
        continue
      }

      const typedValue = coerceValue(
        op.value,
        nextType as 'plain' | 'number' | 'boolean' | 'array' | 'object'
      )

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
          // If editing a non-existent variable, create it
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
            ...(op.value !== undefined ? { value: typedValue } : {}),
          }
        }
      }
    }

    // Convert byName (keyed by name) to record keyed by ID for storage
    const variablesRecord: Record<string, unknown> = {}
    for (const v of Object.values(byName)) {
      variablesRecord[v.id as string] = v
    }

    // Update workflow variables
    await db.update(workflow).set({ variables: variablesRecord }).where(eq(workflow.id, workflowId))

    logger.info('Updated workflow variables', {
      workflowId,
      variableCount: Object.keys(byName).length,
    })

    return SetGlobalWorkflowVariablesResult.parse({
      success: true,
      message: 'Workflow variables updated',
      variables: byName,
    })
  },
}
