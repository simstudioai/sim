import { db } from '@sim/db'
import {
  account,
  credentialSet,
  webhook,
  workflow,
  workflowDeploymentVersion,
} from '@sim/db/schema'
import type { Logger } from '@sim/logger'
import { and, eq, isNull, or, sql } from 'drizzle-orm'
import { isOrganizationOnTeamOrEnterprisePlan } from '@/lib/billing'
import type { WebhookRecord, WorkflowRecord } from '@/lib/webhooks/polling/types'
import {
  getOAuthToken,
  refreshAccessTokenIfNeeded,
  resolveOAuthAccountId,
} from '@/app/api/auth/oauth/utils'
import { MAX_CONSECUTIVE_FAILURES } from '@/triggers/constants'

/** Concurrency limit for parallel webhook processing. Standardized across all providers. */
export const CONCURRENCY = 10

/** Increment the webhook's failure count. Auto-disables after MAX_CONSECUTIVE_FAILURES. */
export async function markWebhookFailed(webhookId: string, logger: Logger): Promise<void> {
  try {
    const result = await db
      .update(webhook)
      .set({
        failedCount: sql`COALESCE(${webhook.failedCount}, 0) + 1`,
        lastFailedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(webhook.id, webhookId))
      .returning({ failedCount: webhook.failedCount })

    const newFailedCount = result[0]?.failedCount || 0
    if (newFailedCount >= MAX_CONSECUTIVE_FAILURES) {
      await db
        .update(webhook)
        .set({
          isActive: false,
          updatedAt: new Date(),
        })
        .where(eq(webhook.id, webhookId))

      logger.warn(
        `Webhook ${webhookId} auto-disabled after ${MAX_CONSECUTIVE_FAILURES} consecutive failures`
      )
    }
  } catch (err) {
    logger.error(`Failed to mark webhook ${webhookId} as failed:`, err)
  }
}

/** Reset the webhook's failure count on successful poll. */
export async function markWebhookSuccess(webhookId: string, logger: Logger): Promise<void> {
  try {
    await db
      .update(webhook)
      .set({
        failedCount: 0,
        updatedAt: new Date(),
      })
      .where(eq(webhook.id, webhookId))
  } catch (err) {
    logger.error(`Failed to mark webhook ${webhookId} as successful:`, err)
  }
}

/** Fetch all active webhooks for a provider, joined with their workflow. */
export async function fetchActiveWebhooks(
  provider: string
): Promise<{ webhook: WebhookRecord; workflow: WorkflowRecord }[]> {
  const rows = await db
    .select({ webhook, workflow })
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
        eq(webhook.provider, provider),
        eq(webhook.isActive, true),
        isNull(webhook.archivedAt),
        eq(workflow.isDeployed, true),
        isNull(workflow.archivedAt),
        or(
          eq(webhook.deploymentVersionId, workflowDeploymentVersion.id),
          and(isNull(workflowDeploymentVersion.id), isNull(webhook.deploymentVersionId))
        )
      )
    )

  return rows
}

/**
 * Run an async function over entries with bounded concurrency.
 * Returns aggregate success/failure counts.
 */
export async function runWithConcurrency(
  entries: { webhook: WebhookRecord; workflow: WorkflowRecord }[],
  processFn: (entry: {
    webhook: WebhookRecord
    workflow: WorkflowRecord
  }) => Promise<'success' | 'failure'>,
  logger: Logger
): Promise<{ successCount: number; failureCount: number }> {
  const running: Promise<void>[] = []
  let successCount = 0
  let failureCount = 0

  for (const entry of entries) {
    const promise: Promise<void> = processFn(entry)
      .then((result) => {
        if (result === 'success') {
          successCount++
        } else {
          failureCount++
        }
      })
      .catch((err) => {
        logger.error('Unexpected error in webhook processing:', err)
        failureCount++
      })
      .finally(() => {
        const idx = running.indexOf(promise)
        if (idx !== -1) running.splice(idx, 1)
      })

    running.push(promise)

    if (running.length >= CONCURRENCY) {
      await Promise.race(running)
    }
  }

  await Promise.allSettled(running)

  return { successCount, failureCount }
}

/**
 * Read-merge-write pattern for updating provider-specific config fields.
 * Each provider passes its specific state updates (historyId, lastSeenGuids, etc.).
 */
export async function updateWebhookProviderConfig(
  webhookId: string,
  configUpdates: Record<string, unknown>,
  logger: Logger
): Promise<void> {
  try {
    const result = await db.select().from(webhook).where(eq(webhook.id, webhookId))
    const existingConfig = (result[0]?.providerConfig as Record<string, unknown>) || {}

    await db
      .update(webhook)
      .set({
        providerConfig: {
          ...existingConfig,
          ...configUpdates,
        } as Record<string, unknown>,
        updatedAt: new Date(),
      })
      .where(eq(webhook.id, webhookId))
  } catch (err) {
    logger.error(`Failed to update webhook ${webhookId} config:`, err)
  }
}

/**
 * Resolve OAuth credentials for a webhook. Shared by Gmail and Outlook.
 * Returns the access token or throws on failure.
 */
export async function resolveOAuthCredential(
  webhookData: WebhookRecord,
  oauthProvider: string,
  requestId: string,
  logger: Logger
): Promise<string> {
  const metadata = webhookData.providerConfig as Record<string, unknown> | null
  const credentialId = metadata?.credentialId as string | undefined
  const userId = metadata?.userId as string | undefined
  const credentialSetId = (webhookData.credentialSetId as string | undefined) ?? undefined

  if (!credentialId && !userId) {
    throw new Error(`Missing credential info for webhook ${webhookData.id}`)
  }

  if (credentialSetId) {
    const [cs] = await db
      .select({ organizationId: credentialSet.organizationId })
      .from(credentialSet)
      .where(eq(credentialSet.id, credentialSetId))
      .limit(1)

    if (cs?.organizationId) {
      const hasAccess = await isOrganizationOnTeamOrEnterprisePlan(cs.organizationId)
      if (!hasAccess) {
        logger.error(
          `[${requestId}] Polling Group plan restriction: Your current plan does not support Polling Groups. Upgrade to Team or Enterprise to use this feature.`,
          {
            webhookId: webhookData.id,
            credentialSetId,
            organizationId: cs.organizationId,
          }
        )
        throw new Error('Polling Group plan restriction')
      }
    }
  }

  let accessToken: string | null = null

  if (credentialId) {
    const resolved = await resolveOAuthAccountId(credentialId)
    if (!resolved) {
      throw new Error(
        `Failed to resolve OAuth account for credential ${credentialId}, webhook ${webhookData.id}`
      )
    }
    const rows = await db.select().from(account).where(eq(account.id, resolved.accountId)).limit(1)
    if (!rows.length) {
      throw new Error(`Credential ${credentialId} not found for webhook ${webhookData.id}`)
    }
    const ownerUserId = rows[0].userId
    accessToken = await refreshAccessTokenIfNeeded(resolved.accountId, ownerUserId, requestId)
  } else if (userId) {
    accessToken = await getOAuthToken(userId, oauthProvider)
  }

  if (!accessToken) {
    throw new Error(`Failed to get ${oauthProvider} access token for webhook ${webhookData.id}`)
  }

  return accessToken
}
