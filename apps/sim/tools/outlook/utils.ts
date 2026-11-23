import type {
  CleanedOutlookFlag,
  CleanedOutlookMessage,
  OutlookFollowupFlag,
  OutlookMessage,
  OutlookRecipient,
} from '@/tools/outlook/types'

function mapOutlookRecipients(
  recipients: OutlookRecipient[] | undefined
): Array<{ name?: string; address?: string }> {
  return (
    recipients?.map((recipient) => ({
      name: recipient.emailAddress?.name,
      address: recipient.emailAddress?.address,
    })) ?? []
  )
}

function cleanFlag(flag: OutlookFollowupFlag | undefined): CleanedOutlookFlag | null {
  if (!flag) return null
  return {
    flagStatus: flag.flagStatus ?? null,
    startDateTime: flag.startDateTime ?? null,
    dueDateTime: flag.dueDateTime ?? null,
    completedDateTime: flag.completedDateTime ?? null,
  }
}

/**
 * Maps a Graph `message` to the cleaned shape shared by the read and search tools.
 * @see https://learn.microsoft.com/en-us/graph/api/resources/message
 */
export function cleanOutlookMessage(message: OutlookMessage): CleanedOutlookMessage {
  return {
    id: message.id,
    subject: message.subject,
    bodyPreview: message.bodyPreview,
    body: {
      contentType: message.body?.contentType,
      content: message.body?.content,
    },
    sender: {
      name: message.sender?.emailAddress?.name,
      address: message.sender?.emailAddress?.address,
    },
    from: {
      name: message.from?.emailAddress?.name,
      address: message.from?.emailAddress?.address,
    },
    toRecipients: mapOutlookRecipients(message.toRecipients),
    ccRecipients: mapOutlookRecipients(message.ccRecipients),
    bccRecipients: mapOutlookRecipients(message.bccRecipients),
    replyTo: mapOutlookRecipients(message.replyTo),
    receivedDateTime: message.receivedDateTime,
    sentDateTime: message.sentDateTime,
    hasAttachments: message.hasAttachments,
    isRead: message.isRead,
    importance: message.importance,
    internetMessageId: message.internetMessageId ?? null,
    conversationId: message.conversationId ?? null,
    parentFolderId: message.parentFolderId ?? null,
    categories: message.categories ?? [],
    flag: cleanFlag(message.flag),
    isDraft: message.isDraft ?? null,
    webLink: message.webLink ?? null,
  }
}

function parseRecipientList(value: string | undefined): OutlookRecipient[] {
  if (!value) return []
  return value
    .split(',')
    .map((email) => email.trim())
    .filter((email) => email.length > 0)
    .map((address) => ({ emailAddress: { address } }))
}

/**
 * Builds the optional `message` object for reply, replyAll, and forward actions
 * carrying extra Cc/Bcc recipients, or `null` when none were given.
 * @see https://learn.microsoft.com/en-us/graph/api/message-reply
 */
export function buildOutlookRecipientMessage(input: {
  cc?: string
  bcc?: string
}): { ccRecipients?: OutlookRecipient[]; bccRecipients?: OutlookRecipient[] } | null {
  const ccRecipients = parseRecipientList(input.cc)
  const bccRecipients = parseRecipientList(input.bcc)
  if (ccRecipients.length === 0 && bccRecipients.length === 0) return null
  return {
    ...(ccRecipients.length > 0 ? { ccRecipients } : {}),
    ...(bccRecipients.length > 0 ? { bccRecipients } : {}),
  }
}

const OUTLOOK_IMPORTANCE_VALUES = ['low', 'normal', 'high'] as const
type OutlookImportance = (typeof OUTLOOK_IMPORTANCE_VALUES)[number]

/** Lowercases an importance value; unknown values are dropped so the send still goes out. */
export function normalizeOutlookImportance(value: unknown): OutlookImportance | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  return OUTLOOK_IMPORTANCE_VALUES.find((option) => option === normalized) ?? null
}
