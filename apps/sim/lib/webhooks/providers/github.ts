import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import type {
  AuthContext,
  EventMatchContext,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'
import { validateGitHubSignature } from '@/lib/webhooks/utils.server'

const logger = createLogger('WebhookProvider:GitHub')

export const githubHandler: WebhookProviderHandler = {
  verifyAuth({ request, rawBody, requestId, providerConfig }: AuthContext) {
    const secret = providerConfig.webhookSecret as string | undefined
    if (!secret) {
      return null
    }

    const signature =
      request.headers.get('X-Hub-Signature-256') || request.headers.get('X-Hub-Signature')
    if (!signature) {
      logger.warn(`[${requestId}] GitHub webhook missing signature header`)
      return new NextResponse('Unauthorized - Missing GitHub signature', { status: 401 })
    }

    if (!validateGitHubSignature(secret, signature, rawBody)) {
      logger.warn(`[${requestId}] GitHub signature verification failed`, {
        signatureLength: signature.length,
        secretLength: secret.length,
        usingSha256: !!request.headers.get('X-Hub-Signature-256'),
      })
      return new NextResponse('Unauthorized - Invalid GitHub signature', { status: 401 })
    }

    return null
  },

  async matchEvent({
    webhook,
    workflow,
    body,
    request,
    requestId,
    providerConfig,
  }: EventMatchContext) {
    const triggerId = providerConfig.triggerId as string | undefined
    const obj = body as Record<string, unknown>

    if (triggerId && triggerId !== 'github_webhook') {
      const eventType = request.headers.get('x-github-event')
      const action = obj.action as string | undefined

      const { isGitHubEventMatch } = await import('@/triggers/github/utils')
      if (!isGitHubEventMatch(triggerId, eventType || '', action, obj)) {
        logger.debug(
          `[${requestId}] GitHub event mismatch for trigger ${triggerId}. Event: ${eventType}, Action: ${action}. Skipping execution.`,
          {
            webhookId: webhook.id,
            workflowId: workflow.id,
            triggerId,
            receivedEvent: eventType,
            receivedAction: action,
          }
        )
        return false
      }
    }

    return true
  },
}
