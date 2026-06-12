import { verifyTwilioAuth } from '@/lib/webhooks/providers/twilio-signature'
import type { AuthContext, WebhookProviderHandler } from '@/lib/webhooks/providers/types'

export const twilioHandler: WebhookProviderHandler = {
  verifyAuth(ctx: AuthContext) {
    return verifyTwilioAuth(ctx, 'Twilio SMS')
  },

  extractIdempotencyId(body: unknown) {
    const obj = body as Record<string, unknown>
    return (obj.MessageSid as string) || (obj.CallSid as string) || null
  },
}
