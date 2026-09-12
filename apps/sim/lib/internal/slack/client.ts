import { secureFetchWithValidation } from '@/lib/core/security/input-validation.server'
import { isPayloadSizeLimitError, readResponseJsonWithLimit } from '@/lib/core/utils/stream-limits'

const MAX_SLACK_JSON_BYTES = 2 * 1024 * 1024

export type SlackJsonObject = Record<string, unknown>

export interface SlackApiResult {
  data: SlackJsonObject
  status: number
  statusText: string
  grantedScopes?: string[]
}

export interface SlackApiRequest {
  accessToken: string
  method: string
  httpMethod?: 'GET' | 'POST'
  body?: SlackJsonObject | URLSearchParams
  query?: Record<string, string | number | undefined>
  signal?: AbortSignal
  tolerateInvalidErrorJson?: boolean
}

export interface SlackMessage {
  channel: string
  text: string
  thread_ts?: string
  blocks?: unknown[]
  unfurl_links?: boolean
  unfurl_media?: boolean
}

/** Shared provider primitive for workflow tools and application-owned Slack responses. */
export function postSlackMessage(accessToken: string, message: SlackMessage, signal?: AbortSignal) {
  return requestSlackApi({ accessToken, method: 'chat.postMessage', body: { ...message }, signal })
}

function isSlackJsonObject(value: unknown): value is SlackJsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function slackString(data: SlackJsonObject, key: string): string | undefined {
  const value = data[key]
  return typeof value === 'string' ? value : undefined
}

export function slackObject(data: SlackJsonObject, key: string): SlackJsonObject | undefined {
  const value = data[key]
  return isSlackJsonObject(value) ? value : undefined
}

export function slackArray(data: SlackJsonObject, key: string): unknown[] | undefined {
  const value = data[key]
  return Array.isArray(value) ? value : undefined
}

export function slackOk(data: SlackJsonObject): boolean {
  return data.ok === true
}

/** Calls one fixed Slack Web API method with bounded JSON parsing and caller cancellation. */
export async function requestSlackApi({
  accessToken,
  method,
  httpMethod = 'POST',
  body,
  query,
  signal,
  tolerateInvalidErrorJson,
}: SlackApiRequest): Promise<SlackApiResult> {
  signal?.throwIfAborted()
  const url = new URL(`https://slack.com/api/${method}`)
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value))
  }

  const isForm = body instanceof URLSearchParams
  const response = await secureFetchWithValidation(url.toString(), {
    profile: 'configuredEndpoint',
    redirectPolicy: { mode: 'standard', sendCredentialsOnCrossOriginRedirect: false },
    maxResponseBytes: MAX_SLACK_JSON_BYTES,
    method: httpMethod,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(httpMethod === 'POST'
        ? {
            'Content-Type': isForm ? 'application/x-www-form-urlencoded' : 'application/json',
          }
        : {}),
    },
    ...(body ? { body: isForm ? body.toString() : JSON.stringify(body) } : {}),
    signal,
  })
  signal?.throwIfAborted()
  let parsed: unknown
  try {
    parsed = await readResponseJsonWithLimit<unknown>(response, {
      maxBytes: MAX_SLACK_JSON_BYTES,
      label: 'Slack API response',
    })
  } catch (error) {
    if (!response.ok && tolerateInvalidErrorJson && !isPayloadSizeLimitError(error)) {
      parsed = {}
    } else {
      throw error
    }
  }
  signal?.throwIfAborted()
  if (!isSlackJsonObject(parsed)) throw new Error('Slack API returned an invalid response')
  const scopeHeader = response.headers.get('x-oauth-scopes')
  return {
    data: parsed,
    status: response.status,
    statusText: response.statusText,
    ...(scopeHeader !== null
      ? {
          grantedScopes: scopeHeader
            .split(',')
            .map((scope) => scope.trim())
            .filter(Boolean),
        }
      : {}),
  }
}

/** Opens a Slack direct-message conversation while retaining the legacy thrown-error behavior. */
export async function openSlackDm(
  accessToken: string,
  userId: string,
  signal?: AbortSignal
): Promise<string> {
  const { data } = await requestSlackApi({
    accessToken,
    method: 'conversations.open',
    body: { users: userId },
    signal,
  })
  if (!slackOk(data)) {
    throw new Error(slackString(data, 'error') || 'Failed to open DM channel with user')
  }
  const channelId = slackString(slackObject(data, 'channel') ?? {}, 'id')
  if (!channelId) throw new Error('Failed to open DM channel with user')
  return channelId
}
