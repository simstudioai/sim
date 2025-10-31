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
    ctx: ExecutionContext,
    block: SerializedBlock,
    inputs: Record<string, any>
  ): Promise<BlockOutput> {
    logger.info(`Executing variables block: ${block.id}`, {
      blockName: block.metadata?.name,
      inputsKeys: Object.keys(inputs),
      variablesInput: inputs.variables,
    })

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

      logger.info('Variables updated', {
        updatedVariables: assignments.map((a) => a.variableName),
        allVariables: Object.values(ctx.workflowVariables).map((v: any) => v.name),
        updatedValues: Object.entries(ctx.workflowVariables).map(([id, v]: [string, any]) => ({
          id,
          name: v.name,
          value: v.value,
        })),
      })

      // Return assignments as a JSON object mapping variable names to values
      const assignmentsOutput: Record<string, any> = {}
      for (const assignment of assignments) {
        assignmentsOutput[assignment.variableName] = assignment.value
      }

      return {
        assignments: assignmentsOutput,
      }
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
        const value = this.parseValueByType(assignment.value, type)

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

  private parseValueByType(value: any, type: string): any {
    // Handle null/undefined early
    if (value === null || value === undefined) {
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
        const num = Number(value)
        return Number.isNaN(num) ? 0 : num
      }
      return 0
    }

    if (type === 'boolean') {
      if (typeof value === 'boolean') return value
      if (typeof value === 'string') {
        return value.toLowerCase() === 'true'
      }
      return Boolean(value)
    }

    if (type === 'object' || type === 'array') {
      if (typeof value === 'object' && value !== null) {
        return value
      }
      if (typeof value === 'string' && value.trim()) {
        try {
          return JSON.parse(value)
        } catch {
          return type === 'array' ? [] : {}
        }
      }
      return type === 'array' ? [] : {}
    }

    // Default: return value as-is
    return value
  }
}
