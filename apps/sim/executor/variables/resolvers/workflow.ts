import { createLogger } from '@/lib/logs/console/logger'
import { VariableManager } from '@/lib/variables/variable-manager'
import { isReference, parseReferencePath, REFERENCE } from '@/executor/consts'
import type { ResolutionContext, Resolver } from '@/executor/variables/resolvers/reference'

const logger = createLogger('WorkflowResolver')

export class WorkflowResolver implements Resolver {
  constructor(private workflowVariables: Record<string, any>) {}

  canResolve(reference: string): boolean {
    if (!isReference(reference)) {
      return false
    }
    const parts = parseReferencePath(reference)
    if (parts.length === 0) {
      return false
    }
    const [type] = parts
    return type === REFERENCE.PREFIX.VARIABLE
  }

  resolve(reference: string, context: ResolutionContext): any {
    const parts = parseReferencePath(reference)
    if (parts.length < 2) {
      logger.warn('Invalid variable reference - missing variable name', { reference })
      return undefined
    }

    const [_, variableName] = parts

    const workflowVars = context.executionContext.workflowVariables || this.workflowVariables

    for (const varObj of Object.values(workflowVars)) {
      const v = varObj as any
      if (v && (v.name === variableName || v.id === variableName)) {
        const normalizedType = (v.type === 'string' ? 'plain' : v.type) || 'plain'
        try {
          return VariableManager.resolveForExecution(v.value, normalizedType)
        } catch (error) {
          logger.warn('Failed to resolve workflow variable, returning raw value', {
            variableName,
            error: (error as Error).message,
          })
          return v.value
        }
      }
    }

    return undefined
  }
}
