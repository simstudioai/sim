import { isRecordLike } from '@sim/utils/object'
import { NextResponse } from 'next/server'
import { verifyTwilioAuth } from '@/lib/webhooks/providers/twilio-signature'
import type {
  AuthContext,
  FormatInputContext,
  FormatInputResult,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'
import { convertSquareBracketsToTwiML } from '@/lib/webhooks/utils'

export const twilioVoiceHandler: WebhookProviderHandler = {
  verifyAuth(ctx: AuthContext) {
    return verifyTwilioAuth(ctx, 'Twilio Voice')
  },

  extractIdempotencyId(body: unknown) {
    if (!isRecordLike(body)) return null
    return (body.MessageSid as string) || (body.CallSid as string) || null
  },

  formatSuccessResponse(providerConfig: Record<string, unknown>) {
    const twimlResponse = (providerConfig.twimlResponse as string | undefined)?.trim()

    if (twimlResponse && twimlResponse.length > 0) {
      const convertedTwiml = convertSquareBracketsToTwiML(twimlResponse)
      return new NextResponse(convertedTwiml, {
        status: 200,
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
        },
      })
    }

    const defaultTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Your call is being processed.</Say>
  <Pause length="1"/>
</Response>`

    return new NextResponse(defaultTwiml, {
      status: 200,
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
      },
    })
  },

  async formatInput({ body }: FormatInputContext): Promise<FormatInputResult> {
    const b = isRecordLike(body) ? body : {}
    return {
      input: {
        callSid: b.CallSid,
        accountSid: b.AccountSid,
        from: b.From,
        to: b.To,
        callStatus: b.CallStatus,
        direction: b.Direction,
        apiVersion: b.ApiVersion,
        callerName: b.CallerName,
        forwardedFrom: b.ForwardedFrom,
        digits: b.Digits,
        speechResult: b.SpeechResult,
        recordingUrl: b.RecordingUrl,
        recordingSid: b.RecordingSid,
        called: b.Called,
        caller: b.Caller,
        toCity: b.ToCity,
        toState: b.ToState,
        toZip: b.ToZip,
        toCountry: b.ToCountry,
        fromCity: b.FromCity,
        fromState: b.FromState,
        fromZip: b.FromZip,
        fromCountry: b.FromCountry,
        calledCity: b.CalledCity,
        calledState: b.CalledState,
        calledZip: b.CalledZip,
        calledCountry: b.CalledCountry,
        callerCity: b.CallerCity,
        callerState: b.CallerState,
        callerZip: b.CallerZip,
        callerCountry: b.CallerCountry,
        callToken: b.CallToken,
        raw: JSON.stringify(b),
      },
    }
  },

  formatQueueErrorResponse() {
    const errorTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>We're sorry, but an error occurred processing your call. Please try again later.</Say>
  <Hangup/>
</Response>`

    return new NextResponse(errorTwiml, {
      status: 200,
      headers: {
        'Content-Type': 'text/xml',
      },
    })
  },
}
