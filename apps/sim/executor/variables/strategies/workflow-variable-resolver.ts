/**
 * WorkflowVariableResolver
 * 
 * Resolves references to workflow variables: <variable.name>
 * - Looks up variables by name or ID
 * - Returns the variable's value
 */

import { createLogger } from '@/lib/logs/console/logger'
import type { ReferenceResolver, ResolutionContext } from './reference-resolver'

const logger = createLogger('WorkflowVariableResolver')

const REFERENCE_START = '<'
const REFERENCE_END = '>'
const PATH_DELIMITER = '.'
const VARIABLE_PREFIX = 'variable'

export class WorkflowVariableResolver implements ReferenceResolver {
  constructor(private workflowVariables: Record<string, any>) {}

  canResolve(reference: string): boolean {
    if (!this.isReference(reference)) {
      return false
    }

    const content = this.extractContent(reference)
    const parts = content.split(PATH_DELIMITER)

    if (parts.length === 0) {
      return false
    }

    const [type] = parts
    return type === VARIABLE_PREFIX
  }

  resolve(reference: string, context: ResolutionContext): any {
    const content = this.extractContent(reference)
    const parts = content.split(PATH_DELIMITER)

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
    return value.startsWith(REFERENCE_START) && value.endsWith(REFERENCE_END)
  }

  private extractContent(reference: string): string {
    return reference.substring(REFERENCE_START.length, reference.length - REFERENCE_END.length)
  }
}

