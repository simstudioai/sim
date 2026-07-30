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
import { and, asc, eq, gt, isNull, like, or } from 'drizzle-orm'
import { deliverableWebhookPredicate } from '@/lib/webhooks/delivery-predicate'

const logger = createLogger('TikTokWebhookTargets')
const ACCOUNT_ID_UUID_SUFFIX = /-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ACCOUNT_ID_UUID_LIKE_SUFFIX = '________-____-____-____-____________'

export const TIKTOK_WEBHOOK_TARGET_PAGE_SIZE = 100

export interface TikTokWebhookTarget {
  webhook: typeof webhook.$inferSelect
  workflow: typeof workflow.$inferSelect
}

export interface TikTokWebhookTargetPage {
  hasMore: boolean
  nextCursor: string | null
  targets: TikTokWebhookTarget[]
}

function escapeLikePattern(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
}

function openIdFromAccountId(accountId: string): string {
  return accountId.replace(ACCOUNT_ID_UUID_SUFFIX, '')
}

/**
 * Resolves one deterministic page of active webhook targets for the TikTok background ingress.
 * The workflow-workspace equality prevents cross-tenant event routing, while the webhook ID cursor
 * keeps each query and retained result set bounded without offset drift.
 */
export async function findTikTokWebhookTargetPage(
  userOpenId: string,
  requestId: string,
  afterWebhookId?: string
): Promise<TikTokWebhookTargetPage> {
  if (!userOpenId) {
    return { hasMore: false, nextCursor: null, targets: [] }
  }

  const rows = await db
    .select({
      accountId: account.accountId,
      webhookId: webhook.id,
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
        like(account.accountId, `${escapeLikePattern(userOpenId)}-${ACCOUNT_ID_UUID_LIKE_SUFFIX}`),
        or(
          eq(webhook.deploymentVersionId, workflowDeploymentVersion.id),
          and(isNull(workflowDeploymentVersion.id), isNull(webhook.deploymentVersionId))
        ),
        afterWebhookId ? gt(webhook.id, afterWebhookId) : undefined
      )
    )
    .orderBy(asc(webhook.id))
    .limit(TIKTOK_WEBHOOK_TARGET_PAGE_SIZE)

  const targets = rows
    .filter((row) => openIdFromAccountId(row.accountId) === userOpenId)
    .map(({ webhook: webhookRecord, workflow: workflowRecord }) => ({
      webhook: webhookRecord,
      workflow: workflowRecord,
    }))
  const nextCursor = rows.at(-1)?.webhookId ?? null
  const hasMore = rows.length === TIKTOK_WEBHOOK_TARGET_PAGE_SIZE

  logger.info(`[${requestId}] Resolved TikTok webhook target page`, {
    hasMore,
    userOpenIdPrefix: userOpenId.slice(0, 12),
    targetCount: targets.length,
  })

  return { hasMore, nextCursor, targets }
}
