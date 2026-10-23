import { db } from '@sim/db'
import { account, webhook, workflow, workflowDeploymentVersion } from '@sim/db/schema'
import type { Logger } from '@sim/logger'
import { toNumberOrNull } from '@sim/utils/coerce'
import { toRecord } from '@sim/utils/object'
import { backoffWithJitter, parseRetryAfter } from '@sim/utils/retry'
import { and, eq, isNull, ne, or, sql } from 'drizzle-orm'
import { getDeterministicAdmissionRejectionCode } from '@/lib/core/admission/rejection'
import {
  getOAuthToken,
  refreshAccessTokenIfNeeded,
  resolveOAuthAccountId,
  resolveServiceAccountToken,
} from '@/lib/oauth/credential-service'
import { deliverableWebhookPredicate } from '@/lib/webhooks/delivery-predicate'
import type { PollOutcome, WebhookRecord, WorkflowRecord } from '@/lib/webhooks/polling/types'
import type { PolledWebhookEventResult } from '@/lib/webhooks/processor'
import { MAX_CONSECUTIVE_FAILURES } from '@/triggers/constants'

/** Concurrency limit for parallel webhook processing. Standardized across all providers. */
export const CONCURRENCY = 10

/** Wait after one failed source fetch; doubles with each further consecutive one. */
const POLL_BACKOFF_BASE_MS = 60_000
const POLL_BACKOFF_MAX_MS = 60 * 60_000
/** Absorbs cron jitter so a window ending just after a tick starts does not cost that tick. */
const POLL_TICK_TOLERANCE_MS = 10_000
/** Ceiling on a source's own `Retry-After`, so a hostile feed cannot park a trigger for days. */
const POLL_RETRY_AFTER_MAX_MS = 24 * 60 * 60_000

const POLL_BACKOFF_UNTIL_KEY = 'pollBackoffUntil'
const POLL_SOURCE_FAILURES_KEY = 'pollSourceFailures'

/**
 * Whether a webhook is inside the backoff window {@link recordPollSourceFailure}
 * set after its source fetch failed. Item-processing failures never set one.
 */
export function isPollBackedOff(providerConfig: unknown, now: number): boolean {
  const value = toRecord(providerConfig)[POLL_BACKOFF_UNTIL_KEY]
  const until = typeof value === 'string' ? Date.parse(value) : Number.NaN
  return !Number.isNaN(until) && until - POLL_TICK_TOLERANCE_MS > now
}

/**
 * Stops a poller's batch when execution admission refused an item for a reason
 * that holds until a person acts (`lib/core/admission/rejection`). Thrown from
 * inside the item's idempotency callback, so the refused item is not recorded as
 * processed. A poller rethrows it out of its batch only while no item in the
 * batch has completed, then returns `skipped` without advancing its cursor or
 * counting a failure. Once an item has completed, the refusal is handled as an
 * ordinary item failure, so the poller saves the completed work exactly as before.
 */
export class PollAdmissionRefusedError extends Error {
  constructor(result: Pick<PolledWebhookEventResult, 'statusCode' | 'error'>) {
    super(`Execution admission refused (${result.statusCode}): ${result.error}`)
    this.name = 'PollAdmissionRefusedError'
  }
}

/** Throws {@link PollAdmissionRefusedError} when a polled event was refused deterministically. */
export function throwIfAdmissionRefused(result: PolledWebhookEventResult): void {
  if (getDeterministicAdmissionRejectionCode(result)) throw new PollAdmissionRefusedError(result)
}

/** Logs a poll stopped by {@link PollAdmissionRefusedError} and reports it as skipped. */
export function skipAdmissionRefusedPoll(
  logger: Logger,
  requestId: string,
  webhookId: string
): 'skipped' {
  logger.info(
    `[${requestId}] Execution admission refused webhook ${webhookId}; left its items for a later poll`
  )
  return 'skipped'
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

/** The wait a rate-limited source asked for, from `Retry-After` or a `FLOOD_WAIT_<seconds>` body. */
export function readPollRetryAfterMs(retryAfterHeader: string | null, body: string): number | null {
  const fromHeader = parseRetryAfter(retryAfterHeader, POLL_RETRY_AFTER_MAX_MS)
  if (fromHeader !== null) return fromHeader
  const floodWait = /FLOOD_WAIT_(\d+)/.exec(body)
  return floodWait ? Math.min(Number(floodWait[1]) * 1000, POLL_RETRY_AFTER_MAX_MS) : null
}

/** Config updates that clear a recorded source backoff once a fetch succeeds. */
export function clearPollBackoff(providerConfig: unknown): Record<string, undefined> {
  const config = toRecord(providerConfig)
  return POLL_SOURCE_FAILURES_KEY in config || POLL_BACKOFF_UNTIL_KEY in config
    ? { [POLL_SOURCE_FAILURES_KEY]: undefined, [POLL_BACKOFF_UNTIL_KEY]: undefined }
    : {}
}

/**
 * Records a poll whose source fetch failed: logs it once (a source's own 4xx at
 * `warn`, anything else at `error`) and counts the failure. The next fetch waits
 * about 2^(n-1) minutes after n consecutive source failures, capped at an hour and
 * measured from the failed poll's start so a slow poll does not also cost the next
 * tick, or longer when the source's `Retry-After`, counted from its answer, asks.
 * Skipped polls do not count toward `MAX_CONSECUTIVE_FAILURES`, so a source failing
 * nonstop reaches the auto-disable after roughly four days instead of 100 minutes.
 */
export async function recordPollSourceFailure(
  webhookData: Pick<WebhookRecord, 'id' | 'providerConfig'>,
  pollStartedAt: number,
  error: unknown,
  message: string,
  logger: Logger
): Promise<void> {
  const retryAfterMs = error instanceof PollFetchError ? error.retryAfterMs : null
  if (error instanceof PollFetchError && error.status >= 400 && error.status < 500) {
    logger.warn(message, {
      status: error.status,
      error: error.message,
      ...(retryAfterMs !== null ? { retryAfterMs } : {}),
    })
  } else {
    logger.error(message, error)
  }

  const failures =
    (toNumberOrNull(toRecord(webhookData.providerConfig)[POLL_SOURCE_FAILURES_KEY]) ?? 0) + 1
  const backoffMs = backoffWithJitter(failures, null, {
    baseMs: POLL_BACKOFF_BASE_MS,
    maxMs: POLL_BACKOFF_MAX_MS,
  })
  const backoffUntil = Math.max(pollStartedAt + backoffMs, Date.now() + (retryAfterMs ?? 0))
  await updateWebhookProviderConfig(
    webhookData.id,
    {
      [POLL_SOURCE_FAILURES_KEY]: failures,
      [POLL_BACKOFF_UNTIL_KEY]: new Date(backoffUntil).toISOString(),
    },
    logger
  )
  await markWebhookFailed(webhookData.id, logger)
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
