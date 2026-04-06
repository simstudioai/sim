import type { WebhookProviderHandler } from '@/lib/webhooks/providers/types'

export const twilioHandler: WebhookProviderHandler = {
  extractIdempotencyId(body: unknown) {
    const obj = body as Record<string, unknown>
    return (obj.MessageSid as string) || (obj.CallSid as string) || null
  },
}
