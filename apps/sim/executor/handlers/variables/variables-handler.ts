import { createLogger } from '@/lib/logs/console/logger'
import type { BlockOutput } from '@/blocks/types'
import { BlockType } from '@/executor/consts'
import type { BlockHandler, ExecutionContext } from '@/executor/types'
import type { SerializedBlock } from '@/serializer/types'

const logger = createLogger('VariablesBlockHandler')

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

      for (const assignment of assignments) {
        const existingEntry = assignment.variableId
          ? [assignment.variableId, ctx.workflowVariables[assignment.variableId]]
          : Object.entries(ctx.workflowVariables).find(
              ([_, v]) => v.name === assignment.variableName
            )

        if (existingEntry?.[1]) {
          const [id, variable] = existingEntry
          ctx.workflowVariables[id] = {
            ...variable,
            value: assignment.value,
          }
        } else {
          logger.warn(`Variable "${assignment.variableName}" not found in workflow variables`)
        }
      }

      const output: Record<string, any> = {}
      for (const assignment of assignments) {
        output[assignment.variableName] = assignment.value
      }

      return output
    } catch (error: any) {
      logger.error('Variables block execution failed:', error)
      throw new Error(`Variables block execution failed: ${error.message}`)
    }
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
      if (typeof value === 'object' && value !== null) {
        if (type === 'array' && !Array.isArray(value)) {
          throw new Error(
            `Invalid array value for variable "${variableName || 'unknown'}": expected an array, got an object`
          )
        }
        if (type === 'object' && Array.isArray(value)) {
          throw new Error(
            `Invalid object value for variable "${variableName || 'unknown'}": expected an object, got an array`
          )
        }
        return value
      }
      if (typeof value === 'string' && value.trim()) {
        try {
          const parsed = JSON.parse(value)
          if (type === 'array' && !Array.isArray(parsed)) {
            throw new Error(
              `Invalid array value for variable "${variableName || 'unknown'}": parsed value is not an array`
            )
          }
          if (type === 'object' && (Array.isArray(parsed) || typeof parsed !== 'object')) {
            throw new Error(
              `Invalid object value for variable "${variableName || 'unknown'}": parsed value is not an object`
            )
          }
          return parsed
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
