import crypto from 'crypto'
import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { safeCompare } from '@/lib/core/security/encryption'
import type {
  AuthContext,
  FormatInputContext,
  FormatInputResult,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'
import { convertSquareBracketsToTwiML } from '@/lib/webhooks/utils'

const logger = createLogger('WebhookProvider:TwilioVoice')

async function validateTwilioSignature(
  authToken: string,
  signature: string,
  url: string,
  params: Record<string, unknown>
): Promise<boolean> {
  try {
    if (!authToken || !signature || !url) {
      logger.warn('Twilio signature validation missing required fields', {
        hasAuthToken: !!authToken,
        hasSignature: !!signature,
        hasUrl: !!url,
      })
      return false
    }
    const sortedKeys = Object.keys(params).sort()
    let data = url
    for (const key of sortedKeys) {
      data += key + params[key]
    }
    logger.debug('Twilio signature validation string built', {
      url,
      sortedKeys,
      dataLength: data.length,
    })
    const encoder = new TextEncoder()
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(authToken),
      { name: 'HMAC', hash: 'SHA-1' },
      false,
      ['sign']
    )
    const signatureBytes = await crypto.subtle.sign('HMAC', key, encoder.encode(data))
    const signatureArray = Array.from(new Uint8Array(signatureBytes))
    const signatureBase64 = btoa(String.fromCharCode(...signatureArray))
    logger.debug('Twilio signature comparison', {
      computedSignature: `${signatureBase64.substring(0, 10)}...`,
      providedSignature: `${signature.substring(0, 10)}...`,
      computedLength: signatureBase64.length,
      providedLength: signature.length,
      match: signatureBase64 === signature,
    })
    return safeCompare(signatureBase64, signature)
  } catch (error) {
    logger.error('Error validating Twilio signature:', error)
    return false
  }
}

function getExternalUrl(request: Request): string {
  const proto = request.headers.get('x-forwarded-proto') || 'https'
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host')

  if (host) {
    const url = new URL(request.url)
    const reconstructed = `${proto}://${host}${url.pathname}${url.search}`
    return reconstructed
  }

  return request.url
}

export const twilioVoiceHandler: WebhookProviderHandler = {
  async verifyAuth({ request, rawBody, requestId, providerConfig }: AuthContext) {
    const authToken = providerConfig.authToken as string | undefined

    if (authToken) {
      const signature = request.headers.get('x-twilio-signature')

      if (!signature) {
        logger.warn(`[${requestId}] Twilio Voice webhook missing signature header`)
        return new NextResponse('Unauthorized - Missing Twilio signature', {
          status: 401,
        })
      }

      let params: Record<string, string> = {}
      try {
        if (typeof rawBody === 'string') {
          const urlParams = new URLSearchParams(rawBody)
          params = Object.fromEntries(urlParams.entries())
        }
      } catch (error) {
        logger.error(
          `[${requestId}] Error parsing Twilio webhook body for signature validation:`,
          error
        )
        return new NextResponse('Bad Request - Invalid body format', {
          status: 400,
        })
      }

      const fullUrl = getExternalUrl(request)
      const isValidSignature = await validateTwilioSignature(authToken, signature, fullUrl, params)

      if (!isValidSignature) {
        logger.warn(`[${requestId}] Twilio Voice signature verification failed`, {
          url: fullUrl,
          signatureLength: signature.length,
          paramsCount: Object.keys(params).length,
          authTokenLength: authToken.length,
        })
        return new NextResponse('Unauthorized - Invalid Twilio signature', {
          status: 401,
        })
      }
    }

    return null
  },

  extractIdempotencyId(body: unknown) {
    const obj = body as Record<string, unknown>
    return (obj.MessageSid as string) || (obj.CallSid as string) || null
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
    const b = body as Record<string, unknown>
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
