import { db } from '@sim/db'
import { webhook } from '@sim/db/schema'
import { isRecordLike } from '@sim/utils/object'
import { and, eq, isNull } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'
import { LEGACY_SLACK_CUSTOM_BOT_INGRESS_MODE } from '@/lib/webhooks/slack-custom-ingress-constants'
import { buildSlackCustomBotRequestUrl, buildWebhookTriggerUrl } from '@/triggers/webhook-url'

/** The public URL one live webhook registration receives events on, and the block it feeds. */
export interface DeployedWebhookUrl {
  blockId: string | null
  provider: string | null
  url: string
}

/**
 * The delivery URL of one live registration, or null when its provider
 * delivers through a shared endpoint with no per-workflow URL.
 *
 * Two shapes carry a URL. A path-addressed row is reached at
 * `/api/webhooks/trigger/<path>` — the URL the block's `webhookUrlDisplay`
 * renders in the editor and reads back as `null` through the API, because it
 * is computed client-side. A Slack custom bot has no path: its events arrive
 * on the credential-scoped Request URL and fan out by routing key, so the URL
 * the Slack app must be configured with is that one. Shared-app providers such
 * as the native Slack and TikTok triggers route by tenant key on a single
 * endpoint and advertise nothing.
 */
export function resolveDeployedWebhookUrl(row: {
  path: string | null
  provider: string | null
  providerConfig: unknown
}): string | null {
  if (row.path) return buildWebhookTriggerUrl(row.path)
  if (row.provider !== 'slack' || !isRecordLike(row.providerConfig)) return null
  if (row.providerConfig.ingressMode !== LEGACY_SLACK_CUSTOM_BOT_INGRESS_MODE) return null
  const credentialId = row.providerConfig.credentialId
  return typeof credentialId === 'string' && credentialId.length > 0
    ? buildSlackCustomBotRequestUrl(credentialId)
    : null
}

/**
 * The delivery URL of every webhook the workflow's live deployment registered.
 *
 * Reads the rows the inbound dispatcher itself matches — active and not
 * archived — so what is published is exactly what will be served, whether the
 * row came from the stable registration protocol or the legacy save path.
 */
export async function listDeployedWebhookUrls(
  workflowId: string,
  tx?: DbOrTx
): Promise<DeployedWebhookUrl[]> {
  const rows = await (tx ?? db)
    .select({
      blockId: webhook.blockId,
      provider: webhook.provider,
      path: webhook.path,
      providerConfig: webhook.providerConfig,
    })
    .from(webhook)
    .where(
      and(
        eq(webhook.workflowId, workflowId),
        eq(webhook.isActive, true),
        isNull(webhook.archivedAt)
      )
    )
    .orderBy(webhook.blockId)

  const urls: DeployedWebhookUrl[] = []
  for (const row of rows) {
    const url = resolveDeployedWebhookUrl(row)
    if (url) urls.push({ blockId: row.blockId, provider: row.provider, url })
  }
  return urls
}
