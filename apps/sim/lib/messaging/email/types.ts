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

export interface MailProvider {
  readonly name: MailProviderName
  send(data: ProcessedEmailData): Promise<SendEmailResult>
  sendBatch?(emails: ProcessedEmailData[]): Promise<BatchSendEmailResult>
}
