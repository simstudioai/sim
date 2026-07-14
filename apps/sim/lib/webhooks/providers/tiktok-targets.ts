import {
  account,
  credential,
  db,
  webhook,
  webhookCredentialIdExpression,
  workflow,
  workflowDeploymentVersion,
} from '@sim/db'
import { createLogger } from '@sim/logger'
import { and, eq, isNull, like, or } from 'drizzle-orm'
import { deliverableWebhookPredicate } from '@/lib/webhooks/delivery-predicate'

const logger = createLogger('TikTokWebhookTargets')
const ACCOUNT_ID_UUID_SUFFIX = /-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface TikTokWebhookTarget {
  webhook: typeof webhook.$inferSelect
  workflow: typeof workflow.$inferSelect
}

function escapeLikePattern(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
}

function openIdFromAccountId(accountId: string): string {
  return accountId.replace(ACCOUNT_ID_UUID_SUFFIX, '')
}

/**
 * Resolves a TikTok user_openid to active webhook targets through the credential ID persisted in
 * providerConfig. The workflow-workspace equality prevents cross-tenant event routing.
 */
export async function findTikTokWebhookTargets(
  userOpenId: string,
  requestId: string
): Promise<TikTokWebhookTarget[]> {
  if (!userOpenId) return []

  const rows = await db
    .select({
      accountId: account.accountId,
      webhook,
      workflow,
    })
    .from(account)
    .innerJoin(
      credential,
      and(
        eq(credential.accountId, account.id),
        eq(credential.type, 'oauth'),
        eq(credential.providerId, 'tiktok')
      )
    )
    .innerJoin(
      webhook,
      and(
        eq(webhookCredentialIdExpression(webhook.providerConfig), credential.id),
        eq(webhook.provider, 'tiktok'),
        deliverableWebhookPredicate(webhook)
      )
    )
    .innerJoin(
      workflow,
      and(
        eq(workflow.id, webhook.workflowId),
        eq(workflow.workspaceId, credential.workspaceId),
        isNull(workflow.archivedAt)
      )
    )
    .leftJoin(
      workflowDeploymentVersion,
      and(
        eq(workflowDeploymentVersion.workflowId, workflow.id),
        eq(workflowDeploymentVersion.isActive, true)
      )
    )
    .where(
      and(
        eq(account.providerId, 'tiktok'),
        like(account.accountId, `${escapeLikePattern(userOpenId)}-%`),
        or(
          eq(webhook.deploymentVersionId, workflowDeploymentVersion.id),
          and(isNull(workflowDeploymentVersion.id), isNull(webhook.deploymentVersionId))
        )
      )
    )

  const targets = rows
    .filter((row) => openIdFromAccountId(row.accountId) === userOpenId)
    .map(({ webhook: webhookRecord, workflow: workflowRecord }) => ({
      webhook: webhookRecord,
      workflow: workflowRecord,
    }))

  logger.info(`[${requestId}] Resolved TikTok webhook targets`, {
    userOpenIdPrefix: userOpenId.slice(0, 12),
    webhookCount: targets.length,
  })

  return targets
}
