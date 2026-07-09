import { account, credential, db, webhook, workflow, workflowDeploymentVersion } from '@sim/db'
import { createLogger } from '@sim/logger'
import { and, eq, inArray, isNull, like, or } from 'drizzle-orm'
import { tiktokOpenIdFromAccountId } from '@/lib/webhooks/providers/tiktok'

const logger = createLogger('TikTokWebhookFanout')

function escapeLikePattern(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
}

/**
 * TikTok OAuth stores account.accountId as `${open_id}-${uuid}` (see auth.ts).
 * Match webhook `user_openid` to those rows via prefix, then resolve credentials
 * and active TikTok webhook configs whose providerConfig.credentialId matches.
 */
export async function findTikTokWebhooksForOpenId(
  userOpenId: string,
  requestId: string
): Promise<
  Array<{ webhook: typeof webhook.$inferSelect; workflow: typeof workflow.$inferSelect }>
> {
  if (!userOpenId) {
    return []
  }

  const likePattern = `${escapeLikePattern(userOpenId)}-%`
  const accountRows = await db
    .select({ id: account.id, accountId: account.accountId })
    .from(account)
    .where(and(eq(account.providerId, 'tiktok'), like(account.accountId, likePattern)))

  const accounts = accountRows.filter(
    (row) => tiktokOpenIdFromAccountId(row.accountId) === userOpenId
  )

  if (accounts.length === 0) {
    logger.info(`[${requestId}] No TikTok accounts matched user_openid`, {
      userOpenIdPrefix: userOpenId.slice(0, 12),
    })
    return []
  }

  const accountIds = accounts.map((row) => row.id)
  const credentials = await db
    .select({ id: credential.id })
    .from(credential)
    .where(and(eq(credential.type, 'oauth'), inArray(credential.accountId, accountIds)))

  if (credentials.length === 0) {
    logger.info(`[${requestId}] No TikTok credentials for matched accounts`, {
      accountCount: accounts.length,
    })
    return []
  }

  const credentialIds = new Set(credentials.map((row) => row.id))

  const results = await db
    .select({
      webhook: webhook,
      workflow: workflow,
    })
    .from(webhook)
    .innerJoin(workflow, eq(webhook.workflowId, workflow.id))
    .leftJoin(
      workflowDeploymentVersion,
      and(
        eq(workflowDeploymentVersion.workflowId, workflow.id),
        eq(workflowDeploymentVersion.isActive, true)
      )
    )
    .where(
      and(
        eq(webhook.provider, 'tiktok'),
        eq(webhook.isActive, true),
        isNull(webhook.archivedAt),
        isNull(workflow.archivedAt),
        or(
          eq(webhook.deploymentVersionId, workflowDeploymentVersion.id),
          and(isNull(workflowDeploymentVersion.id), isNull(webhook.deploymentVersionId))
        )
      )
    )

  const matched = results.filter((row) => {
    const config = (row.webhook.providerConfig as Record<string, unknown> | null) ?? {}
    const credentialId = config.credentialId
    return typeof credentialId === 'string' && credentialIds.has(credentialId)
  })

  logger.info(`[${requestId}] TikTok fan-out matched webhooks`, {
    userOpenIdPrefix: userOpenId.slice(0, 12),
    accountCount: accounts.length,
    credentialCount: credentials.length,
    webhookCount: matched.length,
  })

  return matched
}
