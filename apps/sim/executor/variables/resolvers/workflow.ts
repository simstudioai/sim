import { createLogger } from '@sim/logger'
import { isLargeArrayManifest } from '@/lib/execution/payloads/large-array-manifest-metadata'
import { assertNoLargeValueRefs, isLargeValueRef } from '@/lib/execution/payloads/large-value-ref'
import { VariableManager } from '@/lib/workflows/variables/variable-manager'
import { isReference, normalizeName, parseReferencePath, REFERENCE } from '@/executor/constants'
import {
  type AsyncPathNavigator,
  navigatePath,
  type ResolutionContext,
  type Resolver,
  splitLeadingBracketPath,
} from '@/executor/variables/resolvers/reference'
import type { VariableType } from '@/stores/variables/types'

const logger = createLogger('WorkflowResolver')

export class WorkflowResolver implements Resolver {
  constructor(
    private workflowVariables: Record<string, any>,
    private navigatePathAsync?: AsyncPathNavigator
  ) {}

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

    const [_, rawVariableName, ...rawPathParts] = parts
    const { property: variableName, pathParts: bracketPathParts } =
      splitLeadingBracketPath(rawVariableName)
    const pathParts = [...bracketPathParts, ...rawPathParts]
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
        value = this.resolveVariableValue(v.value, normalizedType, variableName)

        if (pathParts.length > 0) {
          return navigatePath(value, pathParts, {
            allowLargeValueRefs: context.allowLargeValueRefs,
            executionContext: context.executionContext,
          })
        }

        if (!context.allowLargeValueRefs) {
          assertNoLargeValueRefs(value)
        }
        return value
      }
    }

    return undefined
  }

  async resolveAsync(reference: string, context: ResolutionContext): Promise<any> {
    const parts = parseReferencePath(reference)
    if (parts.length < 2) {
      logger.warn('Invalid variable reference - missing variable name', { reference })
      return undefined
    }

    const [_, rawVariableName, ...rawPathParts] = parts
    const { property: variableName, pathParts: bracketPathParts } =
      splitLeadingBracketPath(rawVariableName)
    const pathParts = [...bracketPathParts, ...rawPathParts]
    const normalizedRefName = normalizeName(variableName)
    const workflowVars = context.executionContext.workflowVariables || this.workflowVariables

    for (const varObj of Object.values(workflowVars)) {
      const v = varObj as any
      if (!v) continue

      const normalizedVarName = v.name ? normalizeName(v.name) : ''
      if (normalizedVarName === normalizedRefName || v.id === variableName) {
        const normalizedType = (v.type === 'string' ? 'plain' : v.type) || 'plain'
        let value: any
        value = this.resolveVariableValue(v.value, normalizedType, variableName)

        if (pathParts.length > 0) {
          return this.navigatePathAsync
            ? this.navigatePathAsync(value, pathParts, context)
            : navigatePath(value, pathParts, {
                allowLargeValueRefs: context.allowLargeValueRefs,
                executionContext: context.executionContext,
              })
        }

        if (!context.allowLargeValueRefs) {
          assertNoLargeValueRefs(value)
        }
        return value
      }
    }

    return undefined
  }

  private resolveVariableValue(
    value: any,
    normalizedType: VariableType,
    variableName: string
  ): any {
    if (isLargeValueRef(value) || isLargeArrayManifest(value)) {
      return value
    }

    try {
      return VariableManager.resolveForExecution(value, normalizedType)
    } catch (error) {
      logger.warn('Failed to resolve workflow variable, returning raw value', {
        variableName,
        error: (error as Error).message,
      })
      return value
    }
  }
}
