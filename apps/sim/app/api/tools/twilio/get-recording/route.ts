import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { twilioGetRecordingContract } from '@/lib/api/contracts/tools/communication/messaging'
import { parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import {
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getExtensionFromMimeType } from '@/lib/uploads/utils/file-utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('TwilioGetRecordingAPI')

/**
 * Shape of a Twilio resource identifier.
 *
 * Twilio documents every resource id as a 34-character String Identifier: a
 * two-letter prefix followed by 32 hexadecimal digits. No `/`, `\`, dot
 * segment, `?`, or `#` is legal in one, so pinning the shape has zero
 * false-rejection risk while closing the path zone entirely.
 *
 * This matters because both `accountSid` and `recordingSid` arrive in the
 * request body rather than from a credential, and `recordingSid` is
 * `visibility: 'user-or-llm'` on the calling tool. `validateUrlWithDNS` pins
 * the *host*, not the path, so an unguarded `recordingSid` of `../Messages`
 * re-aimed this route at an arbitrary resource in the caller's account — which
 * it then refetched with the caller's Basic auth and returned base64-encoded as
 * a `file` output.
 */
const ACCOUNT_SID_PATTERN = /^AC[0-9a-fA-F]{32}$/
const RECORDING_SID_PATTERN = /^RE[0-9a-fA-F]{32}$/

/**
 * Ceiling on the downloaded recording media.
 *
 * This route returns the media base64-encoded inside its JSON body, and the
 * executor reads an internal tool response through `readToolResponseBody`,
 * which caps at `MAX_TOOL_RESPONSE_BODY_BYTES` (10 MB). Base64 inflates by 4/3,
 * so the largest recording that can survive the round trip is ~7.5 MB of raw
 * audio. Inheriting `DEFAULT_MAX_RESPONSE_BYTES` (100 MB) meant anything larger
 * downloaded and encoded in full — peaking at hundreds of MB of live
 * allocation — only for the executor to reject the body afterwards with "Tool
 * response size limit exceeded". Capping at the reachable size makes the
 * transport limit enforce itself while the bytes are still streaming.
 */
export const MAX_TWILIO_RECORDING_BYTES = 7 * 1024 * 1024

interface TwilioRecordingResponse {
  sid?: string
  call_sid?: string
  duration?: string
  status?: string
  channels?: number
  source?: string
  price?: string
  price_unit?: string
  uri?: string
  error_code?: number
  message?: string
  error_message?: string
}

interface TwilioErrorResponse {
  message?: string
}

interface TwilioTranscription {
  transcription_text?: string
  status?: string
  price?: string
  price_unit?: string
}

interface TwilioTranscriptionsResponse {
  transcriptions?: TwilioTranscription[]
}

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })

    if (!authResult.success) {
      logger.warn(`[${requestId}] Unauthorized Twilio get recording attempt: ${authResult.error}`)
      return NextResponse.json(
        {
          success: false,
          error: authResult.error || 'Authentication required',
        },
        { status: 401 }
      )
    }

    const parsed = await parseRequest(twilioGetRecordingContract, request, {})
    if (!parsed.success) return parsed.response
    const { accountSid, authToken, recordingSid } = parsed.data.body

    if (!ACCOUNT_SID_PATTERN.test(accountSid)) {
      return NextResponse.json(
        {
          success: false,
          error: `Invalid Account SID format. Account SID must be "AC" followed by 32 hexadecimal digits (you provided: ${accountSid.substring(0, 2)}...)`,
        },
        { status: 400 }
      )
    }

    if (!RECORDING_SID_PATTERN.test(recordingSid)) {
      return NextResponse.json(
        {
          success: false,
          error: `Invalid Recording SID format. Recording SID must be "RE" followed by 32 hexadecimal digits (you provided: ${recordingSid.substring(0, 2)}...)`,
        },
        { status: 400 }
      )
    }

    const twilioAuth = Buffer.from(`${accountSid}:${authToken}`).toString('base64')

    logger.info(`[${requestId}] Getting recording info from Twilio`, { recordingSid })

    const infoUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Recordings/${recordingSid}.json`
    const infoUrlValidation = await validateUrlWithDNS(infoUrl, 'infoUrl')
    if (!infoUrlValidation.isValid) {
      return NextResponse.json({ success: false, error: infoUrlValidation.error }, { status: 400 })
    }

    const infoResponse = await secureFetchWithPinnedIP(infoUrl, infoUrlValidation.resolvedIP!, {
      method: 'GET',
      headers: { Authorization: `Basic ${twilioAuth}` },
    })

    if (!infoResponse.ok) {
      const errorData = (await infoResponse.json().catch(() => ({}))) as TwilioErrorResponse
      logger.error(`[${requestId}] Twilio API error`, {
        status: infoResponse.status,
        error: errorData,
      })
      return NextResponse.json(
        { success: false, error: errorData.message || `Twilio API error: ${infoResponse.status}` },
        { status: 400 }
      )
    }

    const data = (await infoResponse.json()) as TwilioRecordingResponse

    if (data.error_code) {
      return NextResponse.json({
        success: false,
        output: {
          success: false,
          error: data.message || data.error_message || 'Failed to retrieve recording',
        },
        error: data.message || data.error_message || 'Failed to retrieve recording',
      })
    }

    const baseUrl = 'https://api.twilio.com'
    const mediaUrl = data.uri ? `${baseUrl}${data.uri.replace('.json', '')}` : undefined

    let transcriptionText: string | undefined
    let transcriptionStatus: string | undefined
    let transcriptionPrice: string | undefined
    let transcriptionPriceUnit: string | undefined
    let file:
      | {
          name: string
          mimeType: string
          data: string
          size: number
        }
      | undefined

    try {
      const transcriptionQuery = new URLSearchParams({ RecordingSid: data.sid ?? recordingSid })
      const transcriptionUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Transcriptions.json?${transcriptionQuery}`
      logger.info(`[${requestId}] Checking for transcriptions`)

      const transcriptionUrlValidation = await validateUrlWithDNS(
        transcriptionUrl,
        'transcriptionUrl'
      )
      if (transcriptionUrlValidation.isValid) {
        const transcriptionResponse = await secureFetchWithPinnedIP(
          transcriptionUrl,
          transcriptionUrlValidation.resolvedIP!,
          {
            method: 'GET',
            headers: { Authorization: `Basic ${twilioAuth}` },
          }
        )

        if (transcriptionResponse.ok) {
          const transcriptionData =
            (await transcriptionResponse.json()) as TwilioTranscriptionsResponse

          if (transcriptionData.transcriptions && transcriptionData.transcriptions.length > 0) {
            const transcription = transcriptionData.transcriptions[0]
            transcriptionText = transcription.transcription_text
            transcriptionStatus = transcription.status
            transcriptionPrice = transcription.price
            transcriptionPriceUnit = transcription.price_unit
            logger.info(`[${requestId}] Transcription found`, {
              status: transcriptionStatus,
              textLength: transcriptionText?.length,
            })
          }
        }
      }
    } catch (error) {
      logger.warn(`[${requestId}] Failed to fetch transcription:`, error)
    }

    if (mediaUrl) {
      try {
        const mediaUrlValidation = await validateUrlWithDNS(mediaUrl, 'mediaUrl')
        if (mediaUrlValidation.isValid) {
          const mediaResponse = await secureFetchWithPinnedIP(
            mediaUrl,
            mediaUrlValidation.resolvedIP!,
            {
              method: 'GET',
              headers: { Authorization: `Basic ${twilioAuth}` },
              maxResponseBytes: MAX_TWILIO_RECORDING_BYTES,
            }
          )

          if (mediaResponse.ok) {
            const contentType =
              mediaResponse.headers.get('content-type') || 'application/octet-stream'
            const extension = getExtensionFromMimeType(contentType) || 'dat'
            const arrayBuffer = await mediaResponse.arrayBuffer()
            const buffer = Buffer.from(arrayBuffer)
            const fileName = `${data.sid || recordingSid}.${extension}`

            file = {
              name: fileName,
              mimeType: contentType,
              data: buffer.toString('base64'),
              size: buffer.length,
            }
          }
        }
      } catch (error) {
        logger.warn(`[${requestId}] Failed to download recording media:`, error)
      }
    }

    logger.info(`[${requestId}] Twilio recording fetched successfully`, {
      recordingSid: data.sid,
      hasFile: !!file,
      hasTranscription: !!transcriptionText,
    })

    return NextResponse.json({
      success: true,
      output: {
        success: true,
        recordingSid: data.sid,
        callSid: data.call_sid,
        duration: data.duration ? Number.parseInt(data.duration, 10) : undefined,
        status: data.status,
        channels: data.channels,
        source: data.source,
        mediaUrl,
        file,
        price: data.price,
        priceUnit: data.price_unit,
        uri: data.uri,
        transcriptionText,
        transcriptionStatus,
        transcriptionPrice,
        transcriptionPriceUnit,
      },
    })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching Twilio recording:`, error)
    return NextResponse.json(
      {
        success: false,
        error: getErrorMessage(error, 'Unknown error occurred'),
      },
      { status: 500 }
    )
  }
})
