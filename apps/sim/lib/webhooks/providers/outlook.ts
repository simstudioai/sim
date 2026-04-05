import type {
  FormatInputContext,
  FormatInputResult,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'

export const outlookHandler: WebhookProviderHandler = {
  async formatInput({ body }: FormatInputContext): Promise<FormatInputResult> {
    const b = body as Record<string, unknown>
    if (b && typeof b === 'object' && 'email' in b) {
      return { input: { email: b.email, timestamp: b.timestamp } }
    }
    return { input: b }
  },
}
