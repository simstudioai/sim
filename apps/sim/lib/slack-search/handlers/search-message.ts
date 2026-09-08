import { RateLimiter } from '@/lib/core/rate-limiter'
import { DEFAULT_USER_ROUTE_LIMIT } from '@/lib/core/rate-limiter/route-helpers'
import { respondToSlackSearchMessage } from '@/lib/knowledge/application/slack-search/process-message'
import { SLACK_SEARCH_MAX_DURATION_SECONDS } from '@/lib/slack-search/constants'
import { slackSearchJobSchema } from '@/lib/slack-search/types'

const rateLimiter = new RateLimiter()

/** Both queue backends enter through this handler and reauthorize current installation and member access. */
export async function handleSlackSearchMessage(payload: unknown, signal?: AbortSignal) {
  const job = slackSearchJobSchema.parse(payload)
  const timeout = AbortSignal.timeout(SLACK_SEARCH_MAX_DURATION_SECONDS * 1000)
  const executionSignal = signal ? AbortSignal.any([signal, timeout]) : timeout
  const admission = await rateLimiter.checkRateLimitDirectOrThrow(
    `slack-search:${job.installationId}:${job.message.userId}`,
    DEFAULT_USER_ROUTE_LIMIT
  )
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
    input: { job, signal: executionSignal, rateLimited: !admission.allowed },
  })
}
