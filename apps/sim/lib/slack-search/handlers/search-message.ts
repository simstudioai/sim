import { createLogger } from '@sim/logger'
import { RateLimiter } from '@/lib/core/rate-limiter'
import { DEFAULT_USER_ROUTE_LIMIT } from '@/lib/core/rate-limiter/route-helpers'
import {
  dispatchPendingSlackSearchTurns,
  slackSearchDispatchSchema,
} from '@/lib/knowledge/application/slack-search/outbox'
import { respondToSlackSearchMessage } from '@/lib/knowledge/application/slack-search/process-message'
import {
  claimSlackSearchTurn,
  finishSlackSearchTurn,
} from '@/lib/knowledge/application/slack-search/turns'
import { SLACK_SEARCH_MAX_DURATION_SECONDS } from '@/lib/slack-search/constants'

const rateLimiter = new RateLimiter()
const logger = createLogger('SlackSearchWorker')

/** Duplicate wakes contend for one durable claim; queued turns never consume their execution deadline. */
export async function handleSlackSearchMessage(payload: unknown, signal?: AbortSignal) {
  const { turnId } = slackSearchDispatchSchema.parse(payload)
  const claim = await claimSlackSearchTurn(turnId)
  if (!claim) return
  const { job, leaseId } = claim
  const controller = new AbortController()
  const abort = () => controller.abort(signal?.reason)
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) abort()
  const timeout = setTimeout(
    () => controller.abort(new Error('Slack Assistant deadline exceeded')),
    SLACK_SEARCH_MAX_DURATION_SECONDS * 1000
  )
  let completed = false
  try {
    const admission = await rateLimiter.checkRateLimitDirectOrThrow(
      `slack-search:${job.installationId}:${job.message.userId}`,
      DEFAULT_USER_ROUTE_LIMIT
    )
    if (!admission.allowed) throw new Error('Slack Search sender rate limit exceeded')
    await respondToSlackSearchMessage.execute({
      principal: {
        kind: 'slack_installation',
        credentialId: job.credentialId,
        credentialVersion: job.credentialVersion,
        appId: job.message.appId,
        teamId: job.message.teamId,
        eventId: job.message.eventId,
        receivedAt: new Date(job.receivedAt),
      },
      input: { job, turnId, leaseId, controller },
    })
    completed = true
  } catch (error) {
    logger.error('Slack Assistant turn failed', {
      turnId,
      installationId: job.installationId,
      aborted: controller.signal.aborted,
    })
    throw error
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', abort)
    await finishSlackSearchTurn(
      turnId,
      leaseId,
      completed ? 'completed' : 'failed',
      completed ? 'success' : 'execution_failed'
    )
    await dispatchPendingSlackSearchTurns(job.installationId)
  }
}
