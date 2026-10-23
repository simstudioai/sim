import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { isBillingEnabled } from '@/lib/core/config/env-flags'
import { getRedisClient } from '@/lib/core/config/redis'

const logger = createLogger('PollAdmissionRefusals')

/**
 * How long a workspace's polls are skipped after execution admission refused a
 * polled event for a reason that holds until a person acts (usage limit or a
 * suspended account). Polling resumes on its own after
 * this window, so a raised limit takes effect within it.
 */
const POLL_ADMISSION_REFUSAL_TTL_SECONDS = 5 * 60

const refusalKey = (workspaceId: string) => `poll-admission-refused:v1:${workspaceId}`

/**
 * Records that execution admission refused a polled event for this workspace,
 * so the next ticks skip its webhooks without fetching anything. Best effort: a
 * failed write only means the next tick polls and is refused again.
 */
export async function recordPollAdmissionRefusal(workspaceId: string): Promise<void> {
  if (!isBillingEnabled) return
  const redis = getRedisClient()
  if (!redis) return
  try {
    await redis.set(refusalKey(workspaceId), '1', 'EX', POLL_ADMISSION_REFUSAL_TTL_SECONDS)
  } catch (error) {
    logger.debug('Failed to record poll admission refusal', {
      workspaceId,
      error: getErrorMessage(error),
    })
  }
}

/**
 * The workspaces among `workspaceIds` with a recent recorded admission refusal,
 * read in one round trip. Healthy payers cost no billing reads: only a refusal
 * that already happened is consulted. A failed read skips nothing.
 */
export async function findRecentlyRefusedWorkspaces(
  workspaceIds: readonly string[]
): Promise<ReadonlySet<string>> {
  if (!isBillingEnabled || workspaceIds.length === 0) return new Set()
  const redis = getRedisClient()
  if (!redis) return new Set()
  try {
    const flags = await redis.mget(...workspaceIds.map(refusalKey))
    return new Set(workspaceIds.filter((_, index) => flags[index] !== null))
  } catch (error) {
    logger.warn('Failed to read poll admission refusals; polling every workspace', {
      error: getErrorMessage(error),
    })
    return new Set()
  }
}
