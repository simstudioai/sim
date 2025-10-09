import { createLogger } from '@/lib/logs/console/logger'
import type { TwilioRecordCallParams, TwilioRecordingOutput } from '@/tools/twilio_voice/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('Twilio Voice Record Call Tool')

export const recordCallTool: ToolConfig<TwilioRecordCallParams, TwilioRecordingOutput> = {
  id: 'twilio_voice_record_call',
  name: 'Twilio Voice Record Call',
  description: 'Start recording an active call.',
  version: '1.0.0',

  params: {
    callSid: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Call SID of the call to record',
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
    recordingStatusCallback: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Webhook URL for recording status updates',
    },
    recordingStatusCallbackMethod: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'HTTP method for status callback (GET or POST)',
    },
    recordingChannels: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'mono (single channel) or dual (separate channels for each party)',
    },
    trim: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'trim-silence or do-not-trim',
    },
  },

  request: {
    url: (params) => {
      if (!params.accountSid || !params.callSid) {
        throw new Error('Twilio Account SID and Call SID are required')
      }
      return `https://api.twilio.com/2010-04-01/Accounts/${params.accountSid}/Calls/${params.callSid}/Recordings.json`
    },
    method: 'POST',
    headers: (params) => {
      if (!params.accountSid || !params.authToken) {
        throw new Error('Twilio credentials are required')
      }
      const authToken = Buffer.from(`${params.accountSid}:${params.authToken}`).toString('base64')
      return {
        Authorization: `Basic ${authToken}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      }
    },
    body: (params) => {
      const formData = new URLSearchParams()

      if (params.recordingStatusCallback) {
        formData.append('RecordingStatusCallback', params.recordingStatusCallback)
      }
      if (params.recordingStatusCallbackMethod) {
        formData.append('RecordingStatusCallbackMethod', params.recordingStatusCallbackMethod)
      }
      if (params.recordingChannels) {
        formData.append('RecordingChannels', params.recordingChannels)
      }
      if (params.trim) {
        formData.append('Trim', params.trim)
      }

      return { body: formData.toString() }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()

    logger.info('Twilio Record Call Response:', data)

    if (data.error_code) {
      return {
        success: false,
        output: {
          success: false,
          error: data.message || data.error_message || 'Failed to start recording',
        },
        error: data.message || data.error_message || 'Failed to start recording',
      }
    }

    return {
      success: true,
      output: {
        success: true,
        callSid: data.call_sid,
        recordingSid: data.sid,
        status: data.status,
      },
      error: undefined,
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether recording was successfully started' },
    callSid: { type: 'string', description: 'Unique identifier for the call' },
    recordingSid: { type: 'string', description: 'Unique identifier for the recording' },
    status: { type: 'string', description: 'Recording status (in-progress, completed, etc.)' },
    error: { type: 'string', description: 'Error message if recording failed' },
  },
}

