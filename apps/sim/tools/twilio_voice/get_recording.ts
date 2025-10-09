import { createLogger } from '@/lib/logs/console/logger'
import type { TwilioGetRecordingOutput, TwilioGetRecordingParams } from '@/tools/twilio_voice/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('Twilio Voice Get Recording Tool')

export const getRecordingTool: ToolConfig<TwilioGetRecordingParams, TwilioGetRecordingOutput> = {
  id: 'twilio_voice_get_recording',
  name: 'Twilio Voice Get Recording',
  description: 'Retrieve information about a call recording.',
  version: '1.0.0',

  params: {
    recordingSid: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Recording SID to retrieve',
    },
    accountSid: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Twilio Account SID',
    },
    authToken: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Twilio Auth Token',
    },
  },

  request: {
    url: (params) => {
      if (!params.accountSid || !params.recordingSid) {
        throw new Error('Twilio Account SID and Recording SID are required')
      }
      return `https://api.twilio.com/2010-04-01/Accounts/${params.accountSid}/Recordings/${params.recordingSid}.json`
    },
    method: 'GET',
    headers: (params) => {
      if (!params.accountSid || !params.authToken) {
        throw new Error('Twilio credentials are required')
      }
      const authToken = Buffer.from(`${params.accountSid}:${params.authToken}`).toString('base64')
      return {
        Authorization: `Basic ${authToken}`,
      }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()

    logger.info('Twilio Get Recording Response:', data)

    if (data.error_code) {
      return {
        success: false,
        output: {
          success: false,
          error: data.message || data.error_message || 'Failed to retrieve recording',
        },
        error: data.message || data.error_message || 'Failed to retrieve recording',
      }
    }

    // Construct full media URL
    const baseUrl = 'https://api.twilio.com'
    const mediaUrl = data.uri ? `${baseUrl}${data.uri.replace('.json', '')}` : undefined

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
        price: data.price,
        priceUnit: data.price_unit,
        uri: data.uri,
      },
      error: undefined,
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the recording was successfully retrieved' },
    recordingSid: { type: 'string', description: 'Unique identifier for the recording' },
    callSid: { type: 'string', description: 'Call SID this recording belongs to' },
    duration: { type: 'number', description: 'Duration of the recording in seconds' },
    status: { type: 'string', description: 'Recording status (completed, processing, etc.)' },
    channels: { type: 'number', description: 'Number of channels (1 for mono, 2 for dual)' },
    source: { type: 'string', description: 'How the recording was created' },
    mediaUrl: { type: 'string', description: 'URL to download the recording media file' },
    price: { type: 'string', description: 'Cost of the recording' },
    priceUnit: { type: 'string', description: 'Currency of the price' },
    uri: { type: 'string', description: 'Relative URI of the recording resource' },
    error: { type: 'string', description: 'Error message if retrieval failed' },
  },
}

