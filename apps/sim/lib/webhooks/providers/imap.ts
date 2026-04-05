import type {
  FormatInputContext,
  FormatInputResult,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'

export const imapHandler: WebhookProviderHandler = {
  async formatInput({ body }: FormatInputContext): Promise<FormatInputResult> {
    const b = body as Record<string, unknown>
    if (b && typeof b === 'object' && 'email' in b) {
      return {
        input: {
          messageId: b.messageId,
          subject: b.subject,
          from: b.from,
          to: b.to,
          cc: b.cc,
          date: b.date,
          bodyText: b.bodyText,
          bodyHtml: b.bodyHtml,
          mailbox: b.mailbox,
          hasAttachments: b.hasAttachments,
          attachments: b.attachments,
          email: b.email,
          timestamp: b.timestamp,
        },
      }
    }
    return { input: b }
  },
}
