import { db } from '@sim/db'
import { account, webhook, workflow, workflowDeploymentVersion } from '@sim/db/schema'
import type { Logger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { parseRetryAfter } from '@sim/utils/retry'
import { and, eq, isNull, ne, or, sql } from 'drizzle-orm'
import { resolveSystemBillingAttribution } from '@/lib/billing/core/billing-attribution'
import { checkIngestionUsageLimits } from '@/lib/billing/core/usage-gate-cache'
import {
  getOAuthToken,
  refreshAccessTokenIfNeeded,
  resolveOAuthAccountId,
  resolveServiceAccountToken,
} from '@/lib/oauth/credential-service'
import { deliverableWebhookPredicate } from '@/lib/webhooks/delivery-predicate'
import type { WebhookRecord, WorkflowRecord } from '@/lib/webhooks/polling/types'
import { MAX_CONSECUTIVE_FAILURES } from '@/triggers/constants'

/** Concurrency limit for parallel webhook processing. Standardized across all providers. */
export const CONCURRENCY = 10

/** Outcome of one webhook's poll; `skipped` polls fetched nothing and changed no state. */
export type PollOutcome = 'success' | 'failure' | 'skipped'

/** Wait after one failed poll; doubles with each further consecutive failure. */
const POLL_BACKOFF_BASE_MS = 60_000
const POLL_BACKOFF_MAX_MS = 60 * 60_000
/**
 * The next cron tick lands a little under one interval after the failed poll
 * recorded `lastFailedAt`, so a window is honored this much early rather than
 * costing a whole extra tick.
 */
const POLL_TICK_TOLERANCE_MS = 30_000
/** Ceiling on a source's own `Retry-After`, so a hostile feed cannot park a trigger for days. */
const POLL_RETRY_AFTER_MAX_MS = 24 * 60 * 60_000

/** `providerConfig` key holding the earliest time a rate-limited source may be fetched again. */
export const POLL_RETRY_AFTER_CONFIG_KEY = 'pollRetryAfter'

/**
 * When a failing webhook may next be polled, or null when it may poll now.
 * Derived from the consecutive-failure count the pollers already keep, plus the
 * source's last `Retry-After`, so a feed that keeps failing is fetched on an
 * exponential schedule instead of every minute.
 */
export function getPollBackoffUntil(
  webhookRecord: Pick<WebhookRecord, 'failedCount' | 'lastFailedAt' | 'providerConfig'>,
  now: number
): number | null {
  const failedCount = webhookRecord.failedCount ?? 0
  const lastFailedAt = webhookRecord.lastFailedAt?.getTime()
  const backoffUntil =
    failedCount > 0 && lastFailedAt !== undefined
      ? lastFailedAt +
        Math.min(POLL_BACKOFF_BASE_MS * 2 ** (failedCount - 1), POLL_BACKOFF_MAX_MS) -
        POLL_TICK_TOLERANCE_MS
      : 0

  const config = webhookRecord.providerConfig as Record<string, unknown> | null
  const retryAfterValue = config?.[POLL_RETRY_AFTER_CONFIG_KEY]
  const retryAfter = typeof retryAfterValue === 'string' ? Date.parse(retryAfterValue) : Number.NaN
  const retryAfterUntil = Number.isNaN(retryAfter) ? 0 : retryAfter

  const until = Math.max(backoffUntil, retryAfterUntil)
  return until > now ? until : null
}

/**
 * A source answered a poll's fetch with a non-2xx status. `retryAfterMs` is the
 * wait it asked for, from `Retry-After` or a Telegram-style `FLOOD_WAIT_<seconds>`.
 */
export class PollFetchError extends Error {
  readonly status: number
  readonly retryAfterMs: number | null

  constructor(message: string, status: number, retryAfterMs: number | null) {
    super(message)
    this.name = 'PollFetchError'
    this.status = status
    this.retryAfterMs = retryAfterMs
  }
}

/** Reads the wait a rate-limited response asked for, in milliseconds. */
export function readPollRetryAfterMs(retryAfterHeader: string | null, body: string): number | null {
  const fromHeader = parseRetryAfter(retryAfterHeader, POLL_RETRY_AFTER_MAX_MS)
  if (fromHeader !== null) return fromHeader
  const floodWait = /FLOOD_WAIT_(\d+)/.exec(body)
  return floodWait ? Math.min(Number(floodWait[1]) * 1000, POLL_RETRY_AFTER_MAX_MS) : null
}

/**
 * Records a failed poll and logs it once: a source's own 4xx at `warn`, since
 * it is the source's answer rather than a fault here, everything else at `error`.
 * A `Retry-After` is persisted so {@link getPollBackoffUntil} honors it.
 */
export async function recordPollFailure(
  webhookId: string,
  error: unknown,
  message: string,
  logger: Logger
): Promise<void> {
  if (error instanceof PollFetchError && error.status >= 400 && error.status < 500) {
    logger.warn(message, {
      status: error.status,
      error: error.message,
      ...(error.retryAfterMs !== null ? { retryAfterMs: error.retryAfterMs } : {}),
    })
  } else {
    logger.error(message, { error: getErrorMessage(error, 'Unknown error') })
  }

  if (error instanceof PollFetchError && error.retryAfterMs !== null) {
    await updateWebhookProviderConfig(
      webhookId,
      { [POLL_RETRY_AFTER_CONFIG_KEY]: new Date(Date.now() + error.retryAfterMs).toISOString() },
      logger
    )
  }
  await markWebhookFailed(webhookId, logger)
}

/**
 * Answers, once per workspace per poll tick, whether the workspace's payer is
 * refused by the usage gate. A refused payer's webhooks are skipped before any
 * fetch: nothing is consumed or marked seen, and no failure is counted, so the
 * items are delivered once the payer is back under their limit and the trigger
 * is never auto-disabled over billing state.
 *
 * Reads through the usage gate's refusal-caching policy: no person waits on a
 * poll, so a raised limit applies within that cache's TTL. A failed read lets
 * the poll proceed, and execution preprocessing remains the authoritative gate.
 */
export function createPayerUsageGate(
  logger: Logger
): (workspaceId: string | null) => Promise<boolean> {
  const verdicts = new Map<string, Promise<boolean>>()

  const readVerdict = async (workspaceId: string): Promise<boolean> => {
    try {
      const attribution = await resolveSystemBillingAttribution(workspaceId)
      const usage = await checkIngestionUsageLimits(attribution)
      if (usage.isExceeded) {
        logger.info(`Skipping polls for workspace ${workspaceId}: payer is over its usage limit`, {
          reason: usage.reason,
        })
      }
      return usage.isExceeded
    } catch (error) {
      logger.warn(`Payer usage check failed for workspace ${workspaceId}; polling anyway`, {
        error: getErrorMessage(error),
      })
      return false
    }
  }

  return (workspaceId) => {
    if (!workspaceId) return Promise.resolve(false)
    let verdict = verdicts.get(workspaceId)
    if (!verdict) {
      verdict = readVerdict(workspaceId)
      verdicts.set(workspaceId, verdict)
    }
    return verdict
  }
}

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
      .where(
        and(eq(webhook.id, webhookId), or(isNull(webhook.failedCount), ne(webhook.failedCount, 0)))
      )
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
        deliverableWebhookPredicate(webhook),
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
  processFn: (entry: { webhook: WebhookRecord; workflow: WorkflowRecord }) => Promise<PollOutcome>,
  logger: Logger
): Promise<{ successCount: number; failureCount: number; skippedCount: number }> {
  const running: Promise<void>[] = []
  let successCount = 0
  let failureCount = 0
  let skippedCount = 0

  for (const entry of entries) {
    const promise: Promise<void> = processFn(entry)
      .then((result) => {
        if (result === 'success') {
          successCount++
        } else if (result === 'skipped') {
          skippedCount++
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

  return { successCount, failureCount, skippedCount }
}

/**
 * Atomically merge provider-specific config fields into `webhook.provider_config`.
 * Each provider passes its specific state updates (historyId, lastSeenGuids, etc.).
 *
 * The column is `json` (not `jsonb`), which has no merge operators, so the existing
 * value is cast to `jsonb` for the `||`/`-` merge and the result cast back to `json`
 * for storage. Casting is required — a bare `jsonb` expression cannot be assigned to
 * the `json` column.
 */
export async function updateWebhookProviderConfig(
  webhookId: string,
  configUpdates: Record<string, unknown>,
  logger: Logger
): Promise<void> {
  try {
    const defined: Record<string, unknown> = {}
    const removedKeys: string[] = []
    for (const [key, value] of Object.entries(configUpdates)) {
      if (value === undefined) removedKeys.push(key)
      else defined[key] = value
    }

    const merged = sql`COALESCE(${webhook.providerConfig}::jsonb, '{}'::jsonb) || ${JSON.stringify(defined)}::jsonb`
    const nextConfig =
      removedKeys.length > 0
        ? sql`(${merged}) - ARRAY[${sql.join(
            removedKeys.map((key) => sql`${key}`),
            sql`, `
          )}]::text[]`
        : merged

    await db
      .update(webhook)
      .set({
        providerConfig: sql`(${nextConfig})::json`,
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
  requestId: string
): Promise<string> {
  const metadata = webhookData.providerConfig as Record<string, unknown> | null
  const credentialId = metadata?.credentialId as string | undefined
  const userId = metadata?.userId as string | undefined

  if (!credentialId && !userId) {
    throw new Error(`Missing credential info for webhook ${webhookData.id}`)
  }

  let accessToken: string | null = null

  if (credentialId) {
    const resolved = await resolveOAuthAccountId(credentialId)
    if (!resolved) {
      throw new Error(
        `Failed to resolve OAuth account for credential ${credentialId}, webhook ${webhookData.id}`
      )
    }
    if (resolved.credentialType === 'service_account' && resolved.credentialId) {
      const { accessToken: serviceAccountToken } = await resolveServiceAccountToken(
        resolved.credentialId,
        resolved.providerId
      )
      return serviceAccountToken
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
