import { verifyTwilioAuth } from '@/lib/webhooks/providers/twilio-signature'
import type {
  AuthContext,
  EventMatchContext,
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

  /**
   * Distinguish an inbound SMS from a delivery status callback so the two
   * triggers don't fire on each other's deliveries when they share a URL.
   * Twilio reports status `received` for inbound messages; delivery callbacks
   * carry a non-`received` `MessageStatus` (queued/sent/delivered/…). Each side
   * requires a positive signal, so an ambiguous payload missing both fields
   * matches neither trigger rather than misrouting.
   */
  matchEvent({ body, providerConfig }: EventMatchContext) {
    const triggerId = providerConfig.triggerId as string | undefined
    if (!triggerId) return true
    const b = body as Record<string, unknown>
    const messageStatus = ((b.MessageStatus as string) ?? '').toLowerCase()
    const smsStatus = ((b.SmsStatus as string) ?? '').toLowerCase()
    const isInbound = smsStatus === 'received' || messageStatus === 'received'
    const isStatusCallback = !isInbound && (messageStatus !== '' || smsStatus !== '')
    if (triggerId === 'twilio_sms_received') return isInbound
    if (triggerId === 'twilio_sms_status') return isStatusCallback
    return true
  },

  extractIdempotencyId(body: unknown) {
    const obj = body as Record<string, unknown>
    const sid = (obj.MessageSid as string) || (obj.CallSid as string)
    if (!sid) return null
    // Status callbacks repeat for the same SID as the message progresses
    // (sent -> delivered -> ...), so the delivery status is part of the key to
    // keep each distinct callback (while still deduping Twilio's retries of the
    // same status). Inbound messages fire once (SmsStatus 'received'), keyed by SID.
    const status = (
      ((obj.MessageStatus as string) || (obj.SmsStatus as string)) ??
      ''
    ).toLowerCase()
    return status && status !== 'received' ? `${sid}:${status}` : sid
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
