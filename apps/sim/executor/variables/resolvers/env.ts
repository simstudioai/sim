import { createLogger } from '@sim/logger'
import { extractEnvVarName, isEnvVarReference } from '@/executor/constants'
import type { ResolutionContext, Resolver } from '@/executor/variables/resolvers/reference'

const logger = createLogger('EnvResolver')

export class EnvResolver implements Resolver {
  canResolve(reference: string): boolean {
    return isEnvVarReference(reference)
  }

  resolve(reference: string, context: ResolutionContext): any {
    const varName = extractEnvVarName(reference)

    const value = context.executionContext.environmentVariables?.[varName]
    if (value === undefined) {
      return reference
    }
    if (Object.hasOwn(context.executionContext.environmentVariables, varName)) {
      context.executionContext.resolvedSecretTraceRegistry?.recordResolvedAtInputPath(
        varName,
        value,
        context.inputPath
      )
    }
    return value
  }
}
