import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
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

export class VariablesBlockHandler implements BlockHandler {
  canHandle(block: SerializedBlock): boolean {
    const canHandle = block.metadata?.id === BlockType.VARIABLES
    return canHandle
  }

  async execute(
    ctx: ExecutionContext,
    block: SerializedBlock,
    inputs: Record<string, any>
  ): Promise<BlockOutput> {
    try {
      if (!ctx.workflowVariables) {
        ctx.workflowVariables = {}
      }

      const assignments = this.parseAssignments(inputs.variables)

      const output: Record<string, any> = {}

      for (const assignment of assignments) {
        const existingEntry =
          getWorkflowVariableEntry(ctx.workflowVariables, assignment.variableId) ??
          Object.entries(ctx.workflowVariables).find(([_, v]) => v.name === assignment.variableName)
        const value = await this.compactAssignmentValue(ctx, assignment.value)

        if (existingEntry?.[1]) {
          const [id, variable] = existingEntry
          setWorkflowVariableEntry(ctx.workflowVariables, id, {
            ...variable,
            value,
          })
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

  private parseAssignments(
    assignmentsInput: any
  ): Array<{ variableId?: string; variableName: string; type: string; value: any }> {
    const result: Array<{ variableId?: string; variableName: string; type: string; value: any }> =
      []

    if (!assignmentsInput || !Array.isArray(assignmentsInput)) {
      return result
    }

    for (const assignment of assignmentsInput) {
      if (assignment?.variableName?.trim()) {
        const name = assignment.variableName.trim()
        const type = assignment.type || 'string'
        const value = this.parseValueByType(assignment.value, type, name)

        result.push({
          variableId: assignment.variableId,
          variableName: name,
          type,
          value,
        })
      }
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
