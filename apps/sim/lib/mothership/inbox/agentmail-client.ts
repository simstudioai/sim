import { createLogger } from '@sim/logger'
import { env } from '@/lib/core/config/env'
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

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
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
    const body = await response.text().catch(() => '')
    logger.error('AgentMail API error', {
      status: response.status,
      path,
      body,
    })
    throw new Error(`AgentMail API error: ${response.status} ${body}`)
  }

  if (response.status === 204) {
    return undefined as T
  }

  return response.json() as Promise<T>
}

export async function createInbox(opts: {
  username?: string
  displayName?: string
}): Promise<AgentMailInbox> {
  const domain = env.AGENTMAIL_DOMAIN
  return request<AgentMailInbox>('/inboxes', {
    method: 'POST',
    body: JSON.stringify({
      username: opts.username,
      display_name: opts.displayName,
      ...(domain ? { domain } : {}),
    }),
  })
}

export async function deleteInbox(inboxId: string): Promise<void> {
  return request<void>(`/inboxes/${encodeURIComponent(inboxId)}`, {
    method: 'DELETE',
  })
}

export async function getInbox(inboxId: string): Promise<AgentMailInbox> {
  return request<AgentMailInbox>(`/inboxes/${encodeURIComponent(inboxId)}`)
}

export async function createWebhook(opts: {
  url: string
  eventTypes: string[]
  inboxIds: string[]
}): Promise<AgentMailWebhook> {
  return request<AgentMailWebhook>('/webhooks', {
    method: 'POST',
    body: JSON.stringify({
      url: opts.url,
      event_types: opts.eventTypes,
      inbox_ids: opts.inboxIds,
    }),
  })
}

export async function deleteWebhook(webhookId: string): Promise<void> {
  return request<void>(`/webhooks/${encodeURIComponent(webhookId)}`, {
    method: 'DELETE',
  })
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
