import { isRecordLike } from '@sim/utils/object'
import { getEffectiveDecryptedEnv, getExecutionEnvironment } from '@/lib/environment/utils'
import { resolveEnvVarReferences } from '@/executor/utils/reference-validation'

export interface WebhookEnvResolutionOptions {
  envVars?: Record<string, string>
  onResolved?: (name: string, value: string) => void
}

/**
 * Resolves the env a webhook config is read against when there is no caller to
 * speak of — an inbound delivery or a provider's URL-validation challenge.
 *
 * Splits the two identities the same way the executor does: personal variables
 * stay with the workflow owner who authored the config, and workspace variables
 * authorize against the workspace's billing account, which is the identity such
 * a run acts as. Reading both slices as the owner made a webhook stop resolving
 * its own signing secret the moment that person left the workspace — silently,
 * because every caller here treats an unresolvable secret as a rejected request
 * rather than an error.
 *
 * Falls back to owner-as-both when the workspace has no billing account or no
 * workspace is involved at all, which is exactly the previous behavior.
 */
export async function resolveBackgroundWebhookEnv(
  workflowOwnerUserId: string,
  workspaceId?: string
): Promise<Record<string, string>> {
  if (!workspaceId) {
    return getEffectiveDecryptedEnv(workflowOwnerUserId)
  }

  const { getWorkspaceBilledAccountUserId } = await import('@/lib/billing/core/billing-attribution')
  const billedAccountUserId = await getWorkspaceBilledAccountUserId(workspaceId)
  if (!billedAccountUserId) {
    return getEffectiveDecryptedEnv(workflowOwnerUserId, workspaceId)
  }

  const snapshot = await getExecutionEnvironment(
    workflowOwnerUserId,
    billedAccountUserId,
    workspaceId
  )
  return { ...snapshot.personalDecrypted, ...snapshot.workspaceDecrypted }
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
