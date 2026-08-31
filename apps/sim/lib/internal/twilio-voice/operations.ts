import { createLogger } from '@sim/logger'
import {
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import {
  DEFAULT_MAX_ERROR_BODY_BYTES,
  readResponseJsonWithLimit,
  readResponseToBufferWithLimit,
} from '@/lib/core/utils/stream-limits'
import { TwilioVoiceOperationError } from '@/lib/internal/twilio-voice/errors'
import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'
import { getExtensionFromMimeType } from '@/lib/uploads/utils/file-utils'
import type { TwilioGetRecordingOutput, TwilioGetRecordingParams } from '@/tools/twilio_voice/types'

const logger = createLogger('TwilioGetRecordingOperation')
const MAX_TWILIO_JSON_BYTES = 2 * 1024 * 1024

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

interface TwilioTranscription {
  transcription_text?: string
  status?: string
  price?: string
  price_unit?: string
}

export interface TwilioVoiceOperationContext {
  requestId: string
  signal?: AbortSignal
}

async function fetchPinned(
  url: string,
  label: string,
  authHeader: string,
  context: TwilioVoiceOperationContext,
  maxResponseBytes: number
) {
  const validation = await validateUrlWithDNS(url, label, 'configuredEndpoint')
  context.signal?.throwIfAborted()
  if (!validation.isValid) {
    throw new TwilioVoiceOperationError(validation.error || `Invalid ${label}`, 400)
  }
  return secureFetchWithPinnedIP(url, validation.resolvedIP, {
    profile: 'configuredEndpoint',
    method: 'GET',
    headers: { Authorization: authHeader },
    maxResponseBytes,
    signal: context.signal,
  })
}

export async function getTwilioRecording(
  input: TwilioGetRecordingParams,
  context: TwilioVoiceOperationContext
): Promise<TwilioGetRecordingOutput> {
  context.signal?.throwIfAborted()
  if (!input.accountSid.startsWith('AC')) {
    throw new TwilioVoiceOperationError(
      `Invalid Account SID format. Account SID must start with "AC" (you provided: ${input.accountSid.substring(0, 2)}...)`,
      400
    )
  }
  const authHeader = `Basic ${Buffer.from(`${input.accountSid}:${input.authToken}`).toString('base64')}`
  const infoUrl = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(input.accountSid)}/Recordings/${encodeURIComponent(input.recordingSid)}.json`
  const infoResponse = await fetchPinned(
    infoUrl,
    'infoUrl',
    authHeader,
    context,
    MAX_TWILIO_JSON_BYTES
  )
  if (!infoResponse.ok) {
    const error = await readResponseJsonWithLimit<{ message?: string }>(infoResponse, {
      maxBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
      label: 'Twilio recording error response',
      signal: context.signal,
    }).catch(() => ({ message: undefined }))
    throw new TwilioVoiceOperationError(
      error.message || `Twilio API error: ${infoResponse.status}`,
      400
    )
  }
  const data = await readResponseJsonWithLimit<TwilioRecordingResponse>(infoResponse, {
    maxBytes: MAX_TWILIO_JSON_BYTES,
    label: 'Twilio recording response',
    signal: context.signal,
  })
  if (data.error_code) {
    const error = data.message || data.error_message || 'Failed to retrieve recording'
    return { success: false, output: { success: false, error } }
  }

  const mediaUrl = data.uri ? `https://api.twilio.com${data.uri.replace('.json', '')}` : undefined
  let transcription: TwilioTranscription | undefined
  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(input.accountSid)}/Transcriptions.json?RecordingSid=${encodeURIComponent(data.sid || input.recordingSid)}`
    const response = await fetchPinned(
      url,
      'transcriptionUrl',
      authHeader,
      context,
      MAX_TWILIO_JSON_BYTES
    )
    if (response.ok) {
      const payload = await readResponseJsonWithLimit<{
        transcriptions?: TwilioTranscription[]
      }>(response, {
        maxBytes: MAX_TWILIO_JSON_BYTES,
        label: 'Twilio transcription response',
        signal: context.signal,
      })
      transcription = payload.transcriptions?.[0]
    }
  } catch (error) {
    context.signal?.throwIfAborted()
    logger.warn('Failed to fetch Twilio transcription', { requestId: context.requestId, error })
  }

  let file: TwilioGetRecordingOutput['output']['file']
  if (mediaUrl) {
    try {
      const response = await fetchPinned(
        mediaUrl,
        'mediaUrl',
        authHeader,
        context,
        MAX_BUFFERED_TRANSFER_BYTES
      )
      if (response.ok) {
        const mimeType = response.headers.get('content-type') || 'application/octet-stream'
        const buffer = await readResponseToBufferWithLimit(response, {
          maxBytes: MAX_BUFFERED_TRANSFER_BYTES,
          label: 'Twilio recording media',
          signal: context.signal,
        })
        file = {
          name: `${data.sid || input.recordingSid}.${getExtensionFromMimeType(mimeType) || 'dat'}`,
          mimeType,
          data: buffer.toString('base64'),
          size: buffer.length,
        }
      }
    } catch (error) {
      context.signal?.throwIfAborted()
      logger.warn('Failed to download Twilio recording media', {
        requestId: context.requestId,
        error,
      })
    }
  }

  return {
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
      transcriptionText: transcription?.transcription_text,
      transcriptionStatus: transcription?.status,
      transcriptionPrice: transcription?.price,
      transcriptionPriceUnit: transcription?.price_unit,
    },
  }
}
