import type {
  FormatInputContext,
  FormatInputResult,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'

export const calendlyHandler: WebhookProviderHandler = {
  async formatInput({ body }: FormatInputContext): Promise<FormatInputResult> {
    const b = body as Record<string, unknown>
    return {
      input: {
        event: b.event,
        created_at: b.created_at,
        created_by: b.created_by,
        payload: b.payload,
      },
    }
  },
}
