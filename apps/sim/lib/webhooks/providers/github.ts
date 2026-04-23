import crypto from 'crypto'
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

const logger = createLogger('WebhookProvider:GitHub')

function validateGitHubSignature(secret: string, signature: string, body: string): boolean {
  try {
    if (!secret || !signature || !body) {
      logger.warn('GitHub signature validation missing required fields', {
        hasSecret: !!secret,
        hasSignature: !!signature,
        hasBody: !!body,
      })
      return false
    }
    let algorithm: 'sha256' | 'sha1'
    let providedSignature: string
    if (signature.startsWith('sha256=')) {
      algorithm = 'sha256'
      providedSignature = signature.substring(7)
    } else if (signature.startsWith('sha1=')) {
      algorithm = 'sha1'
      providedSignature = signature.substring(5)
    } else {
      logger.warn('GitHub signature has invalid format', {
        signature: `${signature.substring(0, 10)}...`,
      })
      return false
    }
    const computedHash = crypto.createHmac(algorithm, secret).update(body, 'utf8').digest('hex')
    logger.debug('GitHub signature comparison', {
      algorithm,
      computedSignature: `${computedHash.substring(0, 10)}...`,
      providedSignature: `${providedSignature.substring(0, 10)}...`,
      computedLength: computedHash.length,
      providedLength: providedSignature.length,
      match: computedHash === providedSignature,
    })
    return safeCompare(computedHash, providedSignature)
  } catch (error) {
    logger.error('Error validating GitHub signature:', error)
    return false
  }
}

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

  async formatInput({ body, headers }: FormatInputContext): Promise<FormatInputResult> {
    const b = body as Record<string, unknown>
    const eventType = headers['x-github-event'] || 'unknown'
    const ref = (b?.ref as string) || ''
    const branch = ref.replace('refs/heads/', '')
    return {
      input: { ...b, event_type: eventType, action: (b?.action || '') as string, branch },
    }
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
