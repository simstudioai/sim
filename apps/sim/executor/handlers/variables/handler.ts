import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { toRecord, toRecordOrNull } from '@sim/utils/object'
import { parseLargeExecutionValue } from '@/lib/execution/payloads/large-execution-value'
import { compactWorkflowVariableValue } from '@/lib/execution/payloads/serializer'
import type { BlockOutput } from '@/blocks/types'
import { BlockType } from '@/executor/constants'
import type { BlockHandler, ExecutionContext } from '@/executor/types'
import type { SerializedBlock } from '@/serializer/types'

const logger = createLogger('VariablesBlockHandler')

function setOutputValue(output: Record<string, any>, key: string, value: any): void {
  Object.defineProperty(output, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  })
}

function getWorkflowVariableEntry(
  workflowVariables: Record<string, any>,
  variableId: string | undefined
): [string, any] | undefined {
  if (!variableId || !Object.hasOwn(workflowVariables, variableId)) {
    return undefined
  }
  return [variableId, workflowVariables[variableId]]
}

function setWorkflowVariableEntry(
  workflowVariables: Record<string, any>,
  id: string,
  value: any
): void {
  Object.defineProperty(workflowVariables, id, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  })
}

function setWorkflowVariableProvenance(
  provenanceByVariableId: NonNullable<
    ExecutionContext['workflowVariableResolvedSecretTraceProvenance']
  >,
  id: string,
  provenance: NonNullable<ExecutionContext['workflowVariableResolvedSecretTraceProvenance']>[string]
): void {
  Object.defineProperty(provenanceByVariableId, id, {
    value: provenance,
    enumerable: true,
    configurable: true,
    writable: true,
  })
}

interface AssignmentTarget {
  name: string
  type: string
}

function readTrimmedString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

/**
 * The variable an assignment row writes: the one it names, else the one its `variableId`
 * selects. A row that omits `type` takes the target variable's own type, so a programmatic
 * `{ variableName: 'count', value: 1 }` stays a number instead of becoming the string `'1'`.
 */
function resolveAssignmentTarget(
  assignment: Record<string, unknown>,
  workflowVariables: Record<string, unknown>
): AssignmentTarget | undefined {
  const variableId = readTrimmedString(assignment.variableId)
  const selected = toRecordOrNull(getWorkflowVariableEntry(workflowVariables, variableId)?.[1])
  const name = readTrimmedString(assignment.variableName) ?? readTrimmedString(selected?.name)
  if (!name) return undefined
  const target =
    selected ??
    Object.values(workflowVariables)
      .map(toRecordOrNull)
      .find((variable) => variable?.name === name)
  const type = readTrimmedString(assignment.type) ?? readTrimmedString(target?.type) ?? 'string'
  return { name, type }
}

function hasAssignedValue(value: unknown): boolean {
  if (value === undefined || value === null) return false
  return typeof value !== 'string' || value.trim() !== ''
}

export class VariablesBlockHandler implements BlockHandler {
  canHandle(block: SerializedBlock): boolean {
    const canHandle = block.metadata?.id === BlockType.VARIABLES
    return canHandle
  }

  async execute(
    ctx: ExecutionContext,
    _block: SerializedBlock,
    inputs: Record<string, any>
  ): Promise<BlockOutput> {
    try {
      if (!ctx.workflowVariables) {
        ctx.workflowVariables = {}
      }

      const assignments = this.parseAssignments(inputs.variables, ctx.workflowVariables)

      const output: Record<string, any> = {}

      for (const assignment of assignments) {
        const existingEntry =
          getWorkflowVariableEntry(ctx.workflowVariables, assignment.variableId) ??
          Object.entries(ctx.workflowVariables).find(([_, v]) => v.name === assignment.variableName)
        const provenance = ctx.resolvedSecretTraceRegistry?.exportCommittedProvenanceForValue(
          assignment.value
        )
        const value = await this.compactAssignmentValue(ctx, assignment.value)

        if (existingEntry?.[1]) {
          const [id, variable] = existingEntry
          setWorkflowVariableEntry(ctx.workflowVariables, id, {
            ...variable,
            value,
          })
          if (provenance) {
            ctx.workflowVariableResolvedSecretTraceProvenance ??= {}
            setWorkflowVariableProvenance(
              ctx.workflowVariableResolvedSecretTraceProvenance,
              id,
              provenance
            )
          } else if (ctx.workflowVariableResolvedSecretTraceProvenance) {
            delete ctx.workflowVariableResolvedSecretTraceProvenance[id]
          }
        } else {
          logger.warn(`Variable "${assignment.variableName}" not found in workflow variables`)
        }
        setOutputValue(output, assignment.variableName, value)
      }

      return output
    } catch (error) {
      const normalizedError = toError(error)
      logger.error('Variables block execution failed:', normalizedError)
      throw new Error(`Variables block execution failed: ${normalizedError.message}`)
    }
  }

  private async compactAssignmentValue(ctx: ExecutionContext, value: any): Promise<any> {
    return compactWorkflowVariableValue(value, {
      workspaceId: ctx.workspaceId,
      workflowId: ctx.workflowId,
      executionId: ctx.executionId,
      userId: ctx.userId,
      largeValueExecutionIds: ctx.largeValueExecutionIds,
      largeValueKeys: ctx.largeValueKeys,
      allowLargeValueWorkflowScope: ctx.allowLargeValueWorkflowScope,
    })
  }

  /**
   * Reads the block's assignment rows. A row targets the variable it names, or the one its
   * `variableId` selects. A row with neither is skipped while it is blank (the editor's empty
   * row), and fails the block when it carries a value, since that update would otherwise be
   * dropped without a trace.
   */
  private parseAssignments(
    assignmentsInput: unknown,
    workflowVariables: Record<string, unknown>
  ): Array<{ variableId?: string; variableName: string; type: string; value: any }> {
    const result: Array<{ variableId?: string; variableName: string; type: string; value: any }> =
      []

    if (!assignmentsInput || !Array.isArray(assignmentsInput)) {
      return result
    }

    for (const [index, row] of assignmentsInput.entries()) {
      const assignment = toRecord(row)
      const target = resolveAssignmentTarget(assignment, workflowVariables)
      if (!target) {
        if (hasAssignedValue(assignment.value)) {
          throw new Error(
            `Assignment ${index + 1} sets a value but names no variable. Select a workflow variable for it (variableName), or remove the row.`
          )
        }
        continue
      }
      const value = this.parseValueByType(assignment.value, target.type, target.name)

      result.push({
        variableId: readTrimmedString(assignment.variableId),
        variableName: target.name,
        type: target.type,
        value,
      })
    }

    return result
  }

  private parseValueByType(value: any, type: string, variableName?: string): any {
    const refValue = parseLargeExecutionValue(value)
    if (refValue !== undefined) {
      return refValue
    }

    if (value === null || value === undefined || value === '') {
      if (type === 'number') return 0
      if (type === 'boolean') return false
      if (type === 'array') return []
      if (type === 'object') return {}
      return ''
    }

    if (type === 'string' || type === 'plain') {
      return typeof value === 'string' ? value : String(value)
    }

    if (type === 'number') {
      if (typeof value === 'number') return value
      if (typeof value === 'string') {
        const trimmed = value.trim()
        if (trimmed === '') return 0
        const num = Number(trimmed)
        if (Number.isNaN(num)) {
          throw new Error(
            `Invalid number value for variable "${variableName || 'unknown'}": "${value}". Expected a valid number.`
          )
        }
        return num
      }
      throw new Error(
        `Invalid type for variable "${variableName || 'unknown'}": expected number, got ${typeof value}`
      )
    }

    if (type === 'boolean') {
      if (typeof value === 'boolean') return value
      if (typeof value === 'string') {
        const lower = value.toLowerCase().trim()
        if (lower === 'true') return true
        if (lower === 'false') return false
        throw new Error(
          `Invalid boolean value for variable "${variableName || 'unknown'}": "${value}". Expected "true" or "false".`
        )
      }
      return Boolean(value)
    }

    if (type === 'object' || type === 'array') {
      // If value is already an object or array, accept it as-is
      // The type hint is for UI purposes and string parsing, not runtime validation
      if (typeof value === 'object' && value !== null) {
        return value
      }
      // If it's a string, try to parse it as JSON
      if (typeof value === 'string' && value.trim()) {
        try {
          const parsed = JSON.parse(value)
          // Accept any valid JSON object or array
          if (typeof parsed === 'object' && parsed !== null) {
            return parsed
          }
          throw new Error(
            `Invalid JSON for variable "${variableName || 'unknown'}": parsed value is not an object or array`
          )
        } catch (error: any) {
          throw new Error(
            `Invalid JSON for variable "${variableName || 'unknown'}": ${error.message}`
          )
        }
      }
      return type === 'array' ? [] : {}
    }

    return value
  }
}
