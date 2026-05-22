export type EmailType = 'transactional' | 'marketing' | 'updates' | 'notifications'

export interface EmailAttachment {
  filename: string
  content: string | Buffer
  contentType: string
  disposition?: 'attachment' | 'inline'
}

export interface EmailOptions {
  to: string | string[]
  subject: string
  html?: string
  text?: string
  from?: string
  emailType?: EmailType
  includeUnsubscribe?: boolean
  attachments?: EmailAttachment[]
  replyTo?: string
}

export interface BatchEmailOptions {
  emails: EmailOptions[]
}

export interface SendEmailResult {
  success: boolean
  message: string
  data?: unknown
}

export interface BatchSendEmailResult {
  success: boolean
  message: string
  results: SendEmailResult[]
  data?: unknown
}

/**
 * A fully-prepared email, ready for any provider to dispatch.
 * Headers, sender, subject sanitization, and unsubscribe injection
 * are already applied — providers only translate this shape into
 * their own API and send.
 */
export interface ProcessedEmailData {
  to: string | string[]
  subject: string
  html?: string
  text?: string
  senderEmail: string
  headers: Record<string, string>
  attachments?: EmailAttachment[]
  replyTo?: string
}

export type MailProviderName = 'resend' | 'ses' | 'smtp' | 'azure'

/**
 * A transport for sending email. Providers receive normalized data
 * and translate it to their own SDK. `sendBatch` is optional — providers
 * with a native batch API implement it; otherwise the orchestrator
 * falls back to per-message sends.
 */
export interface MailProvider {
  readonly name: MailProviderName
  send(data: ProcessedEmailData): Promise<SendEmailResult>
  sendBatch?(emails: ProcessedEmailData[]): Promise<BatchSendEmailResult>
}
