import { verifyTwilioAuth } from '@/lib/webhooks/providers/twilio-signature'
import type {
  AuthContext,
  FormatInputContext,
  FormatInputResult,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'

/**
 * Build the media array from Twilio's `NumMedia` / `MediaUrl{N}` /
 * `MediaContentType{N}` params (MMS messages).
 */
function extractMedia(b: Record<string, unknown>): Array<{ url: unknown; contentType: unknown }> {
  const numMedia = Number.parseInt((b.NumMedia as string) ?? '0', 10) || 0
  const media: Array<{ url: unknown; contentType: unknown }> = []
  for (let i = 0; i < numMedia; i++) {
    media.push({ url: b[`MediaUrl${i}`], contentType: b[`MediaContentType${i}`] })
  }
  return media
}

export const twilioHandler: WebhookProviderHandler = {
  verifyAuth(ctx: AuthContext) {
    return verifyTwilioAuth(ctx, 'Twilio SMS')
  },

  extractIdempotencyId(body: unknown) {
    const obj = body as Record<string, unknown>
    return (obj.MessageSid as string) || (obj.CallSid as string) || null
  },

  async formatInput({ body }: FormatInputContext): Promise<FormatInputResult> {
    const b = body as Record<string, unknown>
    return {
      input: {
        messageSid: b.MessageSid,
        accountSid: b.AccountSid,
        messagingServiceSid: b.MessagingServiceSid,
        from: b.From,
        to: b.To,
        body: b.Body,
        numMedia: b.NumMedia,
        numSegments: b.NumSegments,
        media: extractMedia(b),
        smsStatus: b.SmsStatus,
        messageStatus: b.MessageStatus,
        errorCode: b.ErrorCode,
        apiVersion: b.ApiVersion,
        fromCity: b.FromCity,
        fromState: b.FromState,
        fromZip: b.FromZip,
        fromCountry: b.FromCountry,
        toCity: b.ToCity,
        toState: b.ToState,
        toZip: b.ToZip,
        toCountry: b.ToCountry,
        raw: JSON.stringify(b),
      },
    }
  },
}
