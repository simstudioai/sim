import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import {
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import { generateRequestId } from '@/lib/core/utils/request'
import { getExtensionFromMimeType } from '@/lib/uploads/utils/file-utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('TwilioGetRecordingAPI')

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

const TwilioGetRecordingSchema = z.object({
  accountSid: z.string().min(1, 'Account SID is required'),
  authToken: z.string().min(1, 'Auth token is required'),
  recordingSid: z.string().min(1, 'Recording SID is required'),
})

export async function POST(request: NextRequest) {
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

    const body = await request.json()
    const validatedData = TwilioGetRecordingSchema.parse(body)

    const { accountSid, authToken, recordingSid } = validatedData

    if (!accountSid.startsWith('AC')) {
      return NextResponse.json(
        {
          success: false,
          error: `Invalid Account SID format. Account SID must start with "AC" (you provided: ${accountSid.substring(0, 2)}...)`,
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
      const transcriptionUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Transcriptions.json?RecordingSid=${data.sid}`
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
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      },
      { status: 500 }
    )
  }
}
