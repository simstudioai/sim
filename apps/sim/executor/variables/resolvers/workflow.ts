/**
 * Workflow Resolver
 *
 * Resolves references to workflow variables: <variable.name>
 * - Looks up variables by name or ID
 * - Returns the variable's value
 */

import { createLogger } from '@/lib/logs/console/logger'
import { REFERENCE } from '@/executor/consts'
import type { ResolutionContext, Resolver } from './reference'

const logger = createLogger('WorkflowResolver')

export class WorkflowResolver implements Resolver {
  constructor(private workflowVariables: Record<string, any>) {}

  canResolve(reference: string): boolean {
    if (!this.isReference(reference)) {
      return false
    }

    const content = this.extractContent(reference)
    const parts = content.split(REFERENCE.PATH_DELIMITER)

    if (parts.length === 0) {
      return false
    }

    const [type] = parts
    return type === REFERENCE.PREFIX.VARIABLE
  }

  resolve(reference: string, context: ResolutionContext): any {
    const content = this.extractContent(reference)
    const parts = content.split(REFERENCE.PATH_DELIMITER)

    if (parts.length < 2) {
      logger.warn('Invalid variable reference - missing variable name', { reference })
      return undefined
    }

    const [_, variableName] = parts

    // Check execution context workflow variables first
    if (context.executionContext.workflowVariables) {
      for (const varObj of Object.values(context.executionContext.workflowVariables)) {
        const v = varObj as any
        if (v.name === variableName || v.id === variableName) {
          return v.value
        }
      }
    }

    // Check constructor workflow variables
    for (const varObj of Object.values(this.workflowVariables)) {
      const v = varObj as any
      if (v.name === variableName || v.id === variableName) {
        return v.value
      }
    }

    logger.debug('Workflow variable not found', { variableName })
    return undefined
  }

  /**
   * PRIVATE METHODS
   */

  private isReference(value: string): boolean {
    return value.startsWith(REFERENCE.START) && value.endsWith(REFERENCE.END)
  }

  private extractContent(reference: string): string {
    return reference.substring(REFERENCE.START.length, reference.length - REFERENCE.END.length)
  }
}
