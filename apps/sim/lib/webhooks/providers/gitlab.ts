import { createLogger } from '@sim/logger'
import { safeCompare } from '@sim/security/compare'
import { generateId } from '@sim/utils/id'
import { NextResponse } from 'next/server'
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

const logger = createLogger('WebhookProvider:GitLab')

const GITLAB_API_BASE = 'https://gitlab.com/api/v4'

function asRecord(value: unknown): Record<string, unknown> {
  return (value as Record<string, unknown>) || {}
}

function gitlabProjectHooksUrl(projectId: string): string {
  return `${GITLAB_API_BASE}/projects/${encodeURIComponent(projectId)}/hooks`
}

/**
 * Best-effort cleanup that deletes any project hook pointing at `url`. Used to
 * avoid orphaning a hook when the create response can't be parsed for its id.
 */
async function cleanupGitLabHookByUrl(
  projectId: string,
  accessToken: string,
  url: string
): Promise<void> {
  const res = await fetch(gitlabProjectHooksUrl(projectId), {
    headers: { 'PRIVATE-TOKEN': accessToken },
  }).catch(() => null)
  if (!res || !res.ok) return

  const hooks = (await res.json().catch(() => null)) as Array<{ id?: number; url?: string }> | null
  if (!Array.isArray(hooks)) return

  await Promise.all(
    hooks
      .filter((hook) => hook.url === url && hook.id != null)
      .map((hook) =>
        fetch(`${gitlabProjectHooksUrl(projectId)}/${hook.id}`, {
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

  async formatInput({ body, headers }: FormatInputContext): Promise<FormatInputResult> {
    const b = asRecord(body)
    const eventType = headers['x-gitlab-event'] || ''
    const ref = (b.ref as string) || ''
    const branch = ref.replace('refs/heads/', '')
    return {
      input: { ...b, event_type: eventType, branch },
    }
  },

  async createSubscription(ctx: SubscriptionContext): Promise<SubscriptionResult | undefined> {
    const config = getProviderConfig(ctx.webhook)
    const accessToken = config.accessToken as string | undefined
    const projectId = config.projectId as string | undefined
    const triggerId = config.triggerId as string | undefined

    if (!accessToken)
      throw new Error('GitLab Personal Access Token is required to create the webhook.')
    if (!projectId) throw new Error('GitLab Project ID is required to create the webhook.')

    const { getGitLabEventFlags } = await import('@/triggers/gitlab/utils')
    const secretToken = generateId()
    const res = await fetch(gitlabProjectHooksUrl(projectId), {
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
      // The hook was created but we can't read its id — delete it by URL so it
      // is not orphaned in GitLab.
      await cleanupGitLabHookByUrl(projectId, accessToken, getNotificationUrl(ctx.webhook))
      throw new Error('GitLab webhook created but no hook ID was returned.')
    }

    logger.info(`[${ctx.requestId}] Created GitLab webhook ${created.id} for project ${projectId}`)
    return { providerConfigUpdates: { externalId: String(created.id), webhookSecret: secretToken } }
  },

  async deleteSubscription(ctx: DeleteSubscriptionContext): Promise<void> {
    const config = getProviderConfig(ctx.webhook)
    const accessToken = config.accessToken as string | undefined
    const projectId = config.projectId as string | undefined
    const externalId = config.externalId as string | undefined

    if (!accessToken || !projectId || !externalId) {
      if (ctx.strict) throw new Error('Missing GitLab credentials or hook ID for webhook deletion.')
      logger.warn(
        `[${ctx.requestId}] Skipping GitLab webhook cleanup — missing token, project, or hook ID`
      )
      return
    }

    const res = await fetch(`${gitlabProjectHooksUrl(projectId)}/${externalId}`, {
      method: 'DELETE',
      headers: { 'PRIVATE-TOKEN': accessToken },
    })

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
