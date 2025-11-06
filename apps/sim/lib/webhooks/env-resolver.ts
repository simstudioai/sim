import { getEffectiveDecryptedEnv } from '@/lib/environment/utils'
import { createLogger } from '@/lib/logs/console/logger'
import { extractEnvVarName, isEnvVarReference } from '@/executor/consts'

const logger = createLogger('EnvResolver')

/**
 * Resolves environment variable references in a string value
 * Uses the same helper functions as the executor's EnvResolver
 *
 * @param value - The string that may contain env var references
 * @param envVars - Object containing environment variable key-value pairs
 * @returns The resolved string with env vars replaced
 */
function resolveEnvVarInString(value: string, envVars: Record<string, string>): string {
  if (!isEnvVarReference(value)) {
    return value
  }

  const varName = extractEnvVarName(value)
  const resolvedValue = envVars[varName]

  if (resolvedValue === undefined) {
    logger.warn(`Environment variable not found: ${varName}`)
    return value // Return original if not found
  }

  logger.debug(`Resolved environment variable: ${varName}`)
  return resolvedValue
}

/**
 * Recursively resolves all environment variable references in a configuration object
 * Supports the pattern: {{VAR_NAME}}
 *
 * @param config - Configuration object that may contain env var references
 * @param userId - User ID to fetch environment variables for
 * @param workspaceId - Optional workspace ID for workspace-specific env vars
 * @returns A new object with all env var references resolved
 */
export async function resolveEnvVarsInObject(
  config: Record<string, any>,
  userId: string,
  workspaceId?: string
): Promise<Record<string, any>> {
  const envVars = await getEffectiveDecryptedEnv(userId, workspaceId)

  const resolved = { ...config }

  function resolveValue(value: any): any {
    if (typeof value === 'string') {
      return resolveEnvVarInString(value, envVars)
    }
    if (Array.isArray(value)) {
      return value.map(resolveValue)
    }
    if (value !== null && typeof value === 'object') {
      const resolvedObj: Record<string, any> = {}
      for (const [key, val] of Object.entries(value)) {
        resolvedObj[key] = resolveValue(val)
      }
      return resolvedObj
    }
    return value
  }

  for (const [key, value] of Object.entries(resolved)) {
    resolved[key] = resolveValue(value)
  }

  return resolved
}
