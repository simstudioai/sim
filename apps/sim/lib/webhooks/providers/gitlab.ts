import { createLogger } from '@sim/logger'
import { safeCompare } from '@sim/security/compare'
import { generateId } from '@sim/utils/id'
import { NextResponse } from 'next/server'
import { secureFetchWithValidation } from '@/lib/core/security/input-validation.server'
import { getNotificationUrl, getProviderConfig } from '@/lib/webhooks/provider-subscription-utils'
import type {
  AuthContext,
  DeleteSubscriptionContext,
  EventMatchContext,
  FormatInputContext,
  FormatInputResult,
  SubscriptionContext,
  SubscriptionResult,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'
import { getGitLabApiBase, UnsafeGitLabHostError } from '@/tools/gitlab/utils'

const logger = createLogger('WebhookProvider:GitLab')

function asRecord(value: unknown): Record<string, unknown> {
  return (value as Record<string, unknown>) || {}
}

function gitlabProjectHooksUrl(projectId: string, host: unknown): string {
  return `${getGitLabApiBase(host)}/projects/${encodeURIComponent(projectId)}/hooks`
}

/**
 * Best-effort cleanup that deletes any project hook pointing at `url`. Used to
 * avoid orphaning a hook when the create response can't be parsed for its id.
 */
async function cleanupGitLabHookByUrl(
  projectId: string,
  accessToken: string,
  url: string,
  host: unknown
): Promise<void> {
  const res = await secureFetchWithValidation(gitlabProjectHooksUrl(projectId, host), {
    headers: { 'PRIVATE-TOKEN': accessToken },
  }).catch(() => null)
  if (!res || !res.ok) return

  const hooks = (await res.json().catch(() => null)) as Array<{ id?: number; url?: string }> | null
  if (!Array.isArray(hooks)) return

  await Promise.all(
    hooks
      .filter((hook) => hook.url === url && hook.id != null)
      .map((hook) =>
        secureFetchWithValidation(`${gitlabProjectHooksUrl(projectId, host)}/${hook.id}`, {
          method: 'DELETE',
          headers: { 'PRIVATE-TOKEN': accessToken },
        }).catch(() => null)
      )
  )
}

export const gitlabHandler: WebhookProviderHandler = {
  /**
   * GitLab echoes the configured "Secret token" verbatim in the `X-Gitlab-Token`
   * header (plain equality, not an HMAC). The secret is generated during
   * auto-registration, so a missing secret means misconfiguration — fail closed.
   */
  verifyAuth({ request, requestId, providerConfig }: AuthContext) {
    const secret = providerConfig.webhookSecret as string | undefined
    if (!secret) {
      logger.warn(`[${requestId}] GitLab webhook secret not configured`)
      return new NextResponse('Unauthorized - Missing GitLab webhook secret', { status: 401 })
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

  /**
   * GitLab 17.2+ adds a `type` field inside `object_attributes` on Issue Hook
   * payloads (e.g. "Issue", "Incident", "Task"). `type` is a reserved
   * TriggerOutput meta-key, so it can't be declared in the output schema
   * under that name — exposed there as `work_item_type` instead. The raw
   * `type` key is kept in the delivered data alongside it (this is plain
   * passthrough data, not schema-constrained) so a workflow already
   * referencing the undocumented raw path keeps working.
   */
  async formatInput({ body, headers }: FormatInputContext): Promise<FormatInputResult> {
    const b = asRecord(body)
    const eventType = headers['x-gitlab-event'] || ''
    const ref = (b.ref as string) || ''
    const branch = ref.replace('refs/heads/', '')
    const objectAttributes = b.object_attributes
    let input: Record<string, unknown> = { ...b, event_type: eventType, branch }
    if (
      objectAttributes &&
      typeof objectAttributes === 'object' &&
      !Array.isArray(objectAttributes)
    ) {
      const workItemType = (objectAttributes as Record<string, unknown>).type
      if (workItemType !== undefined) {
        input = {
          ...input,
          object_attributes: { ...objectAttributes, work_item_type: workItemType },
        }
      }
    }

    return { input }
  },

  /**
   * GitLab does not automatically retry a failed delivery — a failed request
   * only counts toward auto-disabling the webhook (4 consecutive failures
   * disables it temporarily, 40 permanently), and re-delivery only happens
   * via a manual "Resend Request" (UI or API), which carries the same
   * `webhook-id`/`Idempotency-Key`/`X-Gitlab-Event-UUID` headers as the
   * original. Those headers are already in the shared idempotency service's
   * allowlist and checked ahead of this method, which only receives the body.
   * This is a content-derived fallback for the rare case those headers are
   * stripped in transit (e.g. by an intermediary proxy). checkout_sha is
   * null on branch/tag deletion (after falls back to the all-zeros SHA), so
   * ref is included to keep unrelated deletions in one project from
   * colliding onto the same key.
   */
  extractIdempotencyId(body: unknown): string | null {
    const b = asRecord(body)
    const objectKind = (b.object_kind as string) || ''
    const project = asRecord(b.project)
    const projectId = project.id != null ? String(project.id) : ''

    if (objectKind === 'push' || objectKind === 'tag_push') {
      const ref = (b.ref as string) || ''
      const checkoutSha = (b.checkout_sha as string) || (b.after as string) || ''
      if (!checkoutSha && !ref) return null
      return `gitlab:${objectKind}:${projectId}:${ref}:${checkoutSha}`
    }

    const objectAttributes = asRecord(b.object_attributes)
    const id = objectAttributes.id != null ? String(objectAttributes.id) : ''
    if (!id) return null
    const updatedAt = (objectAttributes.updated_at as string) || ''
    return `gitlab:${objectKind || 'event'}:${projectId}:${id}:${updatedAt}`
  },

  /**
   * Validates the optional self-managed host up front so a structurally
   * unsafe value surfaces as a clear error instead of an unhandled
   * UnsafeGitLabHostError.
   */
  async createSubscription(ctx: SubscriptionContext): Promise<SubscriptionResult | undefined> {
    const config = getProviderConfig(ctx.webhook)
    const accessToken = config.accessToken as string | undefined
    const projectId = config.projectId as string | undefined
    const triggerId = config.triggerId as string | undefined
    const host = config.host as string | undefined

    if (!accessToken)
      throw new Error('GitLab Personal Access Token is required to create the webhook.')
    if (!projectId) throw new Error('GitLab Project ID is required to create the webhook.')

    try {
      getGitLabApiBase(host)
    } catch (error) {
      if (error instanceof UnsafeGitLabHostError) {
        throw new Error(
          'GitLab host is invalid. Provide a domain like gitlab.example.com (no protocol, path, or credentials).'
        )
      }
      throw error
    }

    const { getGitLabEventFlags } = await import('@/triggers/gitlab/utils')
    const secretToken = generateId()
    const res = await secureFetchWithValidation(gitlabProjectHooksUrl(projectId, host), {
      method: 'POST',
      headers: { 'PRIVATE-TOKEN': accessToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: getNotificationUrl(ctx.webhook),
        token: secretToken,
        enable_ssl_verification: true,
        ...getGitLabEventFlags(triggerId ?? 'gitlab_webhook'),
      }),
    })

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      logger.error(`[${ctx.requestId}] Failed to create GitLab webhook (${res.status})`, { detail })
      if (res.status === 401)
        throw new Error(
          'GitLab authentication failed. Verify your Personal Access Token has the api scope.'
        )
      if (res.status === 403)
        throw new Error(
          'GitLab access denied. You need the Maintainer or Owner role on the project.'
        )
      if (res.status === 404) throw new Error('GitLab project not found. Verify the Project ID.')
      throw new Error(`Failed to create GitLab webhook: ${res.status}`)
    }

    const created = (await res.json().catch(() => ({}))) as { id?: number | string }
    if (created.id === undefined || created.id === null) {
      await cleanupGitLabHookByUrl(projectId, accessToken, getNotificationUrl(ctx.webhook), host)
      throw new Error('GitLab webhook created but no hook ID was returned.')
    }

    logger.info(`[${ctx.requestId}] Created GitLab webhook ${created.id} for project ${projectId}`)
    return { providerConfigUpdates: { externalId: String(created.id), webhookSecret: secretToken } }
  },

  /**
   * A structurally unsafe host must not abort cleanup in non-strict mode —
   * mirrors the graceful skip used for missing credentials below.
   */
  async deleteSubscription(ctx: DeleteSubscriptionContext): Promise<void> {
    const config = getProviderConfig(ctx.webhook)
    const accessToken = config.accessToken as string | undefined
    const projectId = config.projectId as string | undefined
    const externalId = config.externalId as string | undefined
    const host = config.host as string | undefined

    if (!accessToken || !projectId || !externalId) {
      if (ctx.strict) throw new Error('Missing GitLab credentials or hook ID for webhook deletion.')
      logger.warn(
        `[${ctx.requestId}] Skipping GitLab webhook cleanup — missing token, project, or hook ID`
      )
      return
    }

    try {
      getGitLabApiBase(host)
    } catch (error) {
      if (error instanceof UnsafeGitLabHostError) {
        if (ctx.strict) {
          throw new Error('Cannot delete GitLab webhook: the configured host is invalid.')
        }
        logger.warn(
          `[${ctx.requestId}] Skipping GitLab webhook cleanup — configured host is invalid`
        )
        return
      }
      throw error
    }

    const res = await secureFetchWithValidation(
      `${gitlabProjectHooksUrl(projectId, host)}/${externalId}`,
      {
        method: 'DELETE',
        headers: { 'PRIVATE-TOKEN': accessToken },
      }
    )

    if (!res.ok && res.status !== 404) {
      if (ctx.strict) throw new Error(`Failed to delete GitLab webhook: ${res.status}`)
      logger.warn(
        `[${ctx.requestId}] Failed to delete GitLab webhook ${externalId} (non-fatal): ${res.status}`
      )
      return
    }
    logger.info(`[${ctx.requestId}] Deleted GitLab webhook ${externalId}`)
  },
}
