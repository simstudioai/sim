import crypto from 'crypto'
import { createLogger } from '@sim/logger'
import { safeCompare } from '@sim/security/compare'
import { isRecordLike } from '@sim/utils/object'
import { NextResponse } from 'next/server'
import type {
  AuthContext,
  EventMatchContext,
  FormatInputContext,
  FormatInputResult,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'

const logger = createLogger('WebhookProvider:GitHub')

/**
 * GitHub's "simple user" shape (issue.user, pull_request.merged_by,
 * repository.owner, sender, ...) always carries `login` alongside `type`.
 */
function isGitHubUserLike(value: unknown): value is Record<string, unknown> & { type: string } {
  return isRecordLike(value) && typeof value.login === 'string' && typeof value.type === 'string'
}

/**
 * GitHub embeds a `type` field (User/Bot/Organization) on every user-like
 * object. `type` is a reserved TriggerOutput meta-key, so the trigger output
 * schemas expose it under `user_type` (or `owner_type` for repository.owner)
 * instead. This walks the payload adding both aliases next to the raw `type`
 * key, so the delivered data matches whichever name a given trigger's output
 * schema declares. The raw `type` key is kept alongside the aliases (this is
 * plain passthrough data, not schema-constrained) so a workflow already
 * referencing the undocumented raw path keeps working.
 */
function withGitHubUserTypeAliases(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(withGitHubUserTypeAliases)
  }
  if (!isRecordLike(value)) {
    return value
  }

  const result: Record<string, unknown> = {}
  for (const [key, nested] of Object.entries(value)) {
    result[key] = withGitHubUserTypeAliases(nested)
  }
  if (isGitHubUserLike(value)) {
    result.user_type = value.type
    result.owner_type = value.type
  }
  return result
}

/**
 * Not built on the shared `createHmacVerifier` factory: GitHub supports two
 * signature headers (`X-Hub-Signature-256` primary, legacy `X-Hub-Signature`
 * sha1 fallback) and picks the algorithm from the header value itself, which
 * the single-header/single-algorithm factory doesn't model.
 */
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
        usingSha256: !!request.headers.get('X-Hub-Signature-256'),
      })
      return new NextResponse('Unauthorized - Invalid GitHub signature', { status: 401 })
    }

    return null
  },

  async formatInput({ body, headers }: FormatInputContext): Promise<FormatInputResult> {
    const eventType = headers['x-github-event'] || 'unknown'
    if (!isRecordLike(body)) {
      return { input: { event_type: eventType, action: '', branch: '' } }
    }

    const ref = typeof body.ref === 'string' ? body.ref : ''
    const branch = ref.replace('refs/heads/', '')
    const aliased = withGitHubUserTypeAliases(body) as Record<string, unknown>

    const repository = aliased.repository
    if (isRecordLike(repository) && typeof repository.description === 'string') {
      aliased.repository = { ...repository, repo_description: repository.description }
    }

    return {
      input: {
        ...aliased,
        event_type: eventType,
        action: typeof body.action === 'string' ? body.action : '',
        branch,
      },
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
    const obj = isRecordLike(body) ? body : {}

    if (triggerId && triggerId !== 'github_webhook') {
      const eventType = request.headers.get('x-github-event')
      const action = typeof obj.action === 'string' ? obj.action : undefined

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

  /**
   * GitHub always sends `X-GitHub-Delivery`, which is already checked ahead
   * of this method by the shared idempotency header allowlist. This is a
   * content-derived fallback for the rare case that header is stripped in
   * transit (e.g. by an intermediary proxy). Prefers the most specific
   * nested entity so distinct sub-resources (a comment vs. its parent issue)
   * on the same delivery don't collide, and includes `updated_at` where
   * available so re-deliveries of the same entity version dedupe while a
   * later edit of that same entity is treated as a new key.
   */
  extractIdempotencyId(body: unknown): string | null {
    if (!isRecordLike(body)) return null

    const action = typeof body.action === 'string' ? body.action : ''
    const entity =
      (isRecordLike(body.comment) && body.comment) ||
      (isRecordLike(body.review) && body.review) ||
      (isRecordLike(body.pull_request) && body.pull_request) ||
      (isRecordLike(body.issue) && body.issue) ||
      (isRecordLike(body.release) && body.release) ||
      (isRecordLike(body.workflow_run) && body.workflow_run) ||
      null

    if (entity && entity.id != null) {
      const version = typeof entity.updated_at === 'string' ? `:${entity.updated_at}` : ''
      return `github:${action}:${entity.id}${version}`
    }

    if (typeof body.ref === 'string' && typeof body.after === 'string') {
      return `github:push:${body.ref}:${body.after}`
    }

    return null
  },
}
