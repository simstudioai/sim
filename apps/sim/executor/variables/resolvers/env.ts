/**
 * Env Resolver
 * 
 * Resolves references to environment variables: {{env.VAR_NAME}}
 * - Looks up environment variables from execution context
 * - Returns the variable value or original reference if not found
 */

import { createLogger } from '@/lib/logs/console/logger'
import type { Resolver, ResolutionContext } from './reference'

const logger = createLogger('EnvResolver')

const ENV_VAR_START = '{{'
const ENV_VAR_END = '}}'

export class EnvResolver implements Resolver {
  canResolve(reference: string): boolean {
    return reference.startsWith(ENV_VAR_START) && reference.endsWith(ENV_VAR_END)
  }

  resolve(reference: string, context: ResolutionContext): any {
    const varName = reference.substring(ENV_VAR_START.length, reference.length - ENV_VAR_END.length)

    const value = context.executionContext.environmentVariables?.[varName]

    if (value === undefined) {
      logger.debug('Environment variable not found, returning original reference', { varName })
      return reference
    }

    return value
  }
}

