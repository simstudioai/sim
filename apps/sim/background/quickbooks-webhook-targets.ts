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
import { parseQuickBooksAccountId } from '@/lib/oauth/quickbooks'
import { deliverableWebhookPredicate } from '@/lib/webhooks/delivery-predicate'

const logger = createLogger('QuickBooksWebhookTargets')
const ACCOUNT_ID_UUID_LIKE_SUFFIX = '________-____-____-____-____________'

export const QUICKBOOKS_WEBHOOK_TARGET_PAGE_SIZE = 100

export interface QuickBooksWebhookTargetPage {
  hasMore: boolean
  nextCursor: string | null
  targets: Array<{
    webhook: typeof webhook.$inferSelect
    workflow: typeof workflow.$inferSelect
  }>
}

function escapeLikePattern(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
}

/** Resolve one bounded page of active trigger targets for exactly one QuickBooks company. */
export async function findQuickBooksWebhookTargetPage(
  realmId: string,
  requestId: string,
  afterWebhookId?: string
): Promise<QuickBooksWebhookTargetPage> {
  if (!realmId) return { hasMore: false, nextCursor: null, targets: [] }

  const rows = await db
    .select({ accountId: account.accountId, webhookId: webhook.id, webhook, workflow })
    .from(account)
    .innerJoin(
      credential,
      and(
        eq(credential.accountId, account.id),
        eq(credential.type, 'oauth'),
        eq(credential.providerId, 'quickbooks')
      )
    )
    .innerJoin(
      webhook,
      and(
        eq(webhookCredentialIdExpression(webhook.providerConfig), credential.id),
        eq(webhook.provider, 'quickbooks'),
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
        eq(account.providerId, 'quickbooks'),
        like(
          account.accountId,
          `quickbooks:${escapeLikePattern(realmId)}:%-${ACCOUNT_ID_UUID_LIKE_SUFFIX}`
        ),
        or(
          eq(webhook.deploymentVersionId, workflowDeploymentVersion.id),
          and(isNull(workflowDeploymentVersion.id), isNull(webhook.deploymentVersionId))
        ),
        afterWebhookId ? gt(webhook.id, afterWebhookId) : undefined
      )
    )
    .orderBy(asc(webhook.id))
    .limit(QUICKBOOKS_WEBHOOK_TARGET_PAGE_SIZE)

  const targets = rows
    .filter((row) => {
      try {
        return parseQuickBooksAccountId(row.accountId).realmId === realmId
      } catch {
        return false
      }
    })
    .map(({ webhook: webhookRecord, workflow: workflowRecord }) => ({
      webhook: webhookRecord,
      workflow: workflowRecord,
    }))
  const nextCursor = rows.at(-1)?.webhookId ?? null
  const hasMore = rows.length === QUICKBOOKS_WEBHOOK_TARGET_PAGE_SIZE

  logger.info(`[${requestId}] Resolved QuickBooks webhook target page`, {
    hasMore,
    targetCount: targets.length,
  })
  return { hasMore, nextCursor, targets }
}
