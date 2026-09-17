import { createLogger } from '@sim/logger'
import { env } from '@/lib/core/config/env'
import { readResponseJsonWithLimit } from '@/lib/core/utils/stream-limits'
import type {
  AgentMailAttachment,
  AgentMailInbox,
  AgentMailMessage,
  AgentMailReplyResponse,
  AgentMailWebhook,
} from '@/lib/mothership/inbox/types'

const logger = createLogger('AgentMailClient')

const BASE_URL = 'https://api.agentmail.to/v0'

function getApiKey(): string {
  const key = env.AGENTMAIL_API_KEY
  if (!key) {
    throw new Error('AGENTMAIL_API_KEY is not configured')
  }
  return key
}

class AgentMailError extends Error {
  constructor(
    readonly status: number,
    path: string
  ) {
    super(
      status === 409
        ? 'This email address is unavailable. Choose another prefix or try again later.'
        : status === 400 && path === '/inboxes'
          ? 'Unable to create this inbox. Check the email prefix and try again, or contact support.'
          : 'The email service is unavailable. Please try again later or contact support.'
    )
    this.name = 'AgentMailError'
  }
}

async function requestResponse(path: string, options: RequestInit = {}): Promise<Response> {
  const url = `${BASE_URL}${path}`
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getApiKey()}`,
      ...options.headers,
    },
  })

  if (!response.ok) {
    logger.error('AgentMail API error', { status: response.status, path })
    await response.body?.cancel()
    throw new AgentMailError(response.status, path)
  }
  return response
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await requestResponse(path, options)
  return response.json() as Promise<T>
}

function withResourceTimeout(options: RequestInit): RequestInit {
  return {
    ...options,
    signal: options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(15_000)])
      : AbortSignal.timeout(15_000),
  }
}

async function requestResource<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await requestResponse(path, withResourceTimeout(options))
  return readResponseJsonWithLimit<T>(response, {
    maxBytes: 64 * 1024,
    label: 'AgentMail resource',
  })
}

/** Treat already-absent resources as deleted, and distinguish asynchronous acceptance. */
async function deleteResource(path: string, signal?: AbortSignal): Promise<boolean> {
  try {
    const response = await requestResponse(path, withResourceTimeout({ method: 'DELETE', signal }))
    await response.body?.cancel()
    return response.status !== 202
  } catch (error) {
    if (error instanceof AgentMailError && error.status === 404) return true
    throw error
  }
}

export async function getInbox(
  inboxId: string,
  signal?: AbortSignal
): Promise<AgentMailInbox | null> {
  try {
    return await requestResource<AgentMailInbox>(`/inboxes/${encodeURIComponent(inboxId)}`, {
      signal,
    })
  } catch (error) {
    if (error instanceof AgentMailError && error.status === 404) return null
    throw error
  }
}

export async function createInbox(opts: {
  username?: string
  displayName?: string
}): Promise<AgentMailInbox> {
  const domain = env.AGENTMAIL_DOMAIN
  return requestResource<AgentMailInbox>('/inboxes', {
    method: 'POST',
    body: JSON.stringify({
      username: opts.username,
      display_name: opts.displayName,
      ...(domain ? { domain } : {}),
    }),
  })
}

export function deleteInbox(inboxId: string, signal?: AbortSignal): Promise<boolean> {
  return deleteResource(`/inboxes/${encodeURIComponent(inboxId)}`, signal)
}

export async function createWebhook(opts: {
  url: string
  eventTypes: string[]
  inboxIds: string[]
}): Promise<AgentMailWebhook> {
  return requestResource<AgentMailWebhook>('/webhooks', {
    method: 'POST',
    body: JSON.stringify({
      url: opts.url,
      event_types: opts.eventTypes,
      inbox_ids: opts.inboxIds,
    }),
  })
}

export function deleteWebhook(webhookId: string, signal?: AbortSignal): Promise<boolean> {
  return deleteResource(`/webhooks/${encodeURIComponent(webhookId)}`, signal)
}

export async function replyToMessage(
  inboxId: string,
  messageId: string,
  opts: {
    text: string
    html?: string
    to?: string[]
    attachments?: AgentMailAttachment[]
  }
): Promise<AgentMailReplyResponse> {
  return request<AgentMailReplyResponse>(
    `/inboxes/${encodeURIComponent(inboxId)}/messages/${encodeURIComponent(messageId)}/reply`,
    {
      method: 'POST',
      body: JSON.stringify({
        text: opts.text,
        html: opts.html,
        to: opts.to,
        attachments: opts.attachments,
      }),
    }
  )
}

export async function getMessage(inboxId: string, messageId: string): Promise<AgentMailMessage> {
  return request<AgentMailMessage>(
    `/inboxes/${encodeURIComponent(inboxId)}/messages/${encodeURIComponent(messageId)}`
  )
}

interface AttachmentMetadata {
  download_url: string
}

export async function getAttachment(
  inboxId: string,
  messageId: string,
  attachmentId: string
): Promise<ArrayBuffer> {
  const path = `/inboxes/${encodeURIComponent(inboxId)}/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`
  const metadata = await request<AttachmentMetadata>(path)

  const response = await fetch(metadata.download_url)
  if (!response.ok) {
    throw new Error(`Failed to download attachment from presigned URL: ${response.status}`)
  }
  return response.arrayBuffer()
}
