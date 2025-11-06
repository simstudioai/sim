import { createLogger } from '@/lib/logs/console/logger'
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
      if (v.name === variableName || v.id === variableName) {
        let value = v.value

        logger.debug('Resolving workflow variable', {
          variableName,
          originalType: typeof value,
          declaredType: v.type,
          originalValue: value,
        })

        if (v.type === 'boolean' && typeof value === 'string') {
          const lower = value.toLowerCase().trim()
          if (lower === 'true') value = true
          else if (lower === 'false') value = false
        }

        return value
      }
    }

    return undefined
  }
}
