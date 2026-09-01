import { getErrorMessage } from '@sim/utils/errors'
import { isRecordLike } from '@sim/utils/object'

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

async function callSlackAgentApi(
  method: string,
  token: string,
  body: Record<string, unknown>,
  signal?: AbortSignal
): Promise<SlackApiResponse> {
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(body),
    signal,
  })
  const value = (await response.json()) as unknown
  if (!isRecordLike(value)) {
    throw new Error(`Slack ${method} returned an invalid response`)
  }
  const data = value as SlackApiResponse
  if (!response.ok || data.ok !== true) {
    throw new Error(
      data.error
        ? `Slack ${method} failed: ${data.error}`
        : `Slack ${method} failed with status ${response.status}`
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
    throw new Error('Slack chat.startStream response is missing channel or timestamp')
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
  signal?: AbortSignal
): Promise<void> {
  await callSlackAgentApi(
    'chat.stopStream',
    token,
    { channel, ts, session_status: sessionStatus },
    signal
  )
}

export function formatSlackApiFailure(error: unknown): Error {
  return new Error(getErrorMessage(error, 'Slack agent response delivery failed'))
}
