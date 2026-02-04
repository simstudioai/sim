import type { TwilioGetRecordingOutput, TwilioGetRecordingParams } from '@/tools/twilio_voice/types'
import type { ToolConfig } from '@/tools/types'

export const getRecordingTool: ToolConfig<TwilioGetRecordingParams, TwilioGetRecordingOutput> = {
  id: 'twilio_voice_get_recording',
  name: 'Twilio Voice Get Recording',
  description: 'Retrieve call recording information and transcription (if enabled via TwiML).',
  version: '1.0.0',

  params: {
    recordingSid: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Recording SID to retrieve (e.g., RExxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx)',
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
    url: '/api/tools/twilio/get-recording',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      accountSid: params.accountSid,
      authToken: params.authToken,
      recordingSid: params.recordingSid,
    }),
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
    file: { type: 'file', description: 'Downloaded recording media file' },
    price: { type: 'string', description: 'Cost of the recording' },
    priceUnit: { type: 'string', description: 'Currency of the price' },
    uri: { type: 'string', description: 'Relative URI of the recording resource' },
    transcriptionText: {
      type: 'string',
      description: 'Transcribed text from the recording (if available)',
    },
    transcriptionStatus: {
      type: 'string',
      description: 'Transcription status (completed, in-progress, failed)',
    },
    transcriptionPrice: { type: 'string', description: 'Cost of the transcription' },
    transcriptionPriceUnit: { type: 'string', description: 'Currency of the transcription price' },
    error: { type: 'string', description: 'Error message if retrieval failed' },
  },
}
