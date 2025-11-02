import { createLogger } from '@/lib/logs/console/logger'
import { extractEnvVarName, isEnvVarReference } from '@/executor/consts'
import type { ResolutionContext, Resolver } from './reference'

const logger = createLogger('EnvResolver')

export class EnvResolver implements Resolver {
  canResolve(reference: string): boolean {
    return isEnvVarReference(reference)
  }

  resolve(reference: string, context: ResolutionContext): any {
    const varName = extractEnvVarName(reference)

    const value = context.executionContext.environmentVariables?.[varName]
    if (value === undefined) {
      logger.debug('Environment variable not found, returning original reference', { varName })
      return reference
    }
    return value
  }
}
