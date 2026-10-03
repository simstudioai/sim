import { toError } from '@sim/utils/errors'
import { isRecordLike } from '@sim/utils/object'
import { readResponseJsonWithLimit } from '@/lib/core/utils/stream-limits'
import { SlackDeliveryError } from '@/lib/webhooks/slack-delivery-error'

export type SlackStreamChunk =
  | { type: 'markdown_text'; text: string }
  | {
      type: 'task_update'
      id: string
      title: string
      status: 'in_progress' | 'complete' | 'error'
      details?: string
      output?: string
    }

interface SlackApiResponse {
  ok?: boolean
  error?: string
  channel?: string
  ts?: string
  status?: string
  agent_status?: string
  response_metadata?: unknown
}

interface SlackStreamTarget {
  channel: string
  threadTs: string
  initiatorUserId?: string
  recipientUserId?: string
  recipientTeamId?: string
}

/** Slack acknowledgments can include the full accumulated message, including task cards. */
const MAX_SLACK_RESPONSE_BYTES = 4 * 1024 * 1024

async function callSlackAgentApi(
  method: string,
  token: string,
  body: Record<string, unknown>,
  signal?: AbortSignal
): Promise<SlackApiResponse> {
  let response: Response
  try {
    response = await fetch(`https://slack.com/api/${method}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify(body),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(15_000)])
        : AbortSignal.timeout(15_000),
    })
  } catch {
    throw new SlackDeliveryError(method, 'uncertain', 'transport_failed')
  }
  let value: unknown
  try {
    value = await readResponseJsonWithLimit(response, {
      maxBytes: MAX_SLACK_RESPONSE_BYTES,
      label: `Slack ${method}`,
    })
  } catch {
    throw new SlackDeliveryError(method, 'uncertain', 'unreadable_acknowledgment', response.status)
  }
  if (!isRecordLike(value)) {
    throw new SlackDeliveryError(method, 'uncertain', 'invalid_acknowledgment', response.status)
  }
  const data = value as SlackApiResponse
  if (!response.ok || data.ok !== true) {
    throw new SlackDeliveryError(
      method,
      data.ok === false ? 'rejected' : 'uncertain',
      typeof data.error === 'string' && /^[a-z_]+$/.test(data.error)
        ? data.error
        : 'invalid_acknowledgment',
      response.status
    )
  }
  return data
}

export async function setSlackAgentSessionStatus(
  token: string,
  target: Pick<SlackStreamTarget, 'channel' | 'threadTs' | 'initiatorUserId'>,
  status: 'active' | 'processing' | 'suspended',
  signal?: AbortSignal
): Promise<void> {
  const data = await callSlackAgentApi(
    'agents.sessions.setStatus',
    token,
    {
      channel_id: target.channel,
      thread_ts: target.threadTs,
      status,
      ...(target.initiatorUserId ? { initiator_user_id: target.initiatorUserId } : {}),
    },
    signal
  )

  const responseMetadata = data.response_metadata
  if (responseMetadata !== undefined && !isRecordLike(responseMetadata)) {
    throw new Error('Slack agents.sessions.setStatus returned invalid response metadata')
  }
  const warnings = responseMetadata?.warnings
  if (
    warnings !== undefined &&
    (!Array.isArray(warnings) || warnings.some((warning) => typeof warning !== 'string'))
  ) {
    throw new Error('Slack agents.sessions.setStatus returned invalid warnings')
  }
  if (warnings?.includes('missing_agent_session_stopped_event_subscription')) {
    throw new Error(
      'Slack agents.sessions.setStatus warning: missing_agent_session_stopped_event_subscription'
    )
  }
  if (data.agent_status !== status) {
    throw new Error(
      `Slack agents.sessions.setStatus returned agent_status=${String(data.agent_status)}; expected ${status}`
    )
  }
}

export async function startSlackAgentStream(
  token: string,
  target: SlackStreamTarget,
  chunks: SlackStreamChunk[],
  taskDisplayMode: 'timeline' | 'plan',
  signal?: AbortSignal
): Promise<{ channel: string; ts: string }> {
  const data = await callSlackAgentApi(
    'chat.startStream',
    token,
    {
      channel: target.channel,
      thread_ts: target.threadTs,
      chunks,
      task_display_mode: taskDisplayMode,
      ...(target.recipientUserId ? { recipient_user_id: target.recipientUserId } : {}),
      ...(target.recipientTeamId ? { recipient_team_id: target.recipientTeamId } : {}),
    },
    signal
  )
  if (typeof data.channel !== 'string' || typeof data.ts !== 'string') {
    throw new SlackDeliveryError('chat.startStream', 'uncertain', 'missing_stream_identity')
  }
  return { channel: data.channel, ts: data.ts }
}

export async function appendSlackAgentStream(
  token: string,
  channel: string,
  ts: string,
  chunks: SlackStreamChunk[],
  signal?: AbortSignal
): Promise<void> {
  if (chunks.length === 0) return
  await callSlackAgentApi('chat.appendStream', token, { channel, ts, chunks }, signal)
}

export async function stopSlackAgentStream(
  token: string,
  channel: string,
  ts: string,
  sessionStatus: 'active' | 'processing' | 'suspended',
  signal?: AbortSignal,
  blocks?: Record<string, unknown>[],
  chunks?: SlackStreamChunk[]
): Promise<void> {
  await callSlackAgentApi(
    'chat.stopStream',
    token,
    {
      channel,
      ts,
      session_status: sessionStatus,
      ...(blocks?.length ? { blocks } : {}),
      ...(chunks?.length ? { chunks } : {}),
    },
    signal
  )
}

export function formatSlackApiFailure(error: unknown): Error {
  return toError(error)
}
