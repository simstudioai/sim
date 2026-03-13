import type { mothershipInboxTask } from '@sim/db'

export type InboxTask = typeof mothershipInboxTask.$inferSelect
export type InboxTaskStatus = 'received' | 'processing' | 'completed' | 'failed' | 'rejected'
export type RejectionReason = 'sender_not_allowed' | 'automated_sender' | 'rate_limit_exceeded'

export interface InboxConfig {
  enabled: boolean
  address: string | null
  providerId: string | null
}

export interface InboxTaskStats {
  total: number
  completed: number
  processing: number
  failed: number
}

export interface AllowedSender {
  id: string
  email: string
  label: string | null
  addedBy: string
  createdAt: Date
}

export interface AgentMailInbox {
  organization_id?: string
  pod_id: string
  inbox_id: string
  display_name: string | null
  client_id?: string | null
  updated_at: string
  created_at: string
}

export interface AgentMailWebhook {
  webhook_id: string
  url: string
  event_types: string[]
  pod_ids?: string[]
  inbox_ids?: string[]
  secret: string
  enabled: boolean
  client_id?: string | null
  updated_at: string
  created_at: string
}

export interface AgentMailMessage {
  message_id: string
  thread_id: string
  inbox_id: string
  organization_id?: string
  from_: string
  to: string[]
  cc: string[]
  bcc?: string[]
  reply_to?: string[]
  subject: string
  preview?: string
  text: string | null
  html: string | null
  attachments: AgentMailAttachment[]
  in_reply_to?: string
  references?: string[]
  labels?: string[]
  sort_key?: string
  updated_at?: string
  created_at: string
}

export interface AgentMailAttachment {
  attachment_id: string
  filename: string
  content_type: string
  size: number
  inline?: boolean
}

export interface AgentMailWebhookPayload {
  event_type: string
  event_id?: string
  message: AgentMailMessage
}

export interface AgentMailReplyResponse {
  message_id: string
}
