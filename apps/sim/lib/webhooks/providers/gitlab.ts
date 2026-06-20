import { createLogger } from '@sim/logger'
import { safeCompare } from '@sim/security/compare'
import { NextResponse } from 'next/server'
import type {
  AuthContext,
  EventMatchContext,
  FormatInputContext,
  FormatInputResult,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'

const logger = createLogger('WebhookProvider:GitLab')

function asRecord(value: unknown): Record<string, unknown> {
  return (value as Record<string, unknown>) || {}
}

export const gitlabHandler: WebhookProviderHandler = {
  /**
   * GitLab echoes the configured "Secret token" verbatim in the `X-Gitlab-Token`
   * header (plain equality, not an HMAC). Skip verification when no token is set.
   */
  verifyAuth({ request, requestId, providerConfig }: AuthContext) {
    const secret = providerConfig.webhookSecret as string | undefined
    if (!secret) {
      return null
    }

    const token = request.headers.get('X-Gitlab-Token')
    if (!token) {
      logger.warn(`[${requestId}] GitLab webhook missing X-Gitlab-Token header`)
      return new NextResponse('Unauthorized - Missing GitLab token', { status: 401 })
    }

    if (!safeCompare(token, secret)) {
      logger.warn(`[${requestId}] GitLab token verification failed`)
      return new NextResponse('Unauthorized - Invalid GitLab token', { status: 401 })
    }

    return null
  },

  async matchEvent({ body, requestId, providerConfig }: EventMatchContext) {
    const triggerId = providerConfig.triggerId as string | undefined
    if (!triggerId || triggerId === 'gitlab_webhook') return true

    const objectKind = asRecord(body).object_kind as string | undefined

    const { isGitLabEventMatch } = await import('@/triggers/gitlab/utils')
    if (!isGitLabEventMatch(triggerId, objectKind || '')) {
      logger.debug(
        `[${requestId}] GitLab event '${objectKind}' does not match trigger ${triggerId}, skipping`
      )
      return false
    }
    return true
  },

  async formatInput({ body, headers }: FormatInputContext): Promise<FormatInputResult> {
    const b = asRecord(body)
    const eventType = headers['x-gitlab-event'] || ''
    const ref = (b.ref as string) || ''
    const branch = ref.replace('refs/heads/', '')
    return {
      input: { ...b, event_type: eventType, branch },
    }
  },
}
