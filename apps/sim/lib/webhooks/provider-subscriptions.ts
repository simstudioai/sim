import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { omit } from '@sim/utils/object'
import type { NextRequest } from 'next/server'
import {
  resolveWebhookProviderConfig,
  resolveWebhookRecordProviderConfig,
} from '@/lib/webhooks/env-resolver'
import { getProviderHandler } from '@/lib/webhooks/providers'

const logger = createLogger('WebhookProviderSubscriptions')

type ExternalSubscriptionResult = {
  updatedProviderConfig: Record<string, unknown>
  externalSubscriptionCreated: boolean
}

type RecreateCheckInput = {
  previousProvider: string
  nextProvider: string
  previousConfig: Record<string, unknown>
  nextConfig: Record<string, unknown>
}

/** System-managed fields that should not trigger recreation. */
const SYSTEM_MANAGED_FIELDS = new Set([
  'externalId',
  'externalSubscriptionId',
  'eventTypes',
  'webhookTag',
  'webhookSecret',
  'signingSecret',
  'secretToken',
  'historyId',
  'lastCheckedTimestamp',
  'lastSeenGuids',
  'setupCompleted',
  'subscriptionExpiration',
  'userId',
])

/**
 * Returns the user-controlled projection used for stable registration identity.
 *
 * Provider-managed subscription metadata and mutable polling cursors are intentionally omitted.
 */
export function projectDesiredWebhookProviderConfig(
  providerConfig: Readonly<Record<string, unknown>>
): Record<string, unknown> {
  return omit(providerConfig, [...SYSTEM_MANAGED_FIELDS])
}

/** Returns true when user-controlled persisted webhook configuration changed. */
export function hasWebhookConfigChanged(
  previousConfig: Record<string, unknown>,
  nextConfig: Record<string, unknown>
): boolean {
  const allKeys = new Set([...Object.keys(previousConfig), ...Object.keys(nextConfig)])

  for (const key of allKeys) {
    if (SYSTEM_MANAGED_FIELDS.has(key)) continue

    const previousValue = previousConfig[key]
    const nextValue = nextConfig[key]
    const previousComparable =
      typeof previousValue === 'object' ? JSON.stringify(previousValue ?? null) : previousValue
    const nextComparable =
      typeof nextValue === 'object' ? JSON.stringify(nextValue ?? null) : nextValue

    if (previousComparable !== nextComparable) return true
  }

  return false
}

/**
 * Determine whether a webhook with provider-managed registration should be
 * recreated after its persisted provider config changes.
 *
 * Only user-controlled fields are considered; provider-managed fields such as
 * external IDs and generated secrets are ignored.
 */
export function shouldRecreateExternalWebhookSubscription({
  previousProvider,
  nextProvider,
  previousConfig,
  nextConfig,
}: RecreateCheckInput): boolean {
  const hasSubscription = (provider: string) => {
    const handler = getProviderHandler(provider)
    return Boolean(handler.createSubscription)
  }

  if (previousProvider !== nextProvider) {
    return hasSubscription(previousProvider) || hasSubscription(nextProvider)
  }

  if (!hasSubscription(nextProvider)) {
    return false
  }

  return hasWebhookConfigChanged(previousConfig, nextConfig)
}

/**
 * Ask the provider handler to create an external webhook subscription, if that
 * provider supports automatic registration.
 *
 * `providerConfig` may contain unresolved `{{ENV_VAR}}` references (e.g. an
 * API key field backed by an environment variable) — these are resolved here
 * before the provider call so deploy-triggered registration (this function is
 * also called from the async deployment outbox, not just the interactive
 * webhook-save route) behaves the same as a manual save. The persisted
 * `providerConfig` returned to the caller stays unresolved; only the
 * provider-managed fields from `result.providerConfigUpdates` get merged in.
 *
 * The returned provider-managed fields are merged back into `providerConfig`
 * by the caller.
 */
export async function createExternalWebhookSubscription(
  request: NextRequest,
  webhookData: Record<string, unknown>,
  workflow: Record<string, unknown>,
  userId: string,
  requestId: string,
  options: { signal?: AbortSignal } = {}
): Promise<ExternalSubscriptionResult> {
  const provider = webhookData.provider as string
  const providerConfig = (webhookData.providerConfig as Record<string, unknown>) || {}
  const handler = getProviderHandler(provider)

  if (!handler.createSubscription) {
    return { updatedProviderConfig: providerConfig, externalSubscriptionCreated: false }
  }

  const workspaceId = typeof workflow.workspaceId === 'string' ? workflow.workspaceId : undefined

  const resolvedProviderConfig = await resolveWebhookProviderConfig(
    providerConfig,
    userId,
    workspaceId
  )

  /**
   * Last abort check before the irreversible external call: a lease-expired
   * outbox handler must not mint a provider resource it can no longer
   * durably record.
   */
  options.signal?.throwIfAborted()

  const result = await handler.createSubscription({
    webhook: { ...webhookData, providerConfig: resolvedProviderConfig },
    workflow,
    userId,
    requestId,
    request,
  })

  if (!result) {
    return { updatedProviderConfig: providerConfig, externalSubscriptionCreated: false }
  }

  return {
    updatedProviderConfig: { ...providerConfig, ...result.providerConfigUpdates },
    externalSubscriptionCreated: true,
  }
}

/**
 * Clean up external webhook subscriptions for a webhook.
 * Resolves persisted `{{ENV_VAR}}` references with the workflow owner's
 * effective environment before invoking the provider.
 *
 * By default, cleanup failure is logged but non-fatal for legacy best-effort callers.
 * Deployment outbox cleanup passes `throwOnError` so provider failures stay retryable.
 */
export async function cleanupExternalWebhook(
  webhook: Record<string, unknown>,
  workflow: Record<string, unknown>,
  requestId: string,
  options: { throwOnError?: boolean } = {}
): Promise<void> {
  const provider = webhook.provider as string
  const handler = getProviderHandler(provider)

  if (!handler.deleteSubscription) {
    return
  }

  try {
    if (typeof workflow.userId !== 'string') {
      throw new Error('Cannot resolve webhook credentials without a workflow owner')
    }

    const workspaceId = typeof workflow.workspaceId === 'string' ? workflow.workspaceId : undefined
    const resolvedWebhook = await resolveWebhookRecordProviderConfig(
      webhook,
      workflow.userId,
      workspaceId
    )

    await handler.deleteSubscription({
      webhook: resolvedWebhook,
      workflow,
      requestId,
      strict: options.throwOnError,
    })
  } catch (error) {
    logger.warn(`[${requestId}] Error cleaning up external webhook (non-fatal)`, {
      provider,
      webhookId: webhook.id,
      error: toError(error).message,
    })
    if (options.throwOnError) {
      throw error
    }
  }
}
