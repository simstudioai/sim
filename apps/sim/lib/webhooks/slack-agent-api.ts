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
}

interface SlackStreamTarget {
  channel: string
  threadTs: string
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
  target: Pick<SlackStreamTarget, 'channel' | 'threadTs'>,
  status: 'active' | 'processing' | 'suspended',
  signal?: AbortSignal
): Promise<void> {
  await callSlackAgentApi(
    'agents.sessions.setStatus',
    token,
    { channel_id: target.channel, thread_ts: target.threadTs, status },
    signal
  )
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
