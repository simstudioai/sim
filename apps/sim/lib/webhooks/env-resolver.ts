import { isRecordLike } from '@sim/utils/object'
import { getEffectiveDecryptedEnv } from '@/lib/environment/utils'
import { resolveEnvVarReferences } from '@/executor/utils/reference-validation'

export interface WebhookEnvResolutionOptions {
  envVars?: Record<string, string>
  onResolved?: (name: string, value: string) => void
}

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
  workspaceId?: string,
  options: WebhookEnvResolutionOptions = {}
): Promise<T> {
  const envVars = options.envVars ?? (await getEffectiveDecryptedEnv(userId, workspaceId))
  return resolveEnvVarReferences(config, envVars, {
    deep: true,
    onResolved: options.onResolved,
  }) as T
}

/**
 * Normalizes webhook provider config into a plain object for runtime resolution.
 */
export function normalizeWebhookProviderConfig(providerConfig: unknown): Record<string, unknown> {
  if (isRecordLike(providerConfig)) {
    return providerConfig as Record<string, unknown>
  }

  return {}
}

/**
 * Resolves environment variable references inside a webhook provider config object.
 */
export async function resolveWebhookProviderConfig(
  providerConfig: unknown,
  userId: string,
  workspaceId?: string,
  options: WebhookEnvResolutionOptions = {}
): Promise<Record<string, unknown>> {
  return resolveEnvVarsInObject(
    normalizeWebhookProviderConfig(providerConfig),
    userId,
    workspaceId,
    options
  )
}

/**
 * Clones a webhook-like record with its provider config resolved for runtime use.
 */
export async function resolveWebhookRecordProviderConfig<T extends { providerConfig?: unknown }>(
  webhookRecord: T,
  userId: string,
  workspaceId?: string,
  options: WebhookEnvResolutionOptions = {}
): Promise<T & { providerConfig: Record<string, unknown> }> {
  return {
    ...webhookRecord,
    providerConfig: await resolveWebhookProviderConfig(
      webhookRecord.providerConfig,
      userId,
      workspaceId,
      options
    ),
  }
}
