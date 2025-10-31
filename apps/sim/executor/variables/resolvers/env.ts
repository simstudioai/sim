/**
 * Env Resolver
 *
 * Resolves references to environment variables: {{env.VAR_NAME}}
 * - Looks up environment variables from execution context
 * - Returns the variable value or original reference if not found
 */

import { createLogger } from '@/lib/logs/console/logger'
import { REFERENCE } from '@/executor/consts'
import type { ResolutionContext, Resolver } from './reference'

const logger = createLogger('EnvResolver')

export class EnvResolver implements Resolver {
  canResolve(reference: string): boolean {
    return (
      reference.startsWith(REFERENCE.ENV_VAR_START) && reference.endsWith(REFERENCE.ENV_VAR_END)
    )
  }

  resolve(reference: string, context: ResolutionContext): any {
    const varName = reference.substring(
      REFERENCE.ENV_VAR_START.length,
      reference.length - REFERENCE.ENV_VAR_END.length
    )

    const value = context.executionContext.environmentVariables?.[varName]

    if (value === undefined) {
      logger.debug('Environment variable not found, returning original reference', { varName })
      return reference
    }

    return value
  }
}
