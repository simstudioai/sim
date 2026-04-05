import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import type { AuthContext, WebhookProviderHandler } from '@/lib/webhooks/providers/types'
import { convertSquareBracketsToTwiML } from '@/lib/webhooks/utils'
import { validateTwilioSignature } from '@/lib/webhooks/utils.server'

const logger = createLogger('WebhookProvider:TwilioVoice')

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
