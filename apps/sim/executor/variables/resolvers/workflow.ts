import { createLogger } from '@sim/logger'
import { VariableManager } from '@/lib/workflows/variables/variable-manager'
import { isReference, normalizeName, parseReferencePath, REFERENCE } from '@/executor/constants'
import {
  navigatePath,
  type ResolutionContext,
  type Resolver,
} from '@/executor/variables/resolvers/reference'

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

    const [_, variableName, ...pathParts] = parts
    const normalizedRefName = normalizeName(variableName)

    const workflowVars = context.executionContext.workflowVariables || this.workflowVariables

    for (const varObj of Object.values(workflowVars)) {
      const v = varObj as any
      if (!v) continue

      // Match by normalized name or exact ID
      const normalizedVarName = v.name ? normalizeName(v.name) : ''
      if (normalizedVarName === normalizedRefName || v.id === variableName) {
        const normalizedType = (v.type === 'string' ? 'plain' : v.type) || 'plain'
        let value: any
        try {
          value = VariableManager.resolveForExecution(v.value, normalizedType)
        } catch (error) {
          logger.warn('Failed to resolve workflow variable, returning raw value', {
            variableName,
            error: (error as Error).message,
          })
          value = v.value
        }

        // If there are additional path parts, navigate deeper
        if (pathParts.length > 0) {
          return navigatePath(value, pathParts)
        }

        return value
      }
    }

    return undefined
  }
}
