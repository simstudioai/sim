import { getEffectiveDecryptedEnv } from '@/lib/environment/utils'
import { resolveEnvVarReferences } from '@/executor/utils/reference-validation'

/**
 * Recursively resolves all environment variable references in a configuration object.
 * Supports both exact matches (`{{VAR_NAME}}`) and embedded patterns (`https://{{HOST}}/path`).
 *
 * Uses `deep: true` because webhook configs have nested structures that need full resolution.
 *
 * @param config - Configuration object that may contain env var references
 * @param userId - User ID to fetch environment variables for
 * @param workspaceId - Optional workspace ID for workspace-specific env vars
 * @returns A new object with all env var references resolved
 */
export async function resolveEnvVarsInObject<T extends Record<string, unknown>>(
  config: T,
  userId: string,
  workspaceId?: string
): Promise<T> {
  const envVars = await getEffectiveDecryptedEnv(userId, workspaceId)
  return resolveEnvVarReferences(config, envVars, { deep: true }) as T
}
