import { createLogger } from '@sim/logger'
import { safeCompare } from '@sim/security/compare'
import { hmacSha256Hex } from '@sim/security/hmac'
import { generateId } from '@sim/utils/id'
import { toRecord, toRecordOrNull } from '@sim/utils/object'
import { truncate } from '@sim/utils/string'
import { refreshAccessTokenIfNeeded } from '@/lib/oauth/credential-service'
import {
  getCredentialOwner,
  getNotificationUrl,
  getProviderConfig,
} from '@/lib/webhooks/provider-subscription-utils'
import type {
  DeleteSubscriptionContext,
  EventMatchContext,
  FormatInputContext,
  FormatInputResult,
  SubscriptionContext,
  SubscriptionResult,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'
import { createHmacVerifier } from '@/lib/webhooks/providers/utils'
import {
  BITBUCKET_API_BASE,
  bitbucketHeaders,
  bitbucketRepositoryPath,
  encodeBitbucketSegment,
} from '@/tools/bitbucket/utils'

const logger = createLogger('WebhookProvider:Bitbucket')

const PULL_REQUEST_TRIGGER_IDS = new Set([
  'bitbucket_pull_request_created',
  'bitbucket_pull_request_updated',
  'bitbucket_pull_request_approved',
  'bitbucket_pull_request_approval_removed',
  'bitbucket_pull_request_changes_requested',
  'bitbucket_pull_request_changes_request_removed',
  'bitbucket_pull_request_merged',
  'bitbucket_pull_request_declined',
  'bitbucket_pull_request_comment_created',
  'bitbucket_pull_request_comment_updated',
  'bitbucket_pull_request_comment_deleted',
  'bitbucket_pull_request_comment_resolved',
  'bitbucket_pull_request_comment_reopened',
])

const PULL_REQUEST_APPROVAL_TRIGGER_IDS = new Set([
  'bitbucket_pull_request_approved',
  'bitbucket_pull_request_approval_removed',
])

const PULL_REQUEST_CHANGES_REQUEST_TRIGGER_IDS = new Set([
  'bitbucket_pull_request_changes_requested',
  'bitbucket_pull_request_changes_request_removed',
])

const PULL_REQUEST_COMMENT_TRIGGER_IDS = new Set([
  'bitbucket_pull_request_comment_created',
  'bitbucket_pull_request_comment_updated',
  'bitbucket_pull_request_comment_deleted',
  'bitbucket_pull_request_comment_resolved',
  'bitbucket_pull_request_comment_reopened',
])

function bitbucketHooksUrl(workspaceSlug: string, repoSlug: string): string {
  return `${BITBUCKET_API_BASE}${bitbucketRepositoryPath(workspaceSlug, repoSlug)}/hooks`
}

function validateBitbucketSignature(secret: string, signature: string, body: string): boolean {
  const match = /^sha256=([a-f\d]{64})$/i.exec(signature.trim())
  if (!secret || !match) return false

  const expected = hmacSha256Hex(body, secret)
  return safeCompare(expected, match[1].toLowerCase())
}

async function resolveBitbucketAccessToken(
  credentialId: string | undefined,
  requestId: string
): Promise<string> {
  if (!credentialId) {
    throw new Error(
      'Bitbucket account connection required. Connect or reconnect Bitbucket in the trigger configuration and try again.'
    )
  }

  const owner = await getCredentialOwner(credentialId, requestId)
  const accessToken = owner
    ? await refreshAccessTokenIfNeeded(owner.accountId, owner.userId, requestId)
    : null

  if (!accessToken) {
    throw new Error(
      'Bitbucket account connection required. Connect or reconnect Bitbucket in the trigger configuration and try again.'
    )
  }

  return accessToken
}

function readRequiredConfigString(
  config: Record<string, unknown>,
  key: 'workspaceSlug' | 'repoSlug',
  label: string
): string {
  const value = config[key]
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Bitbucket ${label} is required to manage the repository webhook.`)
  }
  return value.trim()
}

async function readBitbucketErrorDetail(response: Response): Promise<string> {
  const payload = toRecord(await response.json().catch(() => null))
  const error = toRecord(payload.error)
  const message = error.message
  return typeof message === 'string' && message.trim() ? truncate(message.trim(), 300) : ''
}

function createBitbucketApiError(status: number, action: 'create' | 'delete', detail = ''): Error {
  const operation = action === 'create' ? 'create' : 'delete'
  if (status === 401) {
    return new Error(
      `Bitbucket authentication failed while trying to ${operation} the webhook. Reconnect the Bitbucket account and try again.`
    )
  }
  if (status === 403) {
    return new Error(
      `Bitbucket denied permission to ${operation} the webhook. The connected account must be a repository administrator and grant the webhook scope.`
    )
  }
  if (status === 404) {
    return new Error(
      `Bitbucket repository not found while trying to ${operation} the webhook. Verify the workspace and repository selections.`
    )
  }
  if (status === 429) {
    return new Error(`Bitbucket rate limited the webhook ${operation} request. Try again shortly.`)
  }
  if (status === 400 && action === 'create') {
    return new Error(
      detail
        ? `Bitbucket rejected the webhook creation request: ${detail}`
        : 'Bitbucket rejected the webhook creation request. Check the repository webhook limit and trigger configuration.'
    )
  }
  return new Error(
    `Failed to ${operation} Bitbucket webhook: ${status}${detail ? ` (${detail})` : ''}`
  )
}

async function cleanupBitbucketHookByUrl(
  workspaceSlug: string,
  repoSlug: string,
  accessToken: string,
  callbackUrl: string,
  description: string,
  requestId: string
): Promise<void> {
  const hooksUrl = bitbucketHooksUrl(workspaceSlug, repoSlug)
  const response = await fetch(`${hooksUrl}?pagelen=100`, {
    headers: bitbucketHeaders(accessToken),
  }).catch(() => null)
  if (!response?.ok) return

  const payload = toRecord(await response.json().catch(() => null))
  const hooks = Array.isArray(payload.values) ? payload.values : []
  const matchingIds = hooks.flatMap((value) => {
    const hook = toRecord(value)
    return hook.url === callbackUrl &&
      hook.description === description &&
      typeof hook.uuid === 'string' &&
      hook.uuid
      ? [hook.uuid]
      : []
  })

  await Promise.all(
    matchingIds.map(async (uuid) => {
      const deleteResponse = await fetch(
        `${hooksUrl}/${encodeBitbucketSegment(uuid, 'externalId')}`,
        {
          method: 'DELETE',
          headers: bitbucketHeaders(accessToken),
        }
      ).catch(() => null)
      if (!deleteResponse || (!deleteResponse.ok && deleteResponse.status !== 404)) {
        logger.warn(
          `[${requestId}] Failed to roll back Bitbucket webhook ${uuid} after a malformed create response`
        )
      }
    })
  )
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function nullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function headerValue(headers: Record<string, string>, name: string): string | null {
  const value = headers[name.toLowerCase()]
  return typeof value === 'string' && value ? value : null
}

function attemptNumber(headers: Record<string, string>): number | null {
  const raw = headerValue(headers, 'x-attempt-number')
  if (!raw) return null
  const parsed = Number(raw)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
}

function commentFields(body: Record<string, unknown>): Record<string, unknown> {
  const comment = toRecordOrNull(body.comment)
  const content = toRecord(comment?.content)
  return {
    comment,
    commentId: nullableNumber(comment?.id),
    commentContent: nullableString(content.raw),
  }
}

function pullRequestFields(body: Record<string, unknown>): Record<string, unknown> {
  const pullRequest = toRecordOrNull(body.pullrequest)
  const source = toRecord(pullRequest?.source)
  const destination = toRecord(pullRequest?.destination)
  const sourceBranch = toRecord(source.branch)
  const destinationBranch = toRecord(destination.branch)

  return {
    pullRequest,
    pullRequestId: nullableNumber(pullRequest?.id),
    pullRequestTitle: nullableString(pullRequest?.title),
    pullRequestState: nullableString(pullRequest?.state),
    sourceBranch: nullableString(sourceBranch.name),
    destinationBranch: nullableString(destinationBranch.name),
  }
}

function commitHashFromStatus(commitStatus: Record<string, unknown> | null): string | null {
  const links = toRecord(commitStatus?.links)
  const commit = toRecord(links.commit)
  const href = nullableString(commit.href)
  if (!href) return null

  try {
    const pathSegments = new URL(href).pathname.split('/').filter(Boolean)
    const encodedHash = pathSegments.at(-1)
    return encodedHash ? decodeURIComponent(encodedHash) : null
  } catch {
    return null
  }
}

function formatBitbucketInput(
  triggerId: string | undefined,
  body: unknown,
  headers: Record<string, string>
): Record<string, unknown> {
  const b = toRecord(body)
  const base: Record<string, unknown> = {
    eventType: headerValue(headers, 'x-event-key'),
    hookUuid: headerValue(headers, 'x-hook-uuid'),
    requestUuid: headerValue(headers, 'x-request-uuid'),
    attemptNumber: attemptNumber(headers),
    actor: toRecordOrNull(b.actor),
    repository: toRecordOrNull(b.repository),
    payload: body ?? null,
  }

  if (triggerId === 'bitbucket_push') return { ...base, push: toRecordOrNull(b.push) }
  if (triggerId === 'bitbucket_repository_forked') {
    return { ...base, fork: toRecordOrNull(b.fork) }
  }
  if (triggerId === 'bitbucket_repository_updated') {
    return { ...base, changes: toRecordOrNull(b.changes) }
  }
  if (triggerId === 'bitbucket_commit_comment_created') {
    return { ...base, ...commentFields(b), commit: toRecordOrNull(b.commit) }
  }
  if (
    triggerId === 'bitbucket_build_status_created' ||
    triggerId === 'bitbucket_build_status_updated'
  ) {
    const commitStatus = toRecordOrNull(b.commit_status)
    return {
      ...base,
      commitStatus,
      commitHash: commitHashFromStatus(commitStatus),
      statusKey: nullableString(commitStatus?.key),
      statusState: nullableString(commitStatus?.state),
      statusName: nullableString(commitStatus?.name),
      statusUrl: nullableString(commitStatus?.url),
    }
  }
  if (triggerId && PULL_REQUEST_TRIGGER_IDS.has(triggerId)) {
    const input = { ...base, ...pullRequestFields(b) }
    if (PULL_REQUEST_APPROVAL_TRIGGER_IDS.has(triggerId)) {
      return { ...input, approval: toRecordOrNull(b.approval) }
    }
    if (PULL_REQUEST_CHANGES_REQUEST_TRIGGER_IDS.has(triggerId)) {
      return { ...input, changesRequest: toRecordOrNull(b.changes_request) }
    }
    if (PULL_REQUEST_COMMENT_TRIGGER_IDS.has(triggerId)) {
      return { ...input, ...commentFields(b) }
    }
    return input
  }

  return base
}

export const bitbucketHandler: WebhookProviderHandler = {
  verifyAuth: createHmacVerifier({
    configKey: 'webhookSecret',
    headerName: 'X-Hub-Signature',
    validateFn: validateBitbucketSignature,
    providerLabel: 'Bitbucket',
    requireSecret: true,
  }),

  async matchEvent({ request, requestId, providerConfig }: EventMatchContext) {
    const triggerId = providerConfig.triggerId as string | undefined
    const eventKey = request.headers.get('X-Event-Key') || ''
    const { isBitbucketEventMatch } = await import('@/triggers/bitbucket/utils')

    if (!triggerId || !isBitbucketEventMatch(triggerId, eventKey)) {
      logger.debug(
        `[${requestId}] Bitbucket event '${eventKey}' does not match trigger '${triggerId || 'unknown'}', skipping`
      )
      return false
    }
    return true
  },

  enrichHeaders(_ctx, headers) {
    const requestUuid = headers['x-request-uuid']?.trim()
    if (requestUuid) headers['x-sim-idempotency-key'] = requestUuid
  },

  async formatInput({ body, headers, webhook }: FormatInputContext): Promise<FormatInputResult> {
    const config = getProviderConfig(webhook)
    return {
      input: formatBitbucketInput(config.triggerId as string | undefined, body, headers),
    }
  },

  async createSubscription(ctx: SubscriptionContext): Promise<SubscriptionResult | undefined> {
    const config = getProviderConfig(ctx.webhook)
    const triggerId = config.triggerId as string | undefined
    const credentialId = config.credentialId as string | undefined
    const workspaceSlug = readRequiredConfigString(config, 'workspaceSlug', 'workspace')
    const repoSlug = readRequiredConfigString(config, 'repoSlug', 'repository')

    const { getBitbucketEventForTrigger } = await import('@/triggers/bitbucket/utils')
    const eventKey = triggerId ? getBitbucketEventForTrigger(triggerId) : undefined
    if (!triggerId || !eventKey) {
      throw new Error(`Unknown Bitbucket trigger type: ${triggerId || 'missing'}`)
    }

    const accessToken = await resolveBitbucketAccessToken(credentialId, ctx.requestId)
    const callbackUrl = getNotificationUrl(ctx.webhook)
    const description = `Sim workflow trigger (${triggerId})`
    const webhookSecret = generateId()
    const hooksUrl = bitbucketHooksUrl(workspaceSlug, repoSlug)
    const response = await fetch(hooksUrl, {
      method: 'POST',
      headers: bitbucketHeaders(accessToken, { json: true }),
      body: JSON.stringify({
        description,
        url: callbackUrl,
        active: true,
        secret: webhookSecret,
        events: [eventKey],
      }),
    })

    if (!response.ok) {
      const detail = await readBitbucketErrorDetail(response)
      logger.error(`[${ctx.requestId}] Failed to create Bitbucket webhook (${response.status})`, {
        detail,
        workspaceSlug,
        repoSlug,
        triggerId,
      })
      throw createBitbucketApiError(response.status, 'create', detail)
    }

    const created = toRecord(await response.json().catch(() => null))
    const externalId = nullableString(created.uuid)?.trim() || null
    if (!externalId) {
      await cleanupBitbucketHookByUrl(
        workspaceSlug,
        repoSlug,
        accessToken,
        callbackUrl,
        description,
        ctx.requestId
      )
      throw new Error('Bitbucket webhook was created but no hook UUID was returned.')
    }

    logger.info(
      `[${ctx.requestId}] Created Bitbucket webhook ${externalId} for ${workspaceSlug}/${repoSlug}`
    )
    return {
      providerConfigUpdates: { externalId, webhookSecret, eventTypes: [eventKey] },
    }
  },

  async deleteSubscription(ctx: DeleteSubscriptionContext): Promise<void> {
    try {
      const config = getProviderConfig(ctx.webhook)
      const credentialId = config.credentialId as string | undefined
      const externalId =
        typeof config.externalId === 'string' ? config.externalId.trim() : undefined
      const workspaceSlug =
        typeof config.workspaceSlug === 'string' ? config.workspaceSlug.trim() : undefined
      const repoSlug = typeof config.repoSlug === 'string' ? config.repoSlug.trim() : undefined

      if (!credentialId || !externalId || !workspaceSlug || !repoSlug) {
        const message =
          'Missing Bitbucket credential, workspace, repository, or hook UUID for webhook deletion.'
        if (ctx.strict) throw new Error(message)
        logger.warn(`[${ctx.requestId}] ${message}`)
        return
      }

      const accessToken = await resolveBitbucketAccessToken(credentialId, ctx.requestId)
      const hooksUrl = bitbucketHooksUrl(workspaceSlug, repoSlug)
      const response = await fetch(
        `${hooksUrl}/${encodeBitbucketSegment(externalId, 'externalId')}`,
        {
          method: 'DELETE',
          headers: bitbucketHeaders(accessToken),
        }
      )

      if (!response.ok && response.status !== 404) {
        const detail = await readBitbucketErrorDetail(response)
        throw createBitbucketApiError(response.status, 'delete', detail)
      }

      logger.info(`[${ctx.requestId}] Deleted Bitbucket webhook ${externalId}`)
    } catch (error) {
      logger.warn(`[${ctx.requestId}] Error deleting Bitbucket webhook (non-fatal)`, error)
      if (ctx.strict) throw error
    }
  },
}
