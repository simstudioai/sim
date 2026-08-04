import {
  account,
  credential,
  db,
  webhook,
  webhookCredentialIdExpression,
  workflow,
  workflowDeploymentVersion,
} from '@sim/db'
import { and, eq, isNull, like, or } from 'drizzle-orm'
import { deliverableWebhookPredicate } from '@/lib/webhooks/delivery-predicate'

const ACCOUNT_ID_UUID_SUFFIX = /-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ACCOUNT_ID_UUID_LIKE_SUFFIX = '________-____-____-____-____________'

function escapeLikePattern(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
}

/**
 * Temporary rolling-deploy fallback for TikTok registrations written by old pods after the
 * routing-key backfill. Remove this after every writer stores `routingKey` and a final backfill runs.
 */
export async function findLegacyTikTokWebhooks(userOpenId: string) {
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
        isNull(webhook.routingKey),
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
        like(account.accountId, `${escapeLikePattern(userOpenId)}-${ACCOUNT_ID_UUID_LIKE_SUFFIX}`),
        or(
          eq(webhook.deploymentVersionId, workflowDeploymentVersion.id),
          and(isNull(workflowDeploymentVersion.id), isNull(webhook.deploymentVersionId))
        )
      )
    )

  return rows
    .filter(({ accountId }) => accountId.replace(ACCOUNT_ID_UUID_SUFFIX, '') === userOpenId)
    .map(({ webhook: webhookRecord, workflow: workflowRecord }) => ({
      webhook: webhookRecord,
      workflow: workflowRecord,
    }))
}
