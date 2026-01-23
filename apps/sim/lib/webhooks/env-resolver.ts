import { getEffectiveDecryptedEnv } from '@/lib/environment/utils'
import { resolveEnvVarReferences } from '@/executor/utils/reference-validation'

/**
 * Recursively resolves all environment variable references in a configuration object.
 * Supports both exact matches (`{{VAR_NAME}}`) and embedded patterns (`https://{{HOST}}/path`).
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
  return resolveEnvVarReferences(config, envVars, { deep: true }) as Record<string, any>
}
