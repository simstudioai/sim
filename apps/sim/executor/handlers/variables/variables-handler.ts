import { createLogger } from '@/lib/logs/console/logger'
import type { BlockOutput } from '@/blocks/types'
import { BlockType } from '@/executor/consts'
import type { BlockHandler, ExecutionContext } from '@/executor/types'
import type { SerializedBlock } from '@/serializer/types'

const logger = createLogger('VariablesBlockHandler')

export class VariablesBlockHandler implements BlockHandler {
  canHandle(block: SerializedBlock): boolean {
    const canHandle = block.metadata?.id === BlockType.VARIABLES
    logger.info(`VariablesBlockHandler.canHandle: ${canHandle}`, {
      blockId: block.id,
      metadataId: block.metadata?.id,
      expectedType: BlockType.VARIABLES,
    })
    return canHandle
  }

  async execute(
    block: SerializedBlock,
    inputs: Record<string, any>,
    context: ExecutionContext
  ): Promise<BlockOutput> {
    logger.info(`Executing variables block: ${block.id}`, {
      blockName: block.metadata?.name,
      inputsKeys: Object.keys(inputs),
      variablesInput: inputs.variables,
    })

    try {
      // Initialize workflowVariables if not present
      if (!context.workflowVariables) {
        context.workflowVariables = {}
      }

      // Parse variable assignments from the custom input
      const assignments = this.parseAssignments(inputs.variables)

      // Update context.workflowVariables with new values
      for (const assignment of assignments) {
        // Find the variable by ID or name
        const existingEntry = assignment.variableId
          ? [assignment.variableId, context.workflowVariables[assignment.variableId]]
          : Object.entries(context.workflowVariables).find(
              ([_, v]) => v.name === assignment.variableName
            )

        if (existingEntry?.[1]) {
          // Update existing variable value
          const [id, variable] = existingEntry
          context.workflowVariables[id] = {
            ...variable,
            value: assignment.value,
          }
        } else {
          logger.warn(`Variable "${assignment.variableName}" not found in workflow variables`)
        }
      }

      logger.info('Variables updated', {
        updatedVariables: assignments.map((a) => a.variableName),
        allVariables: Object.values(context.workflowVariables).map((v: any) => v.name),
        updatedValues: Object.entries(context.workflowVariables).map(([id, v]: [string, any]) => ({
          id,
          name: v.name,
          value: v.value,
        })),
      })

      // Return variable values directly at the root for easy access
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
    // Handle null/undefined - allow empty values
    if (value === null || value === undefined || value === '') {
      if (type === 'number') return 0
      if (type === 'boolean') return false
      if (type === 'array') return []
      if (type === 'object') return {}
      return ''
    }

    // Handle plain and string types (plain is for backward compatibility)
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
        // Validate that arrays are actually arrays
        if (type === 'array' && !Array.isArray(value)) {
          throw new Error(
            `Invalid array value for variable "${variableName || 'unknown'}": expected an array, got an object`
          )
        }
        // Validate that objects are not arrays
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
          // Validate parsed type matches expected type
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

    // Default: return value as-is
    return value
  }
}
