import { createLogger } from '@sim/logger'
import type { NextRequest } from 'next/server'
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

/** System-managed fields that shouldn't trigger recreation */
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
  'setupCompleted',
  'userId',
])

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

  const allKeys = new Set([...Object.keys(previousConfig), ...Object.keys(nextConfig)])

  for (const key of allKeys) {
    if (SYSTEM_MANAGED_FIELDS.has(key)) continue

    const prevVal = previousConfig[key]
    const nextVal = nextConfig[key]

    const prevStr = typeof prevVal === 'object' ? JSON.stringify(prevVal ?? null) : prevVal
    const nextStr = typeof nextVal === 'object' ? JSON.stringify(nextVal ?? null) : nextVal

    if (prevStr !== nextStr) {
      return true
    }
  }

  return false
}

export async function createExternalWebhookSubscription(
  request: NextRequest,
  webhookData: Record<string, unknown>,
  workflow: Record<string, unknown>,
  userId: string,
  requestId: string
): Promise<ExternalSubscriptionResult> {
  const provider = webhookData.provider as string
  const providerConfig = (webhookData.providerConfig as Record<string, unknown>) || {}
  const handler = getProviderHandler(provider)

  if (!handler.createSubscription) {
    return { updatedProviderConfig: providerConfig, externalSubscriptionCreated: false }
  }

  const result = await handler.createSubscription({
    webhook: webhookData,
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
 * Errors are swallowed — cleanup failure should not block webhook deletion.
 */
export async function cleanupExternalWebhook(
  webhook: Record<string, unknown>,
  workflow: Record<string, unknown>,
  requestId: string
): Promise<void> {
  const provider = webhook.provider as string
  const handler = getProviderHandler(provider)

  if (!handler.deleteSubscription) {
    return
  }

  try {
    await handler.deleteSubscription({ webhook, workflow, requestId })
  } catch (error) {
    logger.warn(`[${requestId}] Error cleaning up external webhook (non-fatal)`, {
      provider,
      webhookId: webhook.id,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
